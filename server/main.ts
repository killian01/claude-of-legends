// The authoritative game server: one process, one port. Serves the built
// client from dist/, upgrades /ws to WebSocket, runs every live match's Sim
// on a fixed-step 20 Hz accumulator, and streams team-scoped snapshots.
// No accounts and no database: guests only (game definition v1), but the
// session token doubles as a persistent identity (server/players.ts) and
// finished matches land in a JSON match log under DATA_DIR.

import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { type WebSocket, WebSocketServer } from 'ws';
import { isFiniteVec, parseClientMsg, type ServerMsg } from '../src/net/protocol';
import { DT, type TeamId } from '../src/sim/types';
import { fillWithBots } from './bot_fill';
import { clientAddress, edgeConfig, originAllowed } from './edge';
import { buildLadder } from './ladder';
import { AFK_IDLE_TICKS, Match } from './match';
import { Matchmaker } from './matchmaker';
import { handleOf, type PlayerRecord, PlayerRegistry } from './players';
import { buildProfile } from './profile';
import { isRated, LEAVER_LOCKOUT_MS, leaverPenalty, type RatedSeat, ratingDeltas } from './rating';
import { buildMatchRecord, type MatchRecord } from './records';
import { appendJsonl, pruneNumberedJson, readJsonl, saveJsonAtomic } from './store';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = path.resolve(process.cwd(), 'dist');
// Runtime state on disk: player identities and the match log. DATA_DIR is
// the volume to mount in production; nothing else persists.
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
const TICK_MS = DT * 1000;
const MATCH_LINGER_MS = 20_000;
// How long a match with zero connected players keeps running so a dropped
// player (or a reloading solo player) can claim their seat back.
const REJOIN_GRACE_MS = 60_000;
const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 60;
// Abuse bounds: sockets per remote address, and live sims per process.
const MAX_CONN_PER_IP = 8;
const MAX_MATCHES = 50;
// What to believe about a connection that came through a proxy: how deep
// the forwarded chain is (TRUST_PROXY) and which pages may open a socket
// besides our own (ALLOWED_ORIGINS). Both default to trusting nothing.
const EDGE = edgeConfig(process.env);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};

interface Client {
  id: number;
  ws: WebSocket;
  name: string | null;
  // Session token: survives the connection in the browser's storage, so a
  // reconnecting player can claim their reserved seat back.
  token: string;
  matchId: number | null;
  msgWindowStart: number;
  msgCount: number;
}

const clients = new Map<number, Client>();
interface MatchEntry {
  match: Match;
  endedAt: number | null;
  failures: number;
  // Set when the last connected player drops; the match survives a grace
  // window for rejoins instead of being reaped on the spot.
  abandonedAt: number | null;
  // Only public-queue matches can be rated; a private lobby never is
  // (it would be a boosting machine otherwise).
  ratedEligible: boolean;
}
// Queue lockouts for rated-match leavers, by session token. In-memory on
// purpose: a restart amnesties them, and that is fine.
const queueLocks = new Map<string, number>();
const matches = new Map<number, MatchEntry>();
// Seats abandoned by a dropped connection, keyed by session token; a bot
// holds the champion meanwhile. Reservations die with their match.
const reservations = new Map<
  string,
  { matchId: number; name: string; team: TeamId; unitId: number }
>();

function pruneReservations(matchId: number): void {
  for (const [token, r] of reservations) {
    if (r.matchId === matchId) reservations.delete(token);
  }
}
let nextClientId = 1;
let nextMatchId = 1;

const registry = new PlayerRegistry(path.join(DATA_DIR, 'players.json'));
const MATCHES_FILE = path.join(DATA_DIR, 'matches.jsonl');
const REPLAYS_DIR = path.join(DATA_DIR, 'replays');
// How many finished-match replays stay on disk (named by match id).
const REPLAY_KEEP = 40;
// The whole log stays in memory for profile queries; one line per match,
// appended as each ends (kilobytes each, guests-scale).
const matchLog: MatchRecord[] = readJsonl<MatchRecord>(MATCHES_FILE);

// The public shape of a player: everything BUT the token (it is the key
// to the seat and the profile; it must never leave the server).
function describePlayer(p: PlayerRecord): unknown {
  return {
    id: p.id,
    name: p.name,
    disc: p.disc,
    handle: handleOf(p),
    createdAt: p.createdAt,
    rating: p.rating,
    ratedGames: p.ratedGames,
    profile: buildProfile(matchLog, p.id),
  };
}

