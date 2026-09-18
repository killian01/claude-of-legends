// Ten clients and no browser: a load test for the game server. Each client
// is an account on a WebSocket speaking the wire protocol
// (src/net/protocol.ts): it registers, sits in one lobby, picks, and plays
// a plain hand for the length of the run (walks at the enemy base, fights
// what it sees, casts, levels, buys), while measuring what it receives:
// snapshots per second, their size, the longest gap between two, and the
// round trip of a map ping through the server. The server's own numbers
// come from /healthz (the tick meter, server/tick_meter.ts). One line every
// five seconds, a verdict at the end; exit 1 when the server strained.
//
// Against the local stack (the server itself, or the Vite proxy):
//   URL=http://localhost:8787 node scripts/load_match.mjs
// With a seat for a person: nine clients, the lobby code printed, the
// match starts when the tenth player is in.
//   URL=https://... N=9 TOTAL=10 node scripts/load_match.mjs
// Into a lobby a person already opened (they press Start):
//   URL=https://... N=9 CODE=ABCDE node scripts/load_match.mjs
// Knobs: N clients (10), TOTAL players the host waits for before it starts
// (N), CODE, DURATION seconds of play (180), WAIT seconds for the lobby to
// fill (600), ORDER_MS between a client's orders (250). Every run makes
// its own accounts (load-<run>-<n>) on the server it points at.

import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const ORIGIN = (process.env.URL ?? 'http://localhost:8787').replace(/\/$/, '');
const N = Number(process.env.N ?? 10);
const TOTAL = Number(process.env.TOTAL ?? N);
const CODE = process.env.CODE ? process.env.CODE.toUpperCase() : null;
const DURATION = Number(process.env.DURATION ?? 180);
const WAIT = Number(process.env.WAIT ?? 600);
const ORDER_MS = Number(process.env.ORDER_MS ?? 250);
const REPORT_MS = 5000;
const PASSWORD = 'load-test-password-01';
const STARTERS = ['torv', 'fenn', 'ashvyn', 'sylra'];
const SIGILS = ['riftstep', 'mend'];
const KEYS = ['Q', 'W', 'E', 'R'];
const TICK_MS = 50;
// The two bases of the Star Orchard, where each side's champions walk to.
const BASES = JSON.parse(
  readFileSync(new URL('../public/map/star-orchard/gameplay.json', import.meta.url), 'utf8'),
).bases;

const run = Date.now().toString(36).slice(-4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[load ${new Date().toISOString().slice(11, 19)}]`, ...a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const percentile = (sorted, p) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

async function register(name) {
  const res = await fetch(`${ORIGIN}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password: PASSWORD }),
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('loc_session='));
  if (!res.ok || !cookie) throw new Error(`register ${name}: ${res.status} ${await res.text()}`);
  return cookie.split(';')[0];
}

