// The authoritative game server: one process, one port. Serves the built
// client from dist/, upgrades /ws to WebSocket, runs every live match's Sim
// on a fixed-step 20 Hz accumulator, and streams team-scoped snapshots.
// No accounts, no database: guests only (game definition v1).

import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { type WebSocket, WebSocketServer } from 'ws';
import { isFiniteVec, parseClientMsg, type ServerMsg } from '../src/net/protocol';
import { DT, type TeamId } from '../src/sim/types';
import { fillWithBots } from './bot_fill';
import { Match } from './match';
import { Matchmaker } from './matchmaker';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = path.resolve(process.cwd(), 'dist');
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
}
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

function send(clientId: number, msg: ServerMsg): void {
  const c = clients.get(clientId);
  if (!c || c.ws.readyState !== c.ws.OPEN) return;
  c.ws.send(JSON.stringify(msg));
}

const matchmaker = new Matchmaker(send, (picks) => {
  const id = nextMatchId++;
  const match = new Match((Date.now() % 2_000_000_000) + id, fillWithBots(picks));
  matches.set(id, { match, endedAt: null, failures: 0, abandonedAt: null });
  for (const p of picks) {
    const c = clients.get(p.clientId);
    if (!c) continue;
    c.matchId = id;
    const player = match.players.get(p.clientId);
    if (player) send(p.clientId, { t: 'match_start', selfUnitId: player.unitId, team: p.team });
  }
  console.log(`match ${id} started with ${picks.length} player(s)`);
});

// --- HTTP: static client + health ---

const server = http.createServer(async (req, res) => {
  try {
    const url = (req.url ?? '/').split('?')[0]!;
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
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

// --- WebSocket ---

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

// Sockets per remote address, so one machine cannot farm connections.
const ipCounts = new Map<string, number>();

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress ?? 'unknown';
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
      case 'queue':
        if (inMatch) break;
        if (atCapacity) refuseCapacity();
        else matchmaker.addToQueue(id, client.name, now);
        break;
      case 'start_now':
        if (!inMatch) matchmaker.startNow(id, now);
        break;
      case 'leave':
        matchmaker.removeEverywhere(id);
        break;
      case 'create_lobby':
        if (inMatch) break;
        if (atCapacity) refuseCapacity();
        else matchmaker.createLobby(id, client.name, now);
        break;
      case 'join_lobby':
        if (!inMatch) matchmaker.joinLobby(id, client.name, String(msg.code ?? ''));
        break;
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
        if (entry.match.sim.winner !== null && entry.endedAt === null) entry.endedAt = now;
        if (entry.endedAt !== null && now - entry.endedAt > MATCH_LINGER_MS) {
          for (const player of entry.match.players.values()) {
            const c = clients.get(player.clientId);
            if (c) c.matchId = null;
            send(player.clientId, { t: 'match_end' });
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
  // In dev the vite server owns the client and this warning is expected
  // noise only when dist was never built; in production it means the image
  // or the start script skipped `pnpm build`.
  void stat(path.join(DIST, 'index.html')).catch(() => {
    console.warn('dist/index.html not found: the client is not built (run "pnpm build")');
  });
});