function send(clientId: number, msg: ServerMsg): void {
  const c = clients.get(clientId);
  if (!c || c.ws.readyState !== c.ws.OPEN) return;
  c.ws.send(JSON.stringify(msg));
}

const matchmaker = new Matchmaker(send, (picks, source) => {
  const id = nextMatchId++;
  const match = new Match((Date.now() % 2_000_000_000) + id, fillWithBots(picks));
  matches.set(id, {
    match,
    endedAt: null,
    failures: 0,
    abandonedAt: null,
    ratedEligible: source === 'queue',
  });
  for (const p of picks) {
    const c = clients.get(p.clientId);
    if (!c) continue;
    c.matchId = id;
    const player = match.players.get(p.clientId);
    if (player) send(p.clientId, { t: 'match_start', selfUnitId: player.unitId, team: p.team });
  }
  console.log(`match ${id} started with ${picks.length} player(s)`);
});

// A player leaves a live match FOR GOOD, by choice or by the AFK sweep:
// rated walk-out penalty and queue lockout when it applies, champion to a
// bot with NO seat reservation, team notice, abandon check. Reservations
// are for dropped connections only.
function walkOutOfMatch(client: Client, entry: MatchEntry, matchId: number): void {
  client.matchId = null;
  reservations.delete(client.token);
  if (entry.ratedEligible && entry.match.sim.winner === null) {
    const humansByTeam: [number, number] = [0, 0];
    for (const p of entry.match.players.values()) {
      if (clients.has(p.clientId)) humansByTeam[p.team] += 1;
    }
    const penalty = leaverPenalty(humansByTeam);
    const reg = registry.findByToken(client.token);
    if (penalty > 0 && reg) {
      registry.penalize(reg.id, penalty);
      queueLocks.set(client.token, Date.now() + LEAVER_LOCKOUT_MS);
      console.log(
        `match ${matchId}: ${client.name} left a rated match (-${penalty}, queue locked)`,
      );
    }
  }
  const left = entry.match.handleDisconnect(client.id);
  if (left) {
    for (const cid of entry.match.players.keys()) {
      send(cid, { t: 'player_left', name: left.name, team: left.team });
    }
  }
  const anyConnected = [...entry.match.players.keys()].some((cid) => clients.has(cid));
  if (!anyConnected && entry.abandonedAt === null) {
    entry.abandonedAt = Date.now();
    console.log(`match ${matchId} abandoned: holding for rejoin grace`);
  }
}

// --- HTTP: static client + health ---

const server = http.createServer(async (req, res) => {
  try {
    const url = (req.url ?? '/').split('?')[0]!;
    // The meta API: identity and career, read-only JSON. /api/me answers
    // to the session token (own profile only); /api/player/<id> is public.
    if (url === '/api/me') {
      const q = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const token = q.get('token') ?? '';
      const p = token.length > 0 && token.length <= 64 ? registry.findByToken(token) : undefined;
      res.writeHead(p ? 200 : 404, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(p ? describePlayer(p) : { error: 'unknown player' }));
      return;
    }
    if (url === '/api/ladder') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(buildLadder(registry.all())));
      return;
    }
    if (url === '/api/live') {
      // Running matches open to spectators: never abandoned, not ended.
      const live = [...matches.entries()]
        .filter(([, e]) => e.endedAt === null && e.abandonedAt === null)
        .map(([id, e]) => ({
          id,
          durationS: Math.round(e.match.sim.time),
          spectators: e.match.spectators.size,
          players: [...e.match.players.values()].map((p) => ({ name: p.name, team: p.team })),
        }));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(live));
      return;
    }
    const replayUrl = /^\/api\/replay\/(\d{1,9})$/.exec(url);
    if (replayUrl) {
      try {
        const body = await readFile(path.join(REPLAYS_DIR, `${replayUrl[1]}.json`));
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(body);
      } catch {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'replay not found' }));
      }
      return;
    }
    const playerUrl = /^\/api\/player\/(\d{1,9})$/.exec(url);
    if (playerUrl) {
      const p = registry.findById(Number(playerUrl[1]));
      res.writeHead(p ? 200 : 404, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(p ? describePlayer(p) : { error: 'unknown player' }));
      return;
    }
    if (url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          clients: clients.size,
          matches: matches.size,
          uptimeS: Math.round(process.uptime()),
        }),
      );
      return;
    }
    let filePath = path.join(DIST, url === '/' ? 'index.html' : url);
    if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {
      filePath = path.join(DIST, 'index.html');
    }
    const body = await readFile(filePath);
    // The client shipped no caching headers at all, which leaves a browser
    // free to serve a stale index.html and with it the previous build's
    // hashed bundle: you reload after a change and see yesterday's game.
    // Vite fingerprints everything under /assets/, so those are immutable
    // and the entry document must always be revalidated.
    const immutable = url.startsWith('/assets/');
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

