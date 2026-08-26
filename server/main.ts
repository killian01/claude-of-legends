// The authoritative game server: one process, one port. Serves the built
// client from dist/, upgrades /ws to WebSocket, runs every live match's Sim
// on a fixed-step 20 Hz accumulator, and streams team-scoped snapshots.
// No accounts, no database: guests only (game definition v1).

import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { type WebSocket, WebSocketServer } from 'ws';
import { parseClientMsg, type ServerMsg } from '../src/net/protocol';
import { DT } from '../src/sim/types';
import { Match } from './match';
import { Matchmaker } from './matchmaker';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = path.resolve(process.cwd(), 'dist');
const TICK_MS = DT * 1000;
const MATCH_LINGER_MS = 20_000;
const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 60;

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
};

interface Client {
  id: number;
  ws: WebSocket;
  name: string | null;
  matchId: number | null;
  msgWindowStart: number;
  msgCount: number;
}

const clients = new Map<number, Client>();
const matches = new Map<number, { match: Match; endedAt: number | null }>();
let nextClientId = 1;
let nextMatchId = 1;

function send(clientId: number, msg: ServerMsg): void {
  const c = clients.get(clientId);
  if (!c || c.ws.readyState !== c.ws.OPEN) return;
  c.ws.send(JSON.stringify(msg));
}

const matchmaker = new Matchmaker(send, (picks) => {
  const id = nextMatchId++;
  const match = new Match((Date.now() % 2_000_000_000) + id, picks);
  matches.set(id, { match, endedAt: null });
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
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    let filePath = path.join(DIST, url === '/' ? 'index.html' : url);
    if (!filePath.startsWith(DIST)) {
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

wss.on('connection', (ws) => {
  const id = nextClientId++;
  const client: Client = {
    id,
    ws,
    name: null,
    matchId: null,
    msgWindowStart: Date.now(),
    msgCount: 0,
  };
  clients.set(id, client);
  send(id, { t: 'welcome', clientId: id });

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
      return;
    }
    if (client.name === null) return;

    switch (msg.t) {
      case 'queue':
        matchmaker.addToQueue(id, client.name, now);
        break;
      case 'start_now':
        matchmaker.startNow(id, now);
        break;
      case 'leave':
        matchmaker.removeEverywhere(id);
        break;
      case 'create_lobby':
        matchmaker.createLobby(id, client.name);
        break;
      case 'join_lobby':
        matchmaker.joinLobby(id, client.name, String(msg.code ?? ''));
        break;
      case 'start_lobby':
        matchmaker.startLobby(id, now);
        break;
      case 'pick':
        matchmaker.pick(id, msg.championId, msg.sigils);
        break;
      default: {
        if (client.matchId === null) return;
        const entry = matches.get(client.matchId);
        if (entry) entry.match.handleCommand(id, msg);
      }
    }
  });

  ws.on('close', () => {
    matchmaker.removeEverywhere(id);
    clients.delete(id);
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

  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    for (const [matchId, entry] of matches) {
      try {
        entry.match.tick();
        for (const player of entry.match.players.values()) {
          const snap = entry.match.buildSnapshotFor(player.clientId);
          if (snap) send(player.clientId, snap);
        }
        if (entry.match.sim.winner !== null && entry.endedAt === null) entry.endedAt = now;
        if (entry.endedAt !== null && now - entry.endedAt > MATCH_LINGER_MS) {
          for (const player of entry.match.players.values()) {
            const c = clients.get(player.clientId);
            if (c) c.matchId = null;
            send(player.clientId, { t: 'match_end' });
          }
          matches.delete(matchId);
          console.log(`match ${matchId} closed`);
        }
      } catch (err) {
        console.error(`match ${matchId} tick failed`, err);
      }
    }
  }
}, 25);

server.listen(PORT, () => {
  console.log(`claude-of-legends server on :${PORT} (serving ${DIST})`);
});
