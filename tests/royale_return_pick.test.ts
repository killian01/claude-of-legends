// A Respawn return at the seat's own pick (src/sim/royale/return_pick.ts;
// CONTEXT.md: Respawn): the pick brought inside the light the return comes
// back to, at least RETURN_CLEAR_M from every champion standing, the
// nearest such point; with none near it, the edge of the light as before.
// Taken through Sim.pickDrop only while dead in Respawn's play, spent by
// the return, a command recorded and replayed like the drop's, asked of a
// dead bot through the dead decision, read in the seat's own observation
// and sent on the wire to its own seat only.

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import { RoyaleMatch } from '../server/royale_match';
import type { RoyalePerson } from '../server/royale_seats';
import { applyReplayEvent, loadRoyaleReplay } from '../src/net/replay';
import { runBotDecisions } from '../src/sim/bot_driver';
import { attachRoyaleBot } from '../src/sim/content/bots/royale';
import { DUSK_PHASES } from '../src/sim/content/dusk';
import { dist, type Vec3 } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { arrivalDepth, deepInLight } from '../src/sim/royale/drop';
import { depthInside, insideCap } from '../src/sim/royale/dusk';
import {
  INTO_MARGIN_M,
  intoLight,
  RETURN_CLEAR_M,
  RETURN_RING_M,
  RETURN_RINGS,
  returnSpot,
  takesReturnPick,
  towardOnCircle,
} from '../src/sim/royale/return_pick';
import { returnCap } from '../src/sim/royale/score';
import { DROP_S, type DuskCap, RESPAWN_S } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { fakeSnap, landed } from './royale_contract_fixture';
import { fakeGround, fakeLayout, R, sph } from './royale_fixture';
import { loadPlanet } from './royale_planet';

const layout = fakeLayout();
const len = (p: Vec3): number => Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);

describe('the way into the light', () => {
  it('walks the great circle from the center toward the pick, a chord d long', () => {
    const c = sph(1, 0.2, 0);
    const p = sph(0.3, 0.9, 0.4);
    for (const d of [0, 5, 30, 70]) {
      const q = towardOnCircle(c, p, d, R);
      expect(len(q)).toBeCloseTo(R, 9);
      expect(dist(c, q)).toBeCloseTo(d, 9);
      expect(dist(q, p)).toBeLessThan(dist(c, p) + 1e-9);
    }
    // Nowhere to head when the pick is the center.
    expect(towardOnCircle(c, c, 10, R)).toEqual(c);
  });

  it('keeps a pick deep in the light, and brings one outside it just past the depth', () => {
    const cap: DuskCap = { center: sph(1, 0, 0), radius: 40 };
    const inside = sph(1, 0.1, 0.1);
    expect(intoLight(inside, cap, R)).toBe(inside);
    const outside = sph(0, 1, 0.3);
    const q = intoLight(outside, cap, R);
    expect(deepInLight(cap, q, R)).toBe(true);
    expect(depthInside(cap, q)).toBeCloseTo(arrivalDepth(cap, R) + INTO_MARGIN_M, 6);
    // The whole planet's light (the calm) holds any pick.
    const calm: DuskCap = { center: sph(1, 0, 0), radius: 2 * R };
    expect(intoLight(outside, calm, R)).toBe(outside);
  });
});

describe('the return at a pick', () => {
  const cap: DuskCap = { center: sph(1, 0, 0), radius: 60 };

  it('comes back on the pick itself when it is deep in the light and clear', () => {
    const pick = sph(1, 0.2, 0.1);
    const far = [sph(-1, 0, 0), sph(1, -0.5, 0)];
    expect(returnSpot(pick, cap, far, layout, fakeGround)).toEqual(pick);
  });

  it('steps off a champion on the pick, the nearest ring that clears everyone', () => {
    const pick = sph(1, 0.2, 0.1);
    const on = [pick, sph(1, 0.3, 0.1)];
    const at = returnSpot(pick, cap, on, layout, fakeGround)!;
    expect(at).not.toBeNull();
    for (const c of on) expect(dist(at, c)).toBeGreaterThanOrEqual(RETURN_CLEAR_M);
    expect(deepInLight(cap, at, R)).toBe(true);
    expect(dist(at, pick)).toBeLessThanOrEqual(RETURN_RINGS * RETURN_RING_M + 1);
    // The nearest ring: 10 m off one champion on the pick is 4 rings of 3 m.
    expect(dist(at, pick)).toBeLessThan(RETURN_CLEAR_M + 2 * RETURN_RING_M);
  });

  it('brings a pick in the dark into the light it comes back to', () => {
    const pick = sph(-1, 0.3, 0);
    const at = returnSpot(pick, cap, [], layout, fakeGround)!;
    expect(insideCap(cap, at)).toBe(true);
    expect(depthInside(cap, at)).toBeGreaterThanOrEqual(arrivalDepth(cap, R));
  });

  it('snaps a pick in the lake to the ground beside it', () => {
    const lake = sph(0.15, 0, 1);
    const wide: DuskCap = { center: lake, radius: 2 * R };
    const at = returnSpot(lake, wide, [], layout, fakeGround)!;
    expect(fakeGround.walkable(at)).toBe(true);
    expect(dist(at, lake)).toBeLessThan(10);
  });

  it('gives nothing when the light holds no point clear of everyone', () => {
    const small: DuskCap = { center: sph(1, 0, 0), radius: 8 };
    expect(returnSpot(sph(1, 0, 0), small, [sph(1, 0, 0)], layout, fakeGround)).toBeNull();
  });
});

