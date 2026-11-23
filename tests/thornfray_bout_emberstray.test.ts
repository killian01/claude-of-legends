// Emberstray (CONTEXT.md: Emberstray, Glow; docs/design/emberstray.md), on
// the real Wanderseed through the one construction (src/net/replay.ts
// buildBoutSim): the Glow's route drawn at landing, resting 12 s and
// drifting at 2 m/s, every stop within its roam, its whole ring in the
// light to the clock and on walkable ground, on every region; the held-time
// count (every champion standing in it counts, the holder the nearest its
// heart); the tend errand to its heart; a bot in the Glow still fights an
// enemy beside it; one closing as phase 5 and the light held to 115 s;
// eight house bots played to its clock at 100 s, the ranking total and by
// the count; no Seedfall, Rising, camp, pad, mark, Burr, Last light,
// Upstart or Graft; a replay that plays the bout it recorded.

import { describe, expect, it } from 'vitest';
import { loadRoyaleReplay, royaleReplayPlayable } from '../src/net/replay';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { EMBERSTRAY } from '../src/sim/content/bouts/emberstray';
import { dist, heading, type Vec3 } from '../src/sim/geo';
import type { ObsGoal } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import { tendCall } from '../src/sim/royale/bot/bout_calls';
import type { Sense } from '../src/sim/royale/bot/sense';
import { boutResult } from '../src/sim/royale/bouts/end';
import {
  GLOW_DRIFT_MPS,
  GLOW_GOAL_ID,
  GLOW_MAX_LEG_M,
  GLOW_MIN_LEG_M,
  GLOW_RADIUS_M,
  GLOW_REST_S,
  GLOW_ROAM_M,
  GLOW_STOPS,
  glowAt,
  glowRoute,
} from '../src/sim/royale/bouts/goal_emberstray';
import { boutSeed, drawBouts } from '../src/sim/royale/bouts/ledger';
import { boutPlan, thornyardOf } from '../src/sim/royale/bouts/plan';
import { DARK_PHASE, depthInside, drawDusk, duskAt } from '../src/sim/royale/dusk';
import { along, REGION_IDS } from '../src/sim/royale/layout';
import { royaleGround } from '../src/sim/royale/mode';
import { royaleLayoutOf } from '../src/sim/royale/planet_map';
import { DROP_S } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { loadPlanet } from './royale_planet';
import { type BoutArgs, boutReplay, buildBout, land, playOut } from './thornfray_fixture';

const planet = loadPlanet();
const layout = royaleLayoutOf(planet.layout);
const ground = royaleGround(planet.ground());

function firstBout(seed: number): BoutArgs {
  const region = drawBouts(seed, [EMBERSTRAY])[0]!.region;
  return { kind: EMBERSTRAY, matchSeed: seed, seed: boutSeed(seed, 0), index: 0, region };
}

function idle(sim: Sim, unitIds: readonly number[]): void {
  for (const id of unitIds) sim.policies.delete(id);
}

function standAt(u: Unit, p: Vec3): void {
  u.pos = { ...p };
  u.path = [];
}

function routeOf(sim: Sim): Vec3[] {
  const slot = sim.royale!.bout!.goals.find((g) => g.id === GLOW_GOAL_ID)!;
  return glowRoute(slot.nums);
}

// The points of a ring of the Glow: its heart and 12 headings at half its
// radius and at its radius.
function ringPoints(at: Vec3, R: number): Vec3[] {
  const out: Vec3[] = [at];
  for (const share of [0.5, 1]) {
    for (let k = 0; k < 12; k++) {
      out.push(along(at, heading(at, (k * Math.PI) / 6) as Vec3, share * GLOW_RADIUS_M, R));
    }
  }
  return out;
}