// --- WebSocket ---

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 16 * 1024,
  // A seat is handed out on the upgrade, so a page we never served does
  // not get one. A client without an Origin header (a headless bot) does.
  verifyClient: ({ req }, done) => {
    if (originAllowed(req.headers, EDGE)) {
      done(true);
      return;
    }
    console.warn(`refused upgrade from origin ${String(req.headers.origin)}`);
    done(false, 403, 'forbidden origin');
  },
});

// Sockets per remote address, so one machine cannot farm connections.
const ipCounts = new Map<string, number>();

wss.on('connection', (ws, req) => {
  const ip = clientAddress(req.headers, req.socket.remoteAddress, EDGE);
  const ipCount = ipCounts.get(ip) ?? 0;
  if (ipCount >= MAX_CONN_PER_IP) {
    ws.close(1013, 'too many connections');
    return;
  }
  ipCounts.set(ip, ipCount + 1);
  const id = nextClientId++;
  const client: Client = {
    id,
    ws,
    name: null,
    token: randomBytes(12).toString('hex'),
    matchId: null,
    msgWindowStart: Date.now(),
    msgCount: 0,
  };
  clients.set(id, client);
  send(id, { t: 'welcome', clientId: id, token: client.token });

  ws.on('message', (data) => {
    const raw = data.toString();
    if (raw.length > MAX_MSG_BYTES) return;
    const now = Date.now();
    if (now - client.msgWindowStart > 1000) {
      client.msgWindowStart = now;
      client.msgCount = 0;
    }
    if (++client.msgCount > MAX_MSGS_PER_SEC) return;

    const msg = parseClientMsg(raw);
    if (!msg) return;

    if (msg.t === 'hello') {
      const name = String(msg.name ?? '')
        .trim()
        .slice(0, 24);
      client.name = name.length > 0 ? name : `guest${id}`;
      // A returning browser presents its previous token: adopt it, and if a
      // live match still holds a reserved seat for it, hand the seat back
      // (the bot stand-in steps aside). The later queue/lobby message from
      // the same client is then ignored by the in-match guard.
      const token = typeof msg.token === 'string' && msg.token.length <= 64 ? msg.token : null;
      // Every hello lands in the player registry: first contact creates
      // the identity, later ones refresh the name and last-seen.
      registry.getOrCreate(token ?? client.token, client.name, Date.now());
      if (token) {
        client.token = token;
        const seat = reservations.get(token);
        if (seat) {
          reservations.delete(token);
          const entry = matches.get(seat.matchId);
          if (entry) {
            entry.match.restorePlayer(id, seat);
            entry.abandonedAt = null;
            client.matchId = seat.matchId;
            send(id, { t: 'match_start', selfUnitId: seat.unitId, team: seat.team });
            for (const cid of entry.match.players.keys()) {
              if (cid !== id) send(cid, { t: 'player_back', name: seat.name, team: seat.team });
            }
            console.log(`match ${seat.matchId}: ${seat.name} reconnected`);
          }
        }
      }
      return;
    }
    if (client.name === null) return;

    // A client already seated in a live match cannot re-enter matchmaking
    // (review F.2: interleaved double-match snapshots corrupted the mirror).
    const inMatch = client.matchId !== null;
    // Capacity gate at the entry points: a full server refuses new games
    // politely instead of degrading every running one.
    const atCapacity = matches.size >= MAX_MATCHES;
    const refuseCapacity = (): void =>
      send(id, { t: 'error', message: 'The server is at capacity, try again in a bit.' });
    switch (msg.t) {
      case 'queue': {
        if (inMatch) break;
        // Rated-match leavers sit out a short lockout before requeueing.
        const lockedUntil = queueLocks.get(client.token) ?? 0;
        if (lockedUntil > now) {
          send(id, {
            t: 'error',
            message: `You left a rated match. The queue unlocks in ${Math.ceil((lockedUntil - now) / 1000)}s.`,
          });
          break;
        }
        queueLocks.delete(client.token);
        if (atCapacity) refuseCapacity();
        else matchmaker.addToQueue(id, client.name, now);
        break;
      }
      case 'start_now':
        if (!inMatch) matchmaker.startNow(id, now);
        break;
      case 'leave': {
        matchmaker.removeEverywhere(id);
        // A deliberate walk-out from a live match: hand the champion to a
        // bot for good and hold NO seat reservation. Reservations are for
        // dropped connections; a player who chose to leave (end screen,
        // escape menu) must not be pulled back in by their next queue.
        const leftMatchId = client.matchId;
        if (leftMatchId !== null) {
          const entry = matches.get(leftMatchId);
          if (entry && !entry.match.players.has(id)) {
            // A spectator walking out only stops watching: no bot
            // takeover, no penalty, no team notice.
            client.matchId = null;
            entry.match.removeSpectator(id);
          } else if (entry) {
            walkOutOfMatch(client, entry, leftMatchId);
          } else {
            client.matchId = null;
            reservations.delete(client.token);
          }
        }
        break;
      }
      case 'create_lobby':
        if (inMatch) break;
        if (atCapacity) refuseCapacity();
        else matchmaker.createLobby(id, client.name, now);
        break;
      case 'join_lobby':
        if (!inMatch) matchmaker.joinLobby(id, client.name, String(msg.code ?? ''));
        break;
      case 'lobby_team':
        if (!inMatch) matchmaker.setLobbyTeam(id, msg.team);
        break;
      case 'queue_party':
        if (inMatch) break;
        if (atCapacity) refuseCapacity();
        else if ((queueLocks.get(client.token) ?? 0) > now) {
          send(id, {
            t: 'error',
            message: `You left a rated match. The queue unlocks in ${Math.ceil(((queueLocks.get(client.token) ?? 0) - now) / 1000)}s.`,
          });
        } else matchmaker.queuePartyFromLobby(id, now);
        break;
      case 'spectate': {
        if (inMatch) break;
        const target = typeof msg.matchId === 'number' ? matches.get(msg.matchId) : undefined;
        if (!target || target.endedAt !== null || target.abandonedAt !== null) {
          send(id, { t: 'error', message: 'That match is over or gone.' });
          break;
        }
        if (!target.match.addSpectator(id, msg.team === 1 ? 1 : 0)) {
          send(id, { t: 'error', message: 'That match has no spectator slots left.' });
          break;
        }
        client.matchId = msg.matchId as number;
        send(id, { t: 'match_start', selfUnitId: 0, team: msg.team === 1 ? 1 : 0 });
        break;
      }
      case 'start_lobby':
        if (!inMatch) matchmaker.startLobby(id, now);
        break;
      case 'pick':
        matchmaker.pick(id, msg.championId, msg.sigils, msg.skin);
        break;
      case 'chat':
      case 'ping': {
        if (client.matchId === null) break;
        const entry = matches.get(client.matchId);
        const player = entry?.match.players.get(id);
        if (!entry || !player) break;
        // Team-scoped, like the snapshots: a chat line or a ping must never
        // hand the enemy a position (review: cross-team ping leak).
        if (msg.t === 'chat') {
          const text = String(msg.text ?? '')
            .trim()
            .slice(0, 200);
          if (!text) break;
          for (const cid of entry.match.teamRecipients(id)) {
            send(cid, { t: 'chat', from: player.name, team: player.team, text });
          }
        } else if (isFiniteVec(msg.x, msg.z)) {
          for (const cid of entry.match.teamRecipients(id)) {
            send(cid, {
              t: 'ping',
              from: player.name,
              team: player.team,
              x: msg.x,
              z: msg.z,
            });
          }
        }
        break;
      }
      default: {
        if (client.matchId === null) return;
        const entry = matches.get(client.matchId);
        if (entry) entry.match.handleCommand(id, msg);
      }
    }
  });

  ws.on('close', () => {
    const remaining = (ipCounts.get(ip) ?? 1) - 1;
    if (remaining <= 0) ipCounts.delete(ip);
    else ipCounts.set(ip, remaining);
    matchmaker.removeEverywhere(id);
    const matchId = client.matchId;
    clients.delete(id);
    // Reap matches whose players are all gone (review F.2: ghost matches
    // kept ticking until a Sanctum fell).
    if (matchId !== null) {
      const entry = matches.get(matchId);
      if (entry) {
        // A dropped spectator just stops watching.
        entry.match.removeSpectator(id);
        // Hand the abandoned champion to a bot, tell the team, and reserve
        // the seat against the session token so the player can come back.
        const left = entry.match.handleDisconnect(id);
        if (left) {
          reservations.set(client.token, { matchId, ...left });
          for (const cid of entry.match.players.keys()) {
            send(cid, { t: 'player_left', name: left.name, team: left.team });
          }
        }
        // Not reaped on the spot: the seat reservations above deserve a
        // grace window, so an accidental reload can come back (the world
        // loop reaps once the window closes).
        const anyConnected = [...entry.match.players.keys()].some((cid) => clients.has(cid));
        if (!anyConnected && entry.abandonedAt === null) {
          entry.abandonedAt = Date.now();
          console.log(`match ${matchId} abandoned: holding for rejoin grace`);
        }
      }
    }
  });
});