describe('who picks where they come back', () => {
  it('is a dead champion in Respawn play, never the living, One life or the drop', () => {
    expect(takesReturnPick('respawn', 'play', true)).toBe(true);
    expect(takesReturnPick('respawn', 'play', false)).toBe(false);
    expect(takesReturnPick('one_life', 'play', true)).toBe(false);
    expect(takesReturnPick('respawn', 'drop', true)).toBe(false);
    expect(takesReturnPick('respawn', 'over', true)).toBe(false);
  });

  it('takes the pick through the sim only from a dead Respawn seat, the last one winning', () => {
    const { sim, unitIds } = landed('respawn');
    const u = sim.units.get(unitIds[1]!)!;
    const spot = { ...(u.pos as Vec3) };
    expect(sim.pickDrop(u.id, spot)).toBe(false);
    u.dead = true;
    expect(sim.pickDrop(u.id, { x: Number.NaN, y: 0, z: 0 })).toBe(false);
    expect(sim.pickDrop(u.id, { x: 0, y: 80, z: 0 })).toBe(true);
    expect(sim.pickDrop(u.id, spot)).toBe(true);
    expect(dist(sim.royale!.respawnPicks.get(u.id)!, spot)).toBeLessThan(1e-6);
    // The seat reads its own pick back, as the drop's.
    expect(buildObservation(sim, u.id)!.royale!.drop).toEqual(sim.royale!.respawnPicks.get(u.id));
    const one = landed('one_life').sim;
    const v = [...one.units.values()][1]!;
    v.dead = true;
    expect(one.pickDrop(v.id, spot)).toBe(false);
    expect(one.royale!.respawnPicks.size).toBe(0);
  });
});

// Kills a champion in place: down, coming back `after` seconds from now.
function down(sim: Sim, id: number, after = 1): void {
  const u = sim.units.get(id)!;
  u.dead = true;
  u.hp = 0;
  u.respawnAt = sim.time + after;
}

function untilBack(sim: Sim, id: number): void {
  const u = sim.units.get(id)!;
  for (let i = 0; i < 200 && u.dead; i++) sim.tick();
  expect(u.dead).toBe(false);
}

