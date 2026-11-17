// The own champion drawn where it is going on the planet (src/net/
// self_predict.ts over the Wanderseed's ground, src/net/walk_memory.ts;
// ADR 0028, ADR 0029): a real battle royale on the real planet served the
// way the server serves it (server/royale_match.ts answers the order
// numbers and builds the snapshots, which carry no path), to a mirror
// world through a connection that takes 250 ms each way (50 to 250, and
// ragged, where the walk itself is pinned). The champion answers a click
// on the next frame, walks around what blocks the way without a jump, is
// drawn where the server's champion will be once an order sent now lands,
// and ends where the server's champion ends, whatever the server did that
// the snapshots do not spell out.

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import { RoyaleMatch } from '../server/royale_match';
import type { RoyalePerson } from '../server/royale_seats';
import { ClientWorld } from '../src/net/client_world';
import type { ClientMsg, ServerMsg } from '../src/net/protocol';
import { dirTo, dist, offset, type Vec3 } from '../src/sim/geo';
import { planetGameMap } from '../src/sim/royale/planet_map';
import { DROP_S, PAD_FLIGHT_S, PAD_REACH_M, PAD_THROW_M } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { DT, type Vec2 } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { raiseWall } from '../src/sim/walls';
import { loadPlanet } from './royale_planet';

const FRAME_MS = 16;
const ONE_WAY_MS = 250;

interface Frame {
  at: number;
  drawn: Vec2;
  // Whether the prediction drew it (else the mirror's newest position).
  ahead: boolean;
  // The server's own champion at that moment, which the client never sees.
  server: Vec2;
}

function person(): RoyalePerson {
  return {
    clientId: 1,
    owner: 1,
    name: 'p1',
    guest: true,
    pick: { championId: 'dain', sigils: ['riftstep', 'mend'], skin: 0 },
  };
}

// A Respawn match on the Wanderseed on one side (one seat, or a second
// one with nobody playing it), a mirror world with the planet's ground and
// pads on the other, `oneWayMs` between them, and up to `jitterMs` more on
// each message, in order as a socket keeps them. One millisecond at a time:
// orders land, ticks run and send their snapshots, snapshots arrive,
// frames draw. Returned once landed and the play's snapshots arrive.
function served(seats = 1, oneWayMs = ONE_WAY_MS, seed = 11, jitterMs = 0) {
  const planet = loadPlanet();
  const match = new RoyaleMatch(1, seed, 'respawn', [person()], royaleFactory(loadPlanet), seats);
  const sim = match.sim as unknown as Sim;
  const seat = match.players.get(1)!;
  const champ = sim.units.get(seat.unitId)!;
  // A second seat stands where it is put: its bot is taken off.
  const other = [...sim.units.values()].find((u) => u.kind === 'champion' && u !== champ) ?? null;
  if (other) sim.detachPolicy(other.id);
  let now = 0;
  // The jitter, from a fixed sequence so a run repeats.
  let jitterSeed = 7;
  const delay = (after: number): number => {
    jitterSeed = (jitterSeed * 48271) % 2147483647;
    return Math.max(after, now + oneWayMs + Math.round((jitterSeed / 2147483647) * jitterMs));
  };
  let upLast = 0;
  let downLast = 0;
  const up: { at: number; msg: ClientMsg }[] = [];
  const down: { at: number; msg: ServerMsg }[] = [];
  const world = new ClientWorld(
    (msg) => {
      upLast = delay(upLast);
      up.push({ at: upLast, msg });
    },
    planetGameMap(planet.layout),
    { ground: planet.ground(), pads: planet.layout.pads },
    () => now,
  );
  world.applyServer({
    t: 'match_start',
    selfUnitId: champ.id,
    team: seat.team,
    royale: { v: 'respawn', seats: match.seatCount },
  });
  const frames: Frame[] = [];
  const sent: ClientMsg[] = [];
  // The server's champion at each tick, by the tick's time in ms.
  const ticks = new Map<number, Vec2>();
  // A hand on the server before the next tick: what the sim does that the
  // client cannot know.
  let meddle: ((u: Unit) => void) | null = null;
  let nextTick = 0;
  let nextFrame = 0;
  const run = (ms: number): void => {
    const end = now + ms;
    while (now < end) {
      now += 1;
      while (up.length > 0 && up[0]!.at <= now) {
        const msg = up.shift()!.msg;
        sent.push(msg);
        match.handleCommand(1, msg);
      }
      if (now >= nextTick) {
        nextTick += DT * 1000;
        if (meddle) {
          meddle(champ);
          meddle = null;
        }
        match.tick();
        ticks.set(Math.round(sim.time * 1000), { ...champ.pos });
        const snap = match.snapshotFor(1);
        if (snap) {
          downLast = delay(downLast);
          down.push({ at: downLast, msg: snap });
        }
      }
      while (down.length > 0 && down[0]!.at <= now) world.applyServer(down.shift()!.msg);
      if (now >= nextFrame) {
        nextFrame += FRAME_MS;
        const mirror = world.units.get(champ.id);
        if (!mirror) continue;
        const ahead = world.predictedPos(champ.id, now);
        frames.push({
          at: now,
          drawn: ahead
            ? { x: ahead.x, y: ahead.y, z: ahead.z }
            : { x: mirror.pos.x, y: mirror.pos.y, z: mirror.pos.z },
          ahead: ahead !== null,
          server: { ...champ.pos },
        });
      }
    }
  };
  // Where the server's champion stood at match time `ms` (its last tick).
  const serverAt = (ms: number): Vec2 | undefined => {
    const tick = Math.floor(ms / (DT * 1000)) * DT * 1000;
    return ticks.get(Math.round(tick));
  };
  run((DROP_S + 1) * 1000 + oneWayMs + jitterMs);
  return {
    sim,
    champ,
    other,
    world,
    run,
    frames,
    sent,
    serverAt,
    ticks,
    now: () => now,
    oneWayMs,
    // Before the next tick (the client hears of it a trip later).
    meddle: (fn: (u: Unit) => void) => {
      meddle = fn;
    },
    order: (p: Vec2) => world.orderMove(champ.id, p.x, p.z, p.y),
  };
}

