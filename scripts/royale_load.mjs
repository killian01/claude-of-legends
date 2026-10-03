// People and no browser in a battle royale (ADR 0031): a load test for the
// game server's mode. Each client is a Guest (POST /api/guest) on a
// WebSocket speaking the wire protocol (src/net/protocol.ts): it enters the
// variant, picks a landing point during the drop, then walks the planet,
// attacks what it sees and casts at it, like a restless hand. It measures
// what it receives (snapshots per second, bytes per second, the longest gap
// between two snapshots, the champions in sight, the mode's block) and the
// server's own numbers from /healthz (the tick meter, server/tick_meter.ts).
// One line every five seconds, a verdict at the end; exit 1 when the server
// strained.
//
// Against the local stack (the server itself, not the Vite proxy):
//   URL=http://localhost:8787 node scripts/royale_load.mjs
// Knobs: N clients (1), V the variant (respawn), DURATION seconds (180),
// ORDER_MS between a client's orders (300), DEFLATE=1 to ask the server for
// per-message deflate (it is off on this server; the numbers then say what
// it would save).

import WebSocket from 'ws';

const ORIGIN = (process.env.URL ?? 'http://localhost:8787').replace(/\/$/, '');
const N = Number(process.env.N ?? 1);
const VARIANT = process.env.V === 'one_life' ? 'one_life' : 'respawn';
const DURATION = Number(process.env.DURATION ?? 180);
const ORDER_MS = Number(process.env.ORDER_MS ?? 300);
const DEFLATE = process.env.DEFLATE === '1';
const REPORT_MS = 5000;
const RADIUS = 80;
const STARTERS = ['torv', 'fenn', 'ashvyn', 'sylra'];
const KEYS = ['Q', 'W', 'E'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[royale ${new Date().toISOString().slice(11, 19)}]`, ...a);

// A point on the sphere `d` meters from `p` toward a random tangent.
function stepFrom(p, d) {
  const r = Math.hypot(p.x, p.y, p.z) || RADIUS;
  const n = { x: p.x / r, y: p.y / r, z: p.z / r };
  let t = { x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 };
  const k = t.x * n.x + t.y * n.y + t.z * n.z;
  t = { x: t.x - k * n.x, y: t.y - k * n.y, z: t.z - k * n.z };
  const tl = Math.hypot(t.x, t.y, t.z) || 1;
  const q = { x: p.x + (t.x / tl) * d, y: p.y + (t.y / tl) * d, z: p.z + (t.z / tl) * d };
  const ql = Math.hypot(q.x, q.y, q.z);
  return { x: (q.x / ql) * RADIUS, y: (q.y / ql) * RADIUS, z: (q.z / ql) * RADIUS };
}

function randomPoint() {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return { x: RADIUS * s * Math.cos(a), y: RADIUS * u, z: RADIUS * s * Math.sin(a) };
}

async function guestCookie() {
  const res = await fetch(`${ORIGIN}/api/guest`, { method: 'POST' });
  const cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('loc_guest='));
  if (!res.ok || !cookie) throw new Error(`guest: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { cookie: cookie.split(';')[0], name: body.name };
}