// --- The world loop: fixed-step accumulator, guarded per match ---

let last = Date.now();
let acc = 0;
setInterval(() => {
  const now = Date.now();
  acc += Math.min(now - last, 500);
  last = now;
  matchmaker.tickClock(now);

  // Reap abandoned matches whose rejoin grace ran out.
  for (const [matchId, entry] of matches) {
    if (entry.abandonedAt !== null && now - entry.abandonedAt > REJOIN_GRACE_MS) {
      matches.delete(matchId);
      pruneReservations(matchId);
      console.log(`match ${matchId} reaped: rejoin grace expired`);
    }
  }

  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    for (const [matchId, entry] of matches) {
      try {
        entry.match.tick();
        const score = entry.match.sim.tickCount % 40 === 0 ? entry.match.buildScore() : null;
        for (const player of entry.match.players.values()) {
          const snap = entry.match.buildSnapshotFor(player.clientId);
          if (snap) send(player.clientId, snap);
          if (score) send(player.clientId, score);
        }
        for (const cid of entry.match.spectators.keys()) {
          const snap = entry.match.buildSpectatorSnapshotFor(cid);
          if (snap) send(cid, snap);
          if (score) send(cid, score);
        }
        // AFK sweep: a connected player silent for two minutes in a live
        // match with other humans walks out (bot takeover, penalty when
        // rated); a solo-vs-bots match harms nobody and is left alone.
        if (
          entry.match.sim.tickCount % 200 === 0 &&
          entry.match.sim.winner === null &&
          entry.match.players.size >= 2
        ) {
          for (const cid of entry.match.idleClientIds(AFK_IDLE_TICKS)) {
            const c = clients.get(cid);
            if (!c) continue;
            send(cid, {
              t: 'error',
              message: 'Removed for inactivity: a bot takes your champion over.',
            });
            walkOutOfMatch(c, entry, matchId);
            console.log(`match ${matchId}: ${c.name} removed for inactivity`);
          }
        }
        if (entry.match.sim.winner !== null && entry.endedAt === null) {
          entry.endedAt = now;
          // Record the finished match once, the moment the winner lands:
          // seats still held by a connected human carry their player id.
          const playerIdByUnit = new Map<number, number>();
          for (const p of entry.match.players.values()) {
            const c = clients.get(p.clientId);
            const reg = c ? registry.findByToken(c.token) : undefined;
            if (reg) playerIdByUnit.set(p.unitId, reg.id);
          }
          // Rating policy (server/rating.ts): only public-queue matches
          // with at least one human on each side are rated; every human
          // on a team moves together.
          const seats: RatedSeat[] = [];
          for (const p of entry.match.players.values()) {
            const pid = playerIdByUnit.get(p.unitId);
            const reg = pid !== undefined ? registry.findById(pid) : undefined;
            if (pid !== undefined && reg) {
              seats.push({ playerId: pid, team: p.team, rating: reg.rating });
            }
          }
          const humansByTeam: [number, number] = [
            seats.filter((s) => s.team === 0).length,
            seats.filter((s) => s.team === 1).length,
          ];
          const rated = entry.ratedEligible && isRated(humansByTeam);
          const deltas = rated
            ? ratingDeltas(seats, entry.match.sim.winner)
            : new Map<number, number>();
          for (const [pid, delta] of deltas) registry.applyRating(pid, delta);
          // Tell each human what the match did to their rating; the end
          // screen shows it next to the final scoreboard.
          for (const p of entry.match.players.values()) {
            const pid = playerIdByUnit.get(p.unitId);
            const reg = pid !== undefined ? registry.findById(pid) : undefined;
            if (pid === undefined || !reg) continue;
            send(p.clientId, {
              t: 'match_result',
              rated,
              delta: deltas.get(pid) ?? 0,
              rating: reg.rating,
            });
          }
          // Save the replay first so the match record can point at it.
          let replayId: number | undefined;
          if (entry.match.replayComplete) {
            try {
              saveJsonAtomic(path.join(REPLAYS_DIR, `${matchId}.json`), {
                version: 1,
                seed: entry.match.seed,
                picks: entry.match.replayPicks,
                events: entry.match.replayEvents,
                ticks: entry.match.sim.tickCount,
              });
              replayId = matchId;
              pruneNumberedJson(REPLAYS_DIR, REPLAY_KEEP);
            } catch (err) {
              console.error('replay save failed', err);
            }
          }
          const score = entry.match.buildScore();
          if (score.t === 'score') {
            const rec = buildMatchRecord(
              score.rows,
              playerIdByUnit,
              entry.match.sim.winner,
              entry.match.sim.time,
              now,
              { rated, deltas },
              replayId,
            );
            matchLog.push(rec);
            try {
              appendJsonl(MATCHES_FILE, rec);
            } catch (err) {
              console.error('match log append failed', err);
            }
            console.log(`match ${matchId} recorded (${playerIdByUnit.size} human seat(s))`);
          }
        }
        if (entry.endedAt !== null && now - entry.endedAt > MATCH_LINGER_MS) {
          for (const player of entry.match.players.values()) {
            const c = clients.get(player.clientId);
            if (c) c.matchId = null;
            send(player.clientId, { t: 'match_end' });
          }
          for (const cid of entry.match.spectators.keys()) {
            const c = clients.get(cid);
            if (c) c.matchId = null;
            send(cid, { t: 'match_end' });
          }
          matches.delete(matchId);
          pruneReservations(matchId);
          console.log(`match ${matchId} closed`);
        }
        entry.failures = 0;
      } catch (err) {
        console.error(`match ${matchId} tick failed`, err);
        entry.failures += 1;
        if (entry.failures > 200) {
          for (const player of entry.match.players.values()) {
            const c = clients.get(player.clientId);
            if (c) c.matchId = null;
            send(player.clientId, { t: 'match_end' });
          }
          for (const cid of entry.match.spectators.keys()) {
            const c = clients.get(cid);
            if (c) c.matchId = null;
            send(cid, { t: 'match_end' });
          }
          matches.delete(matchId);
          pruneReservations(matchId);
          console.error(`match ${matchId} force-closed after repeated tick failures`);
        }
      }
    }
  }
}, 25);

// Last-resort guards: a throw outside the per-match try/catch must never
// take down every live match silently. Log loudly and keep serving; the
// per-match failure counter already contains repeated sim faults.
process.on('uncaughtException', (err) => {
  console.error('uncaught exception (server kept alive)', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandled rejection (server kept alive)', err);
});

// Graceful stop: close the sockets so clients get a clean disconnect notice
// instead of a timeout.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`${sig}: shutting down`);
    for (const c of clients.values()) c.ws.close();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

server.listen(PORT, () => {
  console.log(`claude-of-legends server on :${PORT} (serving ${DIST})`);
  console.log(
    `edge: ${EDGE.hops} trusted proxy hop(s), origins ${
      EDGE.origins.length > 0 ? EDGE.origins.join(' ') : 'same-host only'
    }`,
  );
  // In dev the vite server owns the client and this warning is expected
  // noise only when dist was never built; in production it means the image
  // or the start script skipped `pnpm build`.
  void stat(path.join(DIST, 'index.html')).catch(() => {
    console.warn('dist/index.html not found: the client is not built (run "pnpm build")');
  });
});