type Served = ReturnType<typeof served>;

// A walkable point between `min` and `max` meters from `from` that no
// straight walk reaches: the way there goes around what blocks it, by at
// least `turns` waypoints.
function aroundFrom(from: Vec2, min: number, max: number, turns = 2): Vec3 {
  const planet = loadPlanet();
  const ground = planet.ground();
  for (const spot of planet.layout.caches) {
    const p = spot.at;
    const d = dist(from, p);
    if (d < min || d > max || !ground.isWalkableAt(p)) continue;
    if (ground.lineOfWalk(from, p)) continue;
    if (ground.findPath(from, p).length >= turns) return p;
  }
  throw new Error('no point around an obstacle near the champion');
}

const lastFrame = (frames: Frame[]): Frame => frames[frames.length - 1]!;
const firstAfter = (frames: Frame[], at: number): Frame => frames.find((f) => f.at > at)!;

// The most a frame may move the drawn champion: its walk over the frame,
// and a little for the ease working a correction out.
const frameStep = (speed: number): number => speed * (FRAME_MS / 1000) * 1.5 + 0.03;

// The farthest one frame moved the drawn champion, from `from` on.
function worstStep(frames: Frame[], from = 0): number {
  let worst = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i]!.at <= from) continue;
    worst = Math.max(worst, dist(frames[i]!.drawn, frames[i - 1]!.drawn));
  }
  return worst;
}

// The champion's walking pace on the server from match time `fromMs` on:
// its longest step between two ticks.
function pace(h: Served, fromMs: number): number {
  let fastest = 0;
  let last: Vec2 | undefined;
  for (const [ms, p] of h.ticks) {
    if (ms < fromMs) continue;
    if (last) fastest = Math.max(fastest, dist(last, p));
    last = p;
  }
  return fastest / DT;
}