describe('the Emberstray Dusk', () => {
  it('lights the Thornyard to 65 s, closes once to 34 m as phase 5 and holds the light to 115 s', () => {
    for (const region of REGION_IDS) {
      const yard = thornyardOf(layout, region, EMBERSTRAY.thornyard.radius);
      const plan = boutPlan(EMBERSTRAY, yard);
      expect(plan.dusk.lightOutS).toBe(115);
      expect(plan.playS).toBe(100);
      for (let seed = 1; seed <= 5; seed++) {
        const s = drawDusk(new Rng(seed), layout, ground, DROP_S, plan.dusk);
        expect(s.caps.map((c) => c.radius)).toEqual([40, 34]);
        const at = (t: number) => duskAt(s, DROP_S + t);
        expect(at(0)).toMatchObject({ phase: 0, burn: 0.04, now: s.caps[0] });
        expect(at(64.9).phase).toBe(0);
        expect(at(65)).toMatchObject({ phase: 5, shrinking: true, burn: 0.06 });
        expect(at(80).now.radius).toBe(34);
        expect(at(114.9).phase).toBe(5);
        expect(at(115).phase).toBe(DARK_PHASE);
      }
    }
  });
});

describe('the Glow', () => {
  it('rests at the heart, then roams its stops, lit to the clock and on walkable ground, on both its regions', () => {
    let walkable = 0;
    let points = 0;
    let legs = 0;
    let inBounds = 0;
    for (const region of EMBERSTRAY.thornyard.regions!) {
      for (let seed = 1; seed <= 4; seed++) {
        const { sim } = buildBout({ kind: EMBERSTRAY, region, seed: 40 + seed });
        land(sim);
        const route = routeOf(sim);
        const yard = sim.royaleMode!.schedule.caps[0]!;
        const R = dist(yard.center, { x: 0, y: 0, z: 0 });
        expect(route).toHaveLength(GLOW_STOPS + 1);
        // The heart first, unless a pole's landmark stands on it.
        if (Math.abs(yard.center.y) < R - 1) expect(route[0]).toEqual(yard.center);
        else expect(dist(route[0]!, yard.center)).toBeGreaterThanOrEqual(14);
        for (let i = 1; i < route.length; i++) {
          expect(dist(route[i]!, yard.center)).toBeLessThanOrEqual(GLOW_ROAM_M + 1e-6);
          const leg = dist(route[i - 1]!, route[i]!);
          expect(leg).toBeGreaterThan(GLOW_MIN_LEG_M / 2);
          legs++;
          if (leg >= GLOW_MIN_LEG_M - 1e-6 && leg <= GLOW_MAX_LEG_M + 1e-6) inBounds++;
        }
        // Its whole ring inside the light every second to the clock, and
        // the Glow the sim stands where the route says.
        const schedule = sim.royaleMode!.schedule;
        const landAt = sim.royaleMode!.state.dropEndsAt;
        for (let t = 0; t <= EMBERSTRAY.playS; t += 1) {
          const at = glowAt(route, t);
          const cap = duskAt(schedule, landAt + t).now;
          expect(depthInside(cap, at)).toBeGreaterThanOrEqual(GLOW_RADIUS_M);
        }
        for (let t = 0; t <= EMBERSTRAY.playS; t += 2) {
          for (const p of ringPoints(glowAt(route, t), R)) {
            points++;
            if (ground.walkable(p)) walkable++;
          }
        }
      }
    }
    // Nearly every leg within its bounds (a draw that misses them all keeps
    // the nearest miss).
    expect(inBounds / legs).toBeGreaterThan(0.9);
    // Ground a champion can stand on under nearly all of every ring.
    expect(walkable / points).toBeGreaterThan(0.9);
  });

  it('rests 12 s, then drifts at 2 m/s, never faster, and the sim stands it there', () => {
    const { sim } = buildBout(firstBout(2));
    idle(sim, [...sim.units.keys()]);
    land(sim);
    const route = routeOf(sim);
    expect(glowAt(route, 0)).toEqual(route[0]);
    expect(glowAt(route, GLOW_REST_S - DT)).toEqual(route[0]);
    expect(dist(glowAt(route, GLOW_REST_S + 1), route[0]!)).toBeCloseTo(GLOW_DRIFT_MPS, 1);
    for (let t = 0; t < EMBERSTRAY.playS; t += 0.5) {
      const step = dist(glowAt(route, t), glowAt(route, t + 0.5));
      expect(step).toBeLessThanOrEqual(GLOW_DRIFT_MPS * 0.5 * 1.05);
    }
    const landAt = sim.royaleMode!.state.dropEndsAt;
    for (let i = 0; i < Math.round(20 / DT); i++) sim.tick();
    const prim = sim.royale!.bout!.goals.find((g) => g.id === GLOW_GOAL_ID)!.prims[0]!;
    expect(prim.shape).toBe('circle');
    expect(prim.radius).toBe(GLOW_RADIUS_M);
    expect(dist(prim.at, glowAt(route, sim.time - landAt))).toBeLessThan(1e-6);
  });

  it('counts the seconds of every champion standing in it, held by the nearest its heart', () => {
    const { sim, unitIds } = buildBout(firstBout(1));
    idle(sim, unitIds);
    land(sim);
    const yard = sim.royaleMode!.schedule.caps[0]!;
    const R = dist(yard.center, { x: 0, y: 0, z: 0 });
    const b = sim.royale!.bout!;
    // Seats 2 to 7 well outside it, inside the light.
    const away = ground.nearestWalkable(
      along(yard.center, heading(yard.center, 0) as Vec3, 30, R),
    )!;
    for (const id of unitIds.slice(2)) standAt(sim.units.get(id)!, away);
    const before = [...b.counts];
    // Seat 0 at the heart, seat 1 at its edge: both count, seat 0 holds.
    for (let i = 0; i < Math.round(5 / DT); i++) {
      const at = sim.royale!.bout!.goals.find((g) => g.id === GLOW_GOAL_ID)!.prims[0]!.at;
      standAt(sim.units.get(unitIds[0]!)!, at);
      standAt(
        sim.units.get(unitIds[1]!)!,
        along(at, heading(at, Math.PI / 2) as Vec3, GLOW_RADIUS_M - 1, R),
      );
      sim.tick();
      expect(b.goals.find((g) => g.id === GLOW_GOAL_ID)!.prims[0]!.holder).toBe(0);
    }
    expect(b.counts[0]! - before[0]!).toBeCloseTo(5, 6);
    expect(b.counts[1]! - before[1]!).toBeCloseTo(5, 6);
    for (let seat = 2; seat < 8; seat++) expect(b.counts[seat]).toBe(before[seat]);
  });
});