class LoadClient {
  constructor(index, name, cookie) {
    this.index = index;
    this.name = name;
    this.cookie = cookie;
    this.ws = null;
    this.lobby = null;
    this.selfUnitId = 0;
    this.team = null;
    this.inMatch = false;
    this.winner = null;
    this.done = false;
    this.units = new Map();
    this.self = null;
    this.time = 0;
    this.pingSentAt = 0;
    this.lastBuyAt = 0;
    this.window = { snaps: 0, bytes: 0, gaps: [], rtts: [] };
    this.total = { snaps: 0, bytes: 0, maxGap: 0, rtts: [], firstSnapAt: 0, lastSnapAt: 0 };
    this.errors = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `${ORIGIN.replace(/^http/, 'ws')}/ws`;
      this.ws = new WebSocket(url, { headers: { cookie: this.cookie } });
      this.ws.on('open', () => this.send({ t: 'hello' }));
      this.ws.on('error', (err) => reject(err));
      this.ws.on('close', () => {
        this.done = true;
      });
      this.ws.on('message', (data) => {
        const raw = data.toString();
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (msg.t === 'welcome') resolve();
        this.handle(msg, raw.length);
      });
    });
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  handle(msg, bytes) {
    const now = Date.now();
    switch (msg.t) {
      case 'lobby':
        this.lobby = msg;
        break;
      case 'select_start':
        this.send({
          t: 'pick',
          championId: STARTERS[this.index % STARTERS.length],
          sigils: SIGILS,
          skin: 0,
        });
        break;
      case 'match_start':
        this.selfUnitId = msg.selfUnitId;
        this.team = msg.team;
        this.inMatch = true;
        break;
      case 'snap': {
        if (this.total.lastSnapAt > 0) {
          const gap = now - this.total.lastSnapAt;
          this.window.gaps.push(gap);
          if (gap > this.total.maxGap) this.total.maxGap = gap;
        } else this.total.firstSnapAt = now;
        this.total.lastSnapAt = now;
        this.window.snaps++;
        this.window.bytes += bytes;
        this.total.snaps++;
        this.total.bytes += bytes;
        this.time = msg.time;
        for (const u of msg.units) this.units.set(u.i, { ...(this.units.get(u.i) ?? {}), ...u });
        for (const id of msg.gone) this.units.delete(id);
        this.self = msg.self;
        this.winner = msg.winner;
        break;
      }
      case 'ping':
        if (msg.from === this.name && this.pingSentAt > 0) {
          const rtt = now - this.pingSentAt;
          this.pingSentAt = 0;
          this.window.rtts.push(rtt);
          this.total.rtts.push(rtt);
        }
        break;
      case 'match_end':
        this.inMatch = false;
        this.done = true;
        break;
      case 'error':
        this.errors.push(msg.message);
        log(`${this.name}: server says: ${msg.message}`);
        break;
      default:
        break;
    }
  }

  // The hand it plays: a plain one, enough to move, fight and cast.
  act() {
    if (!this.inMatch || !this.self || this.self.dead || this.winner !== null) return;
    const me = this.units.get(this.selfUnitId);
    if (!me) return;
    const enemies = [...this.units.values()].filter(
      (u) => u.t !== undefined && u.t !== this.team && !u.d && u.k !== undefined,
    );
    let target = null;
    let best = 30;
    for (const u of enemies) {
      const d = dist(u, me);
      if (d < best) {
        best = d;
        target = u;
      }
    }
    if (target) {
      if (target.k === 'champion' && best < 9) {
        const key = KEYS.find(
          (k) =>
            (this.self.abilityRanks?.[k] ?? 0) > 0 && (this.self.cooldowns?.[k] ?? 0) <= this.time,
        );
        if (key) this.send({ t: 'cast', key, x: target.x, z: target.z });
      }
      this.send({ t: 'attack_move', x: target.x, z: target.z });
    } else {
      const base = BASES[1 - this.team];
      this.send({
        t: 'attack_move',
        x: base.x + (Math.random() - 0.5) * 12,
        z: base.z + (Math.random() - 0.5) * 12,
      });
    }
    if ((this.self.skillPoints ?? 0) > 0) {
      const ranks = this.self.abilityRanks ?? {};
      const key = ['Q', 'W', 'E'].sort((a, b) => (ranks[a] ?? 0) - (ranks[b] ?? 0))[0];
      this.send({ t: 'skill', key: this.self.level >= 6 && (ranks.R ?? 0) < 1 ? 'R' : key });
    }
    const now = Date.now();
    if (now - this.lastBuyAt > 30000 && (this.self.gold ?? 0) >= 400) {
      this.lastBuyAt = now;
      this.send({ t: 'buy', itemId: 'iron_blade' });
    }
  }

  ping() {
    if (!this.inMatch || this.pingSentAt > 0) return;
    const me = this.units.get(this.selfUnitId);
    if (!me) return;
    this.pingSentAt = Date.now();
    this.send({ t: 'ping', x: me.x, z: me.z });
  }

  takeWindow() {
    const w = this.window;
    this.window = { snaps: 0, bytes: 0, gaps: [], rtts: [] };
    return w;
  }

  leave() {
    this.send({ t: 'leave' });
    setTimeout(() => this.ws?.close(), 300);
  }
}

async function serverTick() {
  try {
    const res = await fetch(`${ORIGIN}/healthz`);
    const body = await res.json();
    return body.tick ?? null;
  } catch {
    return null;
  }
}