class Client {
  constructor(n, cookie, name) {
    this.n = n;
    this.name = name;
    this.ws = new WebSocket(`${ORIGIN.replace(/^http/, 'ws')}/ws`, {
      headers: { cookie, origin: ORIGIN },
      perMessageDeflate: DEFLATE,
    });
    this.self = 0;
    this.pos = null;
    this.seen = new Map();
    this.snaps = 0;
    this.bytes = 0;
    this.lastSnapAt = 0;
    this.maxGap = 0;
    this.inSight = 0;
    this.royale = null;
    this.results = [];
    this.starts = 0;
    this.points = 0;
    this.errors = [];
    this.ws.on('message', (data) => this.onMessage(data));
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(data) {
    const text = data.toString();
    this.bytes += text.length;
    const msg = JSON.parse(text);
    switch (msg.t) {
      case 'match_start':
        this.self = msg.selfUnitId;
        this.starts += 1;
        this.seen.clear();
        // The drop: a landing point anywhere on the globe.
        this.send({ t: 'drop', ...randomPoint() });
        break;
      case 'snap': {
        const now = performance.now();
        if (this.lastSnapAt > 0) this.maxGap = Math.max(this.maxGap, now - this.lastSnapAt);
        this.lastSnapAt = now;
        this.snaps += 1;
        for (const id of msg.gone) this.seen.delete(id);
        for (const u of msg.units) {
          const had = this.seen.get(u.i) ?? {};
          this.seen.set(u.i, { ...had, ...u });
          if (u.i === this.self && u.y !== undefined) this.pos = { x: u.x, y: u.y, z: u.z };
        }
        this.inSight = [...this.seen.values()].filter((u) => u.k === 'champion').length;
        if (msg.royale) this.royale = msg.royale;
        break;
      }
      case 'probe':
        this.send({ t: 'probe', n: msg.n });
        break;
      case 'royale_result':
        this.results.push(msg);
        // One life's end screen: Play again.
        if (msg.v === 'one_life') this.enter();
        break;
      case 'points':
        this.points = msg.total;
        break;
      case 'error':
        this.errors.push(msg.message);
        break;
      default:
        break;
    }
  }

  enter() {
    const championId = STARTERS[this.n % STARTERS.length];
    this.send({ t: 'royale', v: VARIANT, championId, sigils: ['riftstep', 'mend'], skin: 0 });
  }

  act() {
    if (!this.pos || this.royale?.st !== 'play') return;
    const enemy = [...this.seen.values()].find(
      (u) => u.k === 'champion' && u.i !== this.self && u.d !== 1 && u.y !== undefined,
    );
    if (enemy && Math.random() < 0.6) {
      const at = { x: enemy.x, y: enemy.y, z: enemy.z };
      if (Math.random() < 0.3) {
        const key = KEYS[Math.floor(Math.random() * KEYS.length)];
        this.send({ t: 'cast', key, ...at });
      } else this.send({ t: 'attack', targetId: enemy.i });
      return;
    }
    this.send({ t: 'move', ...stepFrom(this.pos, 6 + Math.random() * 10) });
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
  log(`${N} Guest(s) into ${VARIANT} against ${ORIGIN}`);
  const clients = [];
  for (let i = 0; i < N; i++) {
    const { cookie, name } = await guestCookie();
    const c = new Client(i, cookie, name);
    await c.open();
    c.send({ t: 'hello' });
    c.enter();
    clients.push(c);
    await sleep(200);
  }
  const started = performance.now();
  const timers = clients.map((c) => setInterval(() => c.act(), ORDER_MS));
  let lastBytes = clients.map(() => 0);
  let lastSnaps = clients.map(() => 0);
  const ticks = [];
  while (performance.now() - started < DURATION * 1000) {
    await sleep(REPORT_MS);
    const tick = await serverTick();
    if (tick) ticks.push(tick);
    const rates = clients.map((c, i) => {
      const r = {
        kbps: Math.round((c.bytes - lastBytes[i]) / (REPORT_MS / 1000) / 100) / 10,
        sps: Math.round((c.snaps - lastSnaps[i]) / (REPORT_MS / 1000)),
      };
      return r;
    });
    lastBytes = clients.map((c) => c.bytes);
    lastSnaps = clients.map((c) => c.snaps);
    const c0 = clients[0];
    log(
      `client kB/s ${rates.map((r) => r.kbps).join(' ')}, snaps/s ${rates.map((r) => r.sps).join(' ')}, ` +
        `gap max ${Math.round(c0.maxGap)} ms, in sight ${c0.inSight}, ` +
        `stage ${c0.royale?.st ?? '-'} alive ${c0.royale?.alive ?? '-'} people ${c0.royale?.people ?? '-'}` +
        (tick
          ? `; server avg ${tick.avgMs} ms max ${tick.maxMs} ms late ${tick.late}, ${Math.round(tick.bytesPerSecond / 1000)} kB/s out`
          : ''),
    );
  }
  for (const t of timers) clearInterval(t);
  const secs = (performance.now() - started) / 1000;
  const avg = ticks.length ? ticks.reduce((s, t) => s + t.avgMs, 0) / ticks.length : 0;
  const worst = ticks.length ? Math.max(...ticks.map((t) => t.maxMs)) : 0;
  const late = ticks.reduce((s, t) => s + t.late, 0);
  log(
    `verdict: ${clients.map((c) => `${Math.round(c.bytes / secs / 100) / 10} kB/s`).join(', ')} per client; ` +
      `server tick avg ${Math.round(avg * 100) / 100} ms, worst ${worst} ms, late ${late}; ` +
      `matches entered ${clients.map((c) => c.starts).join(' ')}, results ${clients.map((c) => c.results.length).join(' ')}, ` +
      `points ${clients.map((c) => c.points).join(' ')}` +
      (clients.some((c) => c.errors.length)
        ? `; errors ${clients.flatMap((c) => c.errors).join(' | ')}`
        : ''),
  );
  for (const c of clients) {
    c.send({ t: 'leave' });
    c.ws.close();
  }
  process.exit(avg > 25 || late > 20 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