// The fields of a bot's sense the tend errand reads.
function sense(me: Vec3, glow: ObsGoal, hpFrac = 1): Sense {
  return {
    me,
    s: { hpFrac, dest: null, holding: false },
    r: { bout: { goals: [glow] } },
  } as unknown as Sense;
}

describe('the tend errand', () => {
  const yard = thornyardOf(layout, 'ruins', 40);
  const R = dist(yard.center, { x: 0, y: 0, z: 0 });
  const heart = yard.center;
  const glow: ObsGoal = { shape: 'circle', ...heart, radius: GLOW_RADIUS_M, holder: null };
  const far = along(heart, heading(heart, 1) as Vec3, 20, R);

  it('walks to the heart of the Glow from afar, and holds near it', () => {
    const out = tendCall(sense(far, glow), EMBERSTRAY.bots)!;
    expect(out.why).toBe('tend');
    expect(out.action).toMatchObject({ kind: 'move', x: heart.x, y: heart.y, z: heart.z });
    const near = along(heart, heading(heart, 1) as Vec3, 2, R);
    expect(tendCall(sense(near, glow), EMBERSTRAY.bots)!.why).toBe('tend-hold');
  });

  it('asks nothing under its health floor or out of reach', () => {
    expect(tendCall(sense(far, glow, 0.2), EMBERSTRAY.bots)).toBeNull();
    expect(tendCall(sense(far, glow), { ...EMBERSTRAY.bots, reach: 10 })).toBeNull();
  });

  it('a bot in the Glow still fights an enemy beside it', () => {
    const { sim, unitIds } = buildBout(firstBout(1));
    idle(sim, unitIds.slice(1));
    land(sim);
    const yard2 = sim.royaleMode!.schedule.caps[0]!;
    const R2 = dist(yard2.center, { x: 0, y: 0, z: 0 });
    const away = ground.nearestWalkable(
      along(yard2.center, heading(yard2.center, 0) as Vec3, 32, R2),
    )!;
    for (const id of unitIds.slice(2)) standAt(sim.units.get(id)!, away);
    const at = sim.royale!.bout!.goals.find((g) => g.id === GLOW_GOAL_ID)!.prims[0]!.at;
    standAt(sim.units.get(unitIds[0]!)!, at);
    standAt(sim.units.get(unitIds[1]!)!, along(at, heading(at, 2) as Vec3, 3, R2));
    let hit = false;
    for (let i = 0; i < Math.round(6 / DT) && !hit; i++) {
      for (const e of sim.tick()) {
        if (e.type === 'damage' && e.sourceId === unitIds[0] && e.targetId === unitIds[1]) {
          hit = true;
        }
      }
    }
    expect(hit).toBe(true);
  });
});