// The drawn champion against where the server's champion stands once an
// order sent at that frame lands, half a trip on: the worst, over the
// frames from `from` on.
function worstLead(h: Served, from: number, upMs = h.oneWayMs): number {
  let worst = 0;
  for (const f of h.frames) {
    if (f.at < from || !f.ahead) continue;
    const there = h.serverAt(f.at + upMs);
    if (there) worst = Math.max(worst, dist(f.drawn, there));
  }
  return worst;
}

// A walkable point between `min` and `max` meters from `from` that a
// straight walk reaches.
function straightFrom(from: Vec2, min: number, max: number): Vec3 {
  const planet = loadPlanet();
  const ground = planet.ground();
  for (const spot of planet.layout.caches) {
    const p = spot.at;
    const d = dist(from, p);
    if (d >= min && d <= max && ground.isWalkableAt(p) && ground.lineOfWalk(from, p)) return p;
  }
  throw new Error('no point in a straight walk from the champion');
}

// The second seat set walking `ahead` meters in front of the champion, on
// toward a point a straight walk reaches, at `speed`; in sight of the
// champion once the snapshots tell it.
function foeWalkingAway(h: Served, ahead: number, speed: number): Unit {
  const foe = h.other!;
  const ground = loadPlanet().ground();
  const goal = straightFrom(h.champ.pos, 25, 60);
  const way = dirTo(h.champ.pos, goal)!;
  foe.pos = offset(h.champ.pos, way, ahead);
  foe.moveSpeed = speed;
  foe.path = ground.findPath(foe.pos, goal);
  return foe;
}

// A wall raised on the server as a cast raises one (src/sim/walls.ts):
// `ahead` meters along `way` from `from`, across it, `length` long.
function wallAcross(h: Served, from: Vec2, way: Vec2, ahead: number, length: number, s: number) {
  const ctx = (h.sim as unknown as { ctx(): CombatCtx }).ctx();
  raiseWall(ctx, 0, 1, offset(from, way, ahead), way, length, s);
}

// The drawn champion settled where the server's champion stands.
function endsWithServer(h: Served): void {
  const end = lastFrame(h.frames);
  expect(end.ahead).toBe(true);
  expect(dist(end.drawn, end.server)).toBeLessThan(0.01);
}

// And stays there: no walk the server dropped is walked again.
function staysSettled(h: Served): void {
  const settled = lastFrame(h.frames).drawn;
  h.run(2000);
  expect(dist(lastFrame(h.frames).drawn, settled)).toBeLessThan(0.01);
}