describe('a Respawn return', () => {
  it('comes back at its pick, the pick spent; the next return, unpicked, at the edge', () => {
    const { sim, unitIds } = landed('respawn');
    const mode = sim.royaleMode!;
    const [a, b] = [unitIds[0]!, unitIds[1]!];
    // A pick 30 m from where the seat stands, on walkable ground.
    const from = sim.units.get(a)!.pos as Vec3;
    let pick: Vec3 | null = null;
    for (const c of mode.layout.cacheSpots) {
      const d = dist(c.pos, from);
      const clear = [...sim.units.values()].every(
        (o) => o.id === b || dist(c.pos, o.pos as Vec3) > 2 * RETURN_CLEAR_M,
      );
      if (d > 20 && d < 60 && clear && mode.ground.walkable(c.pos)) {
        pick = c.pos;
        break;
      }
    }
    expect(pick).not.toBeNull();
    down(sim, b);
    expect(sim.pickDrop(b, pick!)).toBe(true);
    untilBack(sim, b);
    const u = sim.units.get(b)!;
    expect(dist(u.pos as Vec3, pick!)).toBeLessThan(0.5);
    expect(mode.tally.returnsPicked).toBe(1);
    expect(mode.state.respawnPicks.has(b)).toBe(false);
    // Comes back in its Grace like any return.
    expect(mode.state.arriving.has(b)).toBe(true);
    down(sim, b);
    untilBack(sim, b);
    expect(mode.tally.returnsPicked).toBe(1);
    expect(dist(u.pos as Vec3, pick!)).toBeGreaterThan(1);
  });

  it('never comes back within reach of a champion standing on the pick', () => {
    const { sim, unitIds } = landed('respawn');
    const [a, b] = [unitIds[0]!, unitIds[1]!];
    const foe = sim.units.get(a)!.pos as Vec3;
    down(sim, b);
    sim.pickDrop(b, foe);
    untilBack(sim, b);
    for (const o of sim.units.values()) {
      if (o.id === b || o.dead) continue;
      expect(dist(sim.units.get(b)!.pos as Vec3, o.pos as Vec3)).toBeGreaterThanOrEqual(
        RETURN_CLEAR_M,
      );
    }
    expect(sim.royaleMode!.tally.returnsPicked).toBe(1);
  });

  it('comes back inside the light it closes to, a pick in the dark brought in', () => {
    const { sim, unitIds } = landed('respawn');
    const mode = sim.royaleMode!;
    while (sim.time < DROP_S + DUSK_PHASES[0]!.closeFrom + 30) sim.tick();
    const d = mode.state.dusk;
    expect(d.shrinking).toBe(true);
    const cap = returnCap(d);
    // The pick: the far side of the planet from the light it closes to.
    const c = cap.center;
    const dark = { x: -c.x, y: -c.y, z: -c.z };
    const id = unitIds[2]!;
    down(sim, id);
    expect(sim.pickDrop(id, dark)).toBe(true);
    untilBack(sim, id);
    const at = sim.units.get(id)!.pos as Vec3;
    expect(insideCap(mode.state.dusk.next!, at)).toBe(true);
    expect(deepInLight(mode.state.dusk.next!, at, mode.layout.radius)).toBe(true);
    expect(mode.tally.returnsPicked).toBe(1);
  });
});

describe('a seat taken while it waits', () => {
  it('drops the pick its bot made: the Arrival comes down on its own rule', () => {
    const { sim, unitIds } = landed('respawn');
    const id = unitIds[2]!;
    down(sim, id, RESPAWN_S);
    expect(sim.pickDrop(id, sim.units.get(unitIds[0]!)!.pos as Vec3)).toBe(true);
    sim.beginArrival(id);
    expect(sim.units.get(id)!.dead).toBe(false);
    expect(sim.royale!.respawnPicks.has(id)).toBe(false);
  });
});

function person(clientId: number): RoyalePerson {
  return {
    clientId,
    owner: clientId,
    name: `p${clientId}`,
    guest: true,
    pick: { championId: 'dain', sigils: ['riftstep', 'mend'], skin: 0 },
  };
}

describe('the pick as a command', () => {
  it('is recorded only while dead, and a replay comes back at the same spot', () => {
    const match = new RoyaleMatch(1, 21, 'respawn', [person(1)], royaleFactory(loadPlanet), 8);
    const sim = match.sim as unknown as Sim;
    const self = match.players.get(1)!.unitId;
    while (sim.time < DROP_S + 2) match.tick();
    const u = sim.units.get(self)!;
    const cmds = () => match.replayRecord()!.events.filter((e) => e.c?.t === 'drop').length;
    const before = cmds();
    // Standing: not taken, not recorded.
    match.pickDrop(1, u.pos.x, u.pos.y, u.pos.z);
    expect(cmds()).toBe(before);
    expect(sim.royale!.respawnPicks.size).toBe(0);
    // Down: a pick 25 m off, recorded.
    let pick: Vec3 | null = null;
    for (const c of (sim.royaleMode!.layout.cacheSpots ?? []).map((s) => s.pos)) {
      const d = dist(c, u.pos as Vec3);
      if (d > 20 && d < 40 && sim.royaleMode!.ground.walkable(c)) {
        pick = c;
        break;
      }
    }
    expect(pick).not.toBeNull();
    down(sim, self, RESPAWN_S);
    match.pickDrop(1, pick!.x, pick!.y, pick!.z);
    expect(cmds()).toBe(before + 1);
    const trail: number[] = [];
    while (u.dead) {
      match.tick();
      trail.push(sim.checksum());
    }
    for (let i = 0; i < 20; i++) {
      match.tick();
      trail.push(sim.checksum());
    }
    const landedAt = { ...(u.pos as Vec3) };
    const live = match.replayRecord()!;
    const record = { ...live, picks: [...live.picks] };
    const replay = (events: typeof record.events) => {
      const r = loadRoyaleReplay(loadPlanet(), record)!;
      const teams = new Map<number, number>();
      for (const x of r.sim.units.values()) teams.set(x.id, x.team);
      const queue = [...events];
      const out: number[] = [];
      while (r.sim.tickCount < record.ticks) {
        // The death set down by hand above, at the same tick.
        if (r.sim.tickCount === killTick) down(r.sim, self, RESPAWN_S);
        while (queue.length > 0 && queue[0]!.k === r.sim.tickCount) {
          applyReplayEvent(r.sim, teams, queue.shift()!);
        }
        r.sim.tick();
        out.push(r.sim.checksum());
      }
      return r.sim;
    };
    const killTick = live.events.filter((e) => e.c?.t === 'drop').at(-1)!.k;
    const again = replay(record.events);
    expect(again.checksum()).toBe(sim.checksum());
    expect(dist(again.units.get(self)!.pos as Vec3, landedAt)).toBeLessThan(1e-9);
    const without = replay(record.events.filter((e) => !(e.c?.t === 'drop' && e.k >= killTick)));
    expect(dist(without.units.get(self)!.pos as Vec3, landedAt)).toBeGreaterThan(1);
  }, 60_000);
});