describe('an Emberstray bout', () => {
  for (const seed of [1, 2, 3]) {
    it(`ends at its clock, 100 s, with eight house bots on seed ${seed}`, () => {
      const { sim, unitIds } = buildBout(firstBout(seed));
      land(sim);
      let falls = 0;
      while (sim.royale!.stage !== 'over' && sim.time < DROP_S + 200) {
        for (const e of sim.tick()) if (e.type === 'death') falls++;
      }
      expect(sim.royale!.stage).toBe('over');
      expect(sim.time - DROP_S).toBeCloseTo(EMBERSTRAY.playS + DT, 6);
      expect(falls).toBeGreaterThan(0);
      const r = boutResult(sim.royaleMode!, sim);
      expect([...r.ranking].sort((a, c) => a - c)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      for (let i = 1; i < r.ranking.length; i++) {
        expect(r.counts[r.ranking[i - 1]!]!).toBeGreaterThanOrEqual(r.counts[r.ranking[i]!]!);
      }
      expect(sim.royale!.winnerId).toBe(unitIds[r.ranking[0]!]);
      // The bots tend it: the Glow is held most of the bout.
      expect(r.counts[r.ranking[0]!]).toBeGreaterThan(10);
      expect(sim.royaleMode!.ranking(sim)).toEqual(r.ranking.map((s) => unitIds[s]));
    });
  }

  it('runs its Clamors and caches, and no Seedfall, Rising, camp, pad, mark, Burr, Last light, Upstart or Graft', () => {
    const { sim } = buildBout(firstBout(1));
    const mode = sim.royaleMode!;
    expect(mode.seedfallCalls).toHaveLength(0);
    expect(sim.map.camps).toEqual([]);
    expect(sim.map.rings ?? []).toEqual([]);
    expect(sim.map.wardenPits).toEqual([]);
    for (const system of ['pads', 'burr', 'lastLight', 'marks', 'upstart', 'camps'] as const) {
      expect(mode.runs(system)).toBe(false);
    }
    expect(mode.runs('clamors')).toBe(true);
    const caches = sim.royale!.caches.filter((c) => c.present).length;
    expect(caches).toBeGreaterThan(0);
    expect(caches).toBeLessThanOrEqual(EMBERSTRAY.caches.count);
    const seen = new Set<string>();
    let offers = 0;
    while (sim.royale!.stage !== 'over' && sim.time < DROP_S + 200) {
      for (const e of sim.tick()) seen.add(e.type);
      for (const q of sim.royale!.offers.values()) offers += q.length;
    }
    for (const type of [
      'royale_seedfall_land',
      'royale_rising',
      'royale_pad',
      'royale_mark',
      'royale_last_light',
    ]) {
      expect(seen.has(type)).toBe(false);
    }
    expect(mode.tally.upstarts).toBe(0);
    expect(offers).toBe(0);
  });

  it('replays the bout it recorded, from the registry', () => {
    const args = firstBout(3);
    const record = boutReplay(args);
    expect(BOUT_KINDS).toContain(EMBERSTRAY);
    expect(royaleReplayPlayable(record)).toBe(true);
    const live = buildBout(args);
    const again = loadRoyaleReplay(planet, record)!;
    const a = playOut(live.sim);
    const b = playOut(again.sim);
    expect(live.sim.royale!.stage).toBe('over');
    expect(b.checks).toEqual(a.checks);
    const summary = (sim: Sim) => {
      const r = boutResult(sim.royaleMode!, sim);
      return { checksum: sim.checksum(), ticks: sim.tickCount, counts: r.counts };
    };
    expect(summary(again.sim)).toEqual(summary(live.sim));
  });
});