describe('the own champion on the planet, drawn where it is going', () => {
  it('answers a click on the next frame, a round trip before the server tells', () => {
    const h = served();
    const start = { ...h.champ.pos };
    const told = { ...h.world.units.get(h.champ.id)!.pos };
    h.order(aroundFrom(start, 15, 35));
    const clickAt = h.now();
    h.run(FRAME_MS * 2);
    const first = firstAfter(h.frames, clickAt);
    expect(first.ahead).toBe(true);
    expect(dist(first.drawn, start)).toBeGreaterThan(0.01);
    // The server's word has not come back yet.
    expect(dist(h.world.units.get(h.champ.id)!.pos, told)).toBe(0);
    // The order goes up numbered, its point on the sphere.
    h.run(ONE_WAY_MS);
    expect(h.sent[0]).toMatchObject({ t: 'move', n: 1 });
    expect((h.sent[0] as { y?: number }).y).toBeDefined();
  });

  // Each way, and the most a message waits beyond it: a near connection,
  // round trips up to 300 ms, and a far one with a ragged line.
  it.each([
    [50, 0],
    [100, 0],
    [150, 0],
    [150, 40],
    [250, 0],
    [250, 40],
  ])(
    'walks around what blocks the way without a jump over a %i ms trip each way (%i ms ragged), a trip ahead, and ends where the server ends',
    (oneWayMs, jitterMs) => {
      const h = served(1, oneWayMs, 11, jitterMs);
      const start = { ...h.champ.pos };
      const goal = aroundFrom(start, 15, 35);
      h.order(goal);
      const clickAt = h.now();
      const orderedAt = h.sim.time * 1000;
      h.run(20_000);
      const speed = pace(h, orderedAt);
      expect(speed).toBeGreaterThan(1);
      // Never a jump, the first click's included: before the first answer
      // the walk keeps its pace rather than catching up when it comes.
      expect(worstStep(h.frames, clickAt)).toBeLessThan(frameStep(speed));
      // Drawn where the server's champion stands once an order sent now
      // lands: half a trip on, within a tick's walk, and on a ragged line
      // within the walk over the time a message may wait beyond its trip.
      const settled = clickAt + 2 * (oneWayMs + jitterMs) + 200;
      const upMs = oneWayMs + jitterMs / 2;
      expect(worstLead(h, settled, upMs)).toBeLessThan(
        speed * DT * 2 + (speed * jitterMs) / 1000 + 0.05,
      );
      expect(dist(h.champ.pos, goal)).toBeLessThan(0.1);
      endsWithServer(h);
    },
  );

  it('takes a new order mid-walk on the next frame, and still never jumps', () => {
    const h = served();
    h.order(aroundFrom(h.champ.pos, 25, 50));
    const clickAt = h.now();
    const orderedAt = h.sim.time * 1000;
    h.run(2500);
    const drawn = lastFrame(h.frames).drawn;
    const goal = aroundFrom(drawn, 10, 30, 1);
    h.order(goal);
    const turnAt = h.now();
    h.run(20_000);
    const speed = pace(h, orderedAt);
    expect(worstStep(h.frames, clickAt)).toBeLessThan(frameStep(speed));
    // The turn shows at once: the next frames head for the new goal.
    const after = h.frames.filter((f) => f.at > turnAt).slice(0, 10);
    expect(dist(after[9]!.drawn, goal)).toBeLessThan(dist(drawn, goal));
    expect(worstLead(h, turnAt + 2 * ONE_WAY_MS + 200)).toBeLessThan(speed * DT * 2 + 0.05);
    expect(dist(h.champ.pos, goal)).toBeLessThan(0.1);
    endsWithServer(h);
  });

  it('stops on the next frame at a stop, where the server stops', () => {
    const h = served();
    h.order(aroundFrom(h.champ.pos, 15, 35));
    h.run(2500);
    h.world.orderStop(h.champ.id);
    const stopAt = h.now();
    const drawnAtStop = lastFrame(h.frames).drawn;
    h.run(3000);
    for (const f of h.frames) {
      if (f.at > stopAt + FRAME_MS) expect(dist(f.drawn, drawnAtStop)).toBeLessThan(0.15);
    }
    expect(dist(drawnAtStop, h.champ.pos)).toBeLessThan(0.6);
    endsWithServer(h);
    staysSettled(h);
  });

  it('lets go of the walk at a knock-up it could not know, eased, and ends where the server ends', () => {
    const h = served();
    h.order(aroundFrom(h.champ.pos, 25, 50));
    h.run(2000);
    // As the sim's knock-up does (src/sim/combat/effects.ts): thrown up,
    // the path dropped.
    h.meddle((u) => {
      u.statuses.push({ kind: 'airborne', until: h.sim.time + 0.5 });
      u.path = [];
    });
    const knockedAt = h.now();
    h.run(4000);
    // The champion walked on a trip ahead before the knock-up was told: it
    // is drawn going back over a few frames, never in one.
    expect(worstStep(h.frames, knockedAt)).toBeLessThan(0.45);
    endsWithServer(h);
    staysSettled(h);
  });

  it('lets go of a walk the server ended without a word, and ends where the server ends', () => {
    const h = served();
    h.order(aroundFrom(h.champ.pos, 25, 50));
    h.run(2000);
    h.meddle((u) => {
      u.path = [];
    });
    const stoppedAt = h.now();
    h.run(4000);
    expect(worstStep(h.frames, stoppedAt)).toBeLessThan(0.45);
    endsWithServer(h);
    staysSettled(h);
  });

  it('takes a blink the server made as the server put it down, and walks no more', () => {
    const h = served();
    const goal = aroundFrom(h.champ.pos, 25, 50);
    h.order(goal);
    h.run(2000);
    // As a blink does (src/sim/combat/casting.ts): put down ahead, the
    // path dropped.
    h.meddle((u) => {
      const ahead = offset(u.pos, dirTo(u.pos, u.path[0] ?? goal)!, 3);
      if (loadPlanet().ground().isWalkableAt(ahead)) u.pos = ahead;
      u.path = [];
    });
    h.run(4000);
    endsWithServer(h);
    staysSettled(h);
  });

  it('walks round a wall standing across the way as the server does, without a jump', () => {
    // A seed whose landing has a cache spot a straight walk away.
    const h = served(1, ONE_WAY_MS, 13);
    const goal = straightFrom(h.champ.pos, 15, 30);
    const way = dirTo(h.champ.pos, goal)!;
    h.meddle((u) => wallAcross(h, u.pos, way, 4, 8, 20));
    h.run(1000);
    expect(h.world.walls.size).toBe(1);
    h.order(goal);
    const clickAt = h.now();
    const orderedAt = h.sim.time * 1000;
    // The way round may be long: the wall can close a gap between rocks.
    h.run(30_000);
    const speed = pace(h, orderedAt);
    expect(worstStep(h.frames, clickAt)).toBeLessThan(frameStep(speed));
    // The way round the wall searched as the server searches it: drawn a
    // trip ahead all along.
    expect(worstLead(h, clickAt + 2 * ONE_WAY_MS + 200)).toBeLessThan(speed * DT * 2 + 0.05);
    expect(dist(h.champ.pos, goal)).toBeLessThan(0.1);
    endsWithServer(h);
  });

  it('stops at a wall raised across its walk where the server stops, never through it', () => {
    // A seed whose landing has a cache spot a straight walk away.
    const h = served(1, ONE_WAY_MS, 13);
    const goal = straightFrom(h.champ.pos, 20, 40);
    h.order(goal);
    h.run(1500);
    // Where the server's champion stood as the wall rose.
    const rose: { at: Vec2 | null } = { at: null };
    h.meddle((u) => {
      rose.at = { ...u.pos };
      wallAcross(h, u.pos, dirTo(u.pos, goal)!, 4, 12, 6);
    });
    h.run(DT * 1000);
    const raisedAt = h.now();
    h.run(3000);
    // The sim's walk stopped at the wall's face, its path dropped.
    expect(h.champ.path).toHaveLength(0);
    const from = rose.at!;
    const face = dist(from, h.champ.pos);
    expect(face).toBeGreaterThan(2);
    expect(face).toBeLessThan(4);
    // The drawing, a trip ahead when the wall rose, stopped there too
    // once told of it, never walked on through it.
    for (const f of h.frames) {
      if (f.at > raisedAt) expect(dist(from, f.drawn)).toBeLessThan(face + 0.1);
    }
    expect(worstStep(h.frames, raisedAt)).toBeLessThan(frameStep(h.champ.moveSpeed));
    endsWithServer(h);
    // The wall falls: the walk the sim dropped is not taken up again.
    h.run(4000);
    expect(h.world.walls.size).toBe(0);
    endsWithServer(h);
    staysSettled(h);
  });

  it('walks into range of what it attacks and stops there with the server', () => {
    const h = served(2);
    const foe = h.other!;
    const ground = loadPlanet().ground();
    // The foe stands a few steps off, in plain sight.
    const way = dirTo(h.champ.pos, aroundFrom(h.champ.pos, 15, 60, 1))!;
    let spot: Vec2 | null = null;
    for (let d = 7; d > 3 && !spot; d -= 0.5) {
      const p = offset(h.champ.pos, way, d);
      if (ground.isWalkableAt(p) && ground.lineOfWalk(h.champ.pos, p)) spot = p;
    }
    expect(spot).not.toBeNull();
    foe.pos = spot!;
    foe.path = [];
    h.run(1500);
    expect(h.world.units.has(foe.id)).toBe(true);
    const start = { ...h.champ.pos };
    h.world.orderAttack(h.champ.id, foe.id);
    const clickAt = h.now();
    h.run(FRAME_MS * 2);
    const first = firstAfter(h.frames, clickAt).drawn;
    expect(dist(first, foe.pos)).toBeLessThan(dist(start, foe.pos));
    h.run(4000);
    const end = lastFrame(h.frames);
    expect(dist(end.drawn, end.server)).toBeLessThan(0.05);
    const edge = dist(end.drawn, foe.pos) - h.champ.radius - foe.radius;
    expect(edge).toBeLessThanOrEqual(h.champ.stats.attackRange + 0.2);
  });

  it('chases a unit walking away without a hop at each snapshot that moves it', () => {
    const h = served(2);
    const foe = foeWalkingAway(h, 4, 2);
    h.run(1000);
    expect(h.world.units.has(foe.id)).toBe(true);
    h.world.orderAttack(h.champ.id, foe.id);
    const clickAt = h.now();
    h.run(6000);
    // Caught up, struck, walked on after it: the drawn champion moved
    // only at its pace, though the chased unit's every new position moves
    // where the chase goes.
    expect(worstStep(h.frames, clickAt)).toBeLessThan(frameStep(h.champ.moveSpeed));
    expect(h.champ.attackTargetId).toBe(foe.id);
  });

  it('walks on what is left of a chase the chased unit slipped out of, and ends where the server ends', () => {
    const h = served(2);
    const foe = foeWalkingAway(h, 6, 3.4);
    h.run(1000);
    h.world.orderAttack(h.champ.id, foe.id);
    h.run(1500);
    expect(h.champ.attackTargetId).toBe(foe.id);
    expect(h.champ.path.length).toBeGreaterThan(0);
    // Gone untargetable a few steps ahead: the sim lets the chase go and
    // the champion walks on to where its path was last searched.
    h.meddle(() => {
      foe.statuses.push({ kind: 'untargetable', until: h.sim.time + 10 });
    });
    const slipAt = h.now();
    h.run(200);
    expect(h.champ.attackTargetId).toBeNull();
    expect(h.champ.path.length).toBeGreaterThan(0);
    h.run(4000);
    expect(worstStep(h.frames, slipAt)).toBeLessThan(frameStep(h.champ.moveSpeed));
    // Drawn ahead along that walk, not stopped where the chase let go.
    expect(worstLead(h, slipAt + 2 * h.oneWayMs + 200)).toBeLessThan(
      h.champ.moveSpeed * DT * 2 + 0.05,
    );
    endsWithServer(h);
    staysSettled(h);
  });

  it('walks on through an attack on a unit it cannot strike, as the server does', () => {
    const h = served(2);
    const foe = h.other!;
    const goal = straightFrom(h.champ.pos, 20, 40);
    foe.pos = offset(h.champ.pos, dirTo(h.champ.pos, goal)!, -4);
    foe.path = [];
    foe.statuses.push({ kind: 'untargetable', until: h.sim.time + 30 });
    h.run(1000);
    expect(h.world.units.has(foe.id)).toBe(true);
    h.order(goal);
    const clickAt = h.now();
    const orderedAt = h.sim.time * 1000;
    h.run(1500);
    // The sim takes the attack and drops it at once: the walk goes on.
    h.world.orderAttack(h.champ.id, foe.id);
    h.run(10_000);
    const speed = pace(h, orderedAt);
    expect(worstStep(h.frames, clickAt)).toBeLessThan(frameStep(speed));
    expect(worstLead(h, clickAt + 2 * h.oneWayMs + 200)).toBeLessThan(speed * DT * 2 + 0.05);
    expect(dist(h.champ.pos, goal)).toBeLessThan(0.1);
    endsWithServer(h);
  });

  // What the walk got wrong is a trip's walk each way, slid out over a few
  // frames: a third of a meter a frame at most over a 300 ms round trip,
  // and never the jump of a move the server made over a 500 ms one.
  it.each([
    [150, 0.45],
    [250, 0.8],
  ])(
    'takes back an attack the server dropped as it landed over a %i ms trip each way, and walks on with the server',
    (oneWayMs, slide) => {
      const h = served(2, oneWayMs);
      const foe = h.other!;
      const goal = straightFrom(h.champ.pos, 25, 40);
      foe.pos = offset(h.champ.pos, dirTo(h.champ.pos, goal)!, -4);
      foe.path = [];
      h.run(1000);
      h.order(goal);
      const clickAt = h.now();
      const orderedAt = h.sim.time * 1000;
      h.run(1500);
      // Struck by nothing the client saw coming: untargetable by the time
      // the attack lands, so the sim drops it at once and the walk goes on.
      h.world.orderAttack(h.champ.id, foe.id);
      const attackAt = h.now();
      h.run(h.oneWayMs - 60);
      h.meddle(() => {
        foe.statuses.push({ kind: 'untargetable', until: h.sim.time + 30 });
      });
      h.run(10_000);
      expect(h.champ.attackTargetId).toBeNull();
      const speed = pace(h, orderedAt);
      // The trip it walked toward the unit is taken back over a few frames,
      // then it is drawn a trip ahead on the walk again.
      expect(worstStep(h.frames, clickAt)).toBeLessThan(slide);
      expect(worstLead(h, attackAt + 2 * h.oneWayMs + 600)).toBeLessThan(speed * DT * 2 + 0.05);
      expect(dist(h.champ.pos, goal)).toBeLessThan(0.1);
      endsWithServer(h);
    },
  );

  it("stands where a launch pad throws it, shows the server's flight, and takes over on landing", () => {
    const h = served();
    const planet = loadPlanet();
    const ground = planet.ground();
    // Set down a few steps from the nearest pad (the drop lands anywhere).
    const pad = [...planet.layout.pads].sort(
      (a, b) => dist(a.at, h.champ.pos) - dist(b.at, h.champ.pos),
    )[0]!;
    let near: Vec2 | null = null;
    for (let d = 8; d > 3 && !near; d -= 0.5) {
      for (const s of planet.layout.caches) {
        const p = offset(pad.at, dirTo(pad.at, s.at)!, d);
        if (ground.isWalkableAt(p) && ground.lineOfWalk(p, pad.at)) {
          near = p;
          break;
        }
      }
    }
    expect(near).not.toBeNull();
    h.meddle((u) => {
      u.pos = { ...near! };
      u.path = [];
    });
    h.run(1500);
    const before = h.frames.length;
    h.order(pad.at);
    h.run(5000 + PAD_FLIGHT_S * 1000);
    const frames = h.frames.slice(before);
    const firstRest = frames.findIndex((f) => !f.ahead);
    expect(firstRest).toBeGreaterThan(0);
    const back = frames.findIndex((f, i) => i > firstRest && f.ahead);
    expect(back).toBeGreaterThan(firstRest);
    // Up where the server threw it: the drawn champion stood there, inside
    // the pad's reach, and the flight starts from that very point.
    const thrownAt = frames[firstRest - 1]!.drawn;
    expect(dist(thrownAt, pad.at)).toBeLessThanOrEqual(PAD_REACH_M);
    expect(dist(frames[firstRest]!.drawn, thrownAt)).toBeLessThan(0.05);
    // Down where the pad sends it: taken over at the landing point, the
    // flight's own last step away from its last drawn tick, and standing.
    const flightStep = (PAD_THROW_M / PAD_FLIGHT_S) * DT + 0.05;
    expect(dist(frames[back]!.drawn, pad.to)).toBeLessThan(0.01);
    expect(dist(frames[back]!.drawn, frames[back - 1]!.drawn)).toBeLessThan(flightStep);
    for (const f of frames.slice(back, back + 20)) {
      expect(dist(f.drawn, pad.to)).toBeLessThan(0.01);
    }
    expect(dist(h.champ.pos, pad.to)).toBeLessThan(0.01);
    endsWithServer(h);
  });
});