describe('a dead bot', () => {
  it('is asked where it comes back until it picks, in Respawn only', () => {
    const { sim, unitIds } = landed('respawn');
    const mode = sim.royaleMode!;
    const id = unitIds[1]!;
    sim.pickGraft(id, 0);
    expect(mode.wantsDeadDecision(id)).toBe(true);
    sim.units.get(id)!.dead = true;
    sim.pickDrop(id, sim.units.get(unitIds[0]!)!.pos as Vec3);
    expect(mode.wantsDeadDecision(id)).toBe(false);
    const one = landed('one_life').sim;
    const v = [...one.units.values()][1]!;
    one.pickGraft(v.id, 0);
    expect(one.royaleMode!.wantsDeadDecision(v.id)).toBe(false);
  });

  it('picks beside a Seedfall landing as it comes back, and returns there clear of everyone', () => {
    const { sim, unitIds } = landed('respawn');
    const mode = sim.royaleMode!;
    const id = unitIds[3]!;
    attachRoyaleBot(sim, id);
    sim.pickGraft(id, 0);
    // A Seedfall called to land as the bot comes back, 30 m from a seat.
    const near = sim.units.get(unitIds[0]!)!.pos as Vec3;
    let at: Vec3 | null = null;
    for (const c of mode.layout.cacheSpots) {
      const d = dist(c.pos, near);
      if (d > 25 && d < 45 && mode.ground.walkable(c.pos)) {
        at = c.pos;
        break;
      }
    }
    expect(at).not.toBeNull();
    down(sim, id, RESPAWN_S);
    sim.royale!.seedfalls.push({
      id: 1,
      pos: at!,
      announcedAt: sim.time,
      landsAt: sim.time + RESPAWN_S + 2,
      landed: false,
      cacheId: null,
    });
    const u = sim.units.get(id)!;
    for (let i = 0; i < 20 && !mode.state.respawnPicks.has(id); i++) {
      sim.tickCount++;
      runBotDecisions(sim, sim.policies);
    }
    expect(mode.state.respawnPicks.has(id)).toBe(true);
    expect(dist(mode.state.respawnPicks.get(id)!, at!)).toBeLessThan(1);
    untilBack(sim, id);
    expect(mode.tally.returnsPicked).toBe(1);
    expect(dist(u.pos as Vec3, at!)).toBeLessThan(RETURN_CLEAR_M + RETURN_RINGS * RETURN_RING_M);
    for (const o of sim.units.values()) {
      if (o.id === id || o.dead) continue;
      expect(dist(u.pos as Vec3, o.pos as Vec3)).toBeGreaterThanOrEqual(RETURN_CLEAR_M);
    }
  });
});

describe('the wire', () => {
  it('sends the own pick to its seat while it waits, and nobody else', () => {
    const { sim, self, snap } = fakeSnap();
    sim.royale.stage = 'play';
    expect(snap().royale).not.toHaveProperty('bk');
    sim.royale.respawnPicks.set(self.id + 1, { x: 0, y: 80, z: 0 });
    expect(snap().royale).not.toHaveProperty('bk');
    sim.royale.respawnPicks.set(self.id, { x: 1.234, y: 79.987, z: 0 });
    expect(snap().royale!.bk).toEqual([1.23, 79.99, 0]);
  });
});