async function main() {
  log(`${N} clients against ${ORIGIN}${CODE ? `, lobby ${CODE}` : ''}`);
  const clients = [];
  for (let i = 0; i < N; i++) {
    const name = `load-${run}-${String(i + 1).padStart(2, '0')}`;
    clients.push(new LoadClient(i, name, await register(name)));
  }
  log(`${N} accounts registered (load-${run}-01..${String(N).padStart(2, '0')})`);
  await Promise.all(clients.map((c) => c.connect()));
  log('all connected');

  const host = clients[0];
  let code = CODE;
  if (!code) {
    host.send({ t: 'create_lobby' });
    while (!host.lobby) await sleep(50);
    code = host.lobby.code;
    log(`lobby ${code} open`);
  }
  for (const c of clients) if (c !== host || CODE) c.send({ t: 'join_lobby', code });
  const t0 = Date.now();
  let told = -1;
  while (Date.now() - t0 < WAIT * 1000) {
    if (clients.some((c) => c.selfUnitId !== 0 || c.inMatch)) break;
    const players = host.lobby?.players?.length ?? 0;
    if (players !== told) {
      told = players;
      log(`lobby ${code}: ${players} / ${TOTAL} players${players < TOTAL ? ', waiting' : ''}`);
    }
    if (!CODE && players >= TOTAL) {
      host.send({ t: 'start_lobby' });
      log('host starts the lobby');
      break;
    }
    await sleep(500);
  }
  if (!CODE && (host.lobby?.players?.length ?? 0) < TOTAL) {
    log(`the lobby did not fill in ${WAIT} s; starting with what is there`);
    host.send({ t: 'start_lobby' });
  }
  while (!clients.every((c) => c.inMatch) && !clients.some((c) => c.done)) await sleep(100);
  log(`match on: ${clients.filter((c) => c.inMatch).length} clients seated`);
  const started = Date.now();
  const orders = setInterval(() => {
    for (const c of clients) c.act();
  }, ORDER_MS);
  const pings = setInterval(() => {
    for (const c of clients) c.ping();
  }, 2000);

  const strains = [];
  while (Date.now() - started < DURATION * 1000) {
    await sleep(REPORT_MS);
    if (clients.every((c) => c.done)) break;
    const windows = clients.map((c) => c.takeWindow());
    const seconds = REPORT_MS / 1000;
    const snaps = windows.reduce((s, w) => s + w.snaps, 0);
    const bytes = windows.reduce((s, w) => s + w.bytes, 0);
    const gaps = windows.flatMap((w) => w.gaps).sort((a, b) => a - b);
    const rtts = windows.flatMap((w) => w.rtts).sort((a, b) => a - b);
    const perClient = snaps / clients.length / seconds;
    const maxGap = gaps.at(-1) ?? 0;
    const tick = await serverTick();
    const line =
      `snaps ${perClient.toFixed(1)}/s per client, ${Math.round(bytes / Math.max(1, snaps))} B each, ` +
      `gap p99 ${percentile(gaps, 0.99)} ms max ${maxGap} ms, ping p50 ${percentile(rtts, 0.5)} ms ` +
      `p99 ${percentile(rtts, 0.99)} ms | server ${
        tick
          ? `${tick.ticksPerSecond} ticks/s, avg ${tick.avgMs} ms, max ${tick.maxMs} ms, late ${tick.late}, out ${Math.round(tick.bytesPerSecond / 1000)} kB/s`
          : 'no tick report'
      }`;
    log(line);
    if (clients.some((c) => c.winner !== null)) {
      log('the match has a winner');
      break;
    }
    if (perClient < 19) strains.push(`snapshots fell to ${perClient.toFixed(1)}/s`);
    if (maxGap > 6 * TICK_MS) strains.push(`a ${maxGap} ms gap between snapshots`);
    if (percentile(rtts, 0.99) > 150) strains.push(`ping p99 ${percentile(rtts, 0.99)} ms`);
    if (tick && tick.maxMs > TICK_MS) strains.push(`a ${tick.maxMs} ms tick on the server`);
  }
  clearInterval(orders);
  clearInterval(pings);
  for (const c of clients) c.leave();
  await sleep(600);

  const allRtts = clients.flatMap((c) => c.total.rtts).sort((a, b) => a - b);
  const totalSnaps = clients.reduce((s, c) => s + c.total.snaps, 0);
  const totalBytes = clients.reduce((s, c) => s + c.total.bytes, 0);
  const maxGap = Math.max(...clients.map((c) => c.total.maxGap));
  const played = (Date.now() - started) / 1000;
  log(
    `over ${played.toFixed(0)} s: ${totalSnaps} snapshots (${(totalSnaps / clients.length / played).toFixed(1)}/s per client), ` +
      `${(totalBytes / 1e6).toFixed(1)} MB in all, longest gap ${maxGap} ms, ping p50 ${percentile(allRtts, 0.5)} ms p99 ${percentile(allRtts, 0.99)} ms`,
  );
  const errors = clients.flatMap((c) => c.errors);
  if (errors.length > 0)
    log(`server errors: ${errors.length} (${[...new Set(errors)].join('; ')})`);
  const unique = [...new Set(strains)];
  if (unique.length === 0) log('verdict: held');
  else log(`verdict: strained: ${unique.join('; ')}`);
  process.exit(unique.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
