// The bout seams (ADR 0035; docs/plan-thornfray.md slice 1): every seam
// the battle royale reads reads a bout's plan when one is set. The Dusk
// inside the Thornyard, burning outside it from the first tick, its
// closings numbered from the end and its dark counted from lightOutS; the
// caches inside it, their count held under its spots; the Seedfalls on the
// plan's clock, every seed of a burst apart from every other, never placed
// in the dark before the clock; every landing and return inside it; no
// Graft but the prize; the Risings only as the kind names them; no camp,
// ring or Warden a kind leaves out. The battle royale itself does not move
// (tests/royale_golden.test.ts).

import { describe, expect, it } from 'vitest';
import { BOUT_SEATS } from '../src/sim/content/bouts/match';
import type { BoutClosing, BoutKind } from '../src/sim/content/bouts/types';
import { DARK_BURN } from '../src/sim/content/dusk';
import { dist, type Vec3 } from '../src/sim/geo';
import { Rng } from '../src/sim/rng';
import { arcOf } from '../src/sim/royale/bouts/arc';
import { survivalScorer } from '../src/sim/royale/bouts/count';
import { boutResult } from '../src/sim/royale/bouts/end';
import { boutGameMap, boutPlan, thornyardOf } from '../src/sim/royale/bouts/plan';
import { boutCacheCount, stepCaches } from '../src/sim/royale/caches';
import { LANDING_DEPTH_M, landingIn } from '../src/sim/royale/drop';
import {
  DARK_PHASE,
  depthInside,
  drawDusk,
  duskAt,
  insideCap,
  LAST_CLOSING_PHASE,
  maxShift,
} from '../src/sim/royale/dusk';
import { REGION_IDS, type RegionId } from '../src/sim/royale/layout';
import { RoyaleMode, royaleGround } from '../src/sim/royale/mode';
import { planetGameMap, royaleLayoutOf } from '../src/sim/royale/planet_map';
import { drawSeedfallPoints, seedfallCap, seedfallSchedule } from '../src/sim/royale/seedfall';
import { DROP_S } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { effectiveRank } from '../src/sim/stats';
import { DT } from '../src/sim/types';
import { loadPlanet } from './royale_planet';
import { buildBout, land, playOut, TEST_BOUT, testKind } from './thornfray_fixture';

const planet = loadPlanet();
const layout = royaleLayoutOf(planet.layout);
const ground = royaleGround(planet.ground());
const R = layout.radius;

const close = (radius: number, from: number, burn: number): BoutClosing => ({
  radius,
  closeFrom: from,
  closeTo: from + 15,
  holdTo: from + 25,
  burn,
});

// One life's death, three closings (phases 3, 4, 5), the survival count.
const THREE = testKind({
  id: 'testthree',
  base: 'one_life',
  playS: 115,
  dusk: {
    closings: [close(26, 20, 0.04), close(14, 45, 0.07), close(5, 70, 0.12)],
    edgeSpeed: 1.1,
    burnBefore: 0.03,
    lightOutS: 95,
  },
  caches: { count: 12, backS: null },
  seedfalls: undefined,
  goals: undefined,
  count: survivalScorer,
  ties: ['health', 'seat'],
});

const TWO = testKind({
  id: 'testtwo',
  dusk: {
    closings: [close(30, 30, 0.04), close(18, 60, 0.07)],
    edgeSpeed: 1.1,
    burnBefore: 0.02,
    lightOutS: 90,
  },
});

function planOf(kind: BoutKind, region: RegionId) {
  return boutPlan(kind, thornyardOf(layout, region, kind.thornyard.radius));
}

function champions(sim: Sim) {
  return [...sim.units.values()].filter((u) => u.kind === 'champion');
}

describe('the Dusk of a bout', () => {
  it('nests every cap inside the Thornyard around a final point on its ground', () => {
    for (const kind of [TEST_BOUT, TWO, THREE]) {
      for (const region of REGION_IDS) {
        const plan = planOf(kind, region);
        for (let seed = 1; seed <= 20; seed++) {
          const s = drawDusk(new Rng(seed), layout, ground, DROP_S, plan.dusk);
          expect(s.caps[0]).toEqual(plan.thornyard);
          expect(s.caps).toHaveLength(kind.dusk.closings.length + 1);
          expect(insideCap(plan.thornyard, s.final)).toBe(true);
          for (let k = 1; k < s.caps.length; k++) {
            const outer = s.caps[k - 1]!;
            const inner = s.caps[k]!;
            expect(dist(outer.center, inner.center) + inner.radius).toBeLessThanOrEqual(
              outer.radius + 1e-9,
            );
            // Each slide within what its edge speed allows.
            expect(dist(outer.center, inner.center)).toBeLessThanOrEqual(
              maxShift(k, R, plan.dusk) + 1e-6,
            );
            expect(insideCap(inner, s.final)).toBe(true);
          }
          expect(ground.walkable(s.final)).toBe(true);
        }
      }
    }
  });

  it('burns outside the Thornyard from the first tick, never inside it', () => {
    const { sim } = buildBout({ kind: THREE, region: 'cliffs' });
    land(sim);
    const yard = sim.royaleMode!.schedule.caps[0]!;
    expect(sim.royale!.dusk.phase).toBe(0);
    expect(sim.royale!.dusk.now).toEqual(yard);
    expect(sim.royale!.dusk.burn).toBe(THREE.dusk.burnBefore);
    const [out, inside] = champions(sim);
    // The far side of the planet, on its ground.
    out!.pos = ground.nearestWalkable(thornyardOf(layout, 'ruins', 40).center)!;
    out!.path = [];
    expect(insideCap(yard, out!.pos as Vec3)).toBe(false);
    expect(insideCap(yard, inside!.pos as Vec3)).toBe(true);
    const before = { out: out!.hp, inside: inside!.hp };
    sim.tick();
    expect(before.out - out!.hp).toBeCloseTo(out!.maxHp * THREE.dusk.burnBefore * DT, 6);
    expect(inside!.hp).toBeGreaterThanOrEqual(before.inside);
  });

  it('numbers its closings from the end and counts the dark from lightOutS', () => {
    for (const kind of [TEST_BOUT, TWO, THREE]) {
      const plan = planOf(kind, 'ruins');
      const s = drawDusk(new Rng(3), layout, ground, DROP_S, plan.dusk);
      const n = kind.dusk.closings.length;
      const phases = kind.dusk.closings.map((c) => duskAt(s, DROP_S + c.closeFrom + 1).phase);
      const held = kind.dusk.closings.map((c) => duskAt(s, DROP_S + c.closeTo + 1).phase);
      const want = Array.from({ length: n }, (_, i) => LAST_CLOSING_PHASE - n + 1 + i);
      expect(phases).toEqual(want);
      expect(held).toEqual(want);
      expect(want[want.length - 1]).toBe(5);
      const out = plan.dusk.lightOutS;
      expect(duskAt(s, DROP_S + out - 0.5).phase).toBe(5);
      const dark = duskAt(s, DROP_S + out + 15);
      expect(dark.phase).toBe(DARK_PHASE);
      expect(DARK_PHASE).toBe(6);
      expect(dark.phaseEndsAt).toBe(DROP_S + out);
      expect(dark.burn).toBeCloseTo(DARK_BURN * 2, 9);
      expect(dark.now.radius).toBe(0);
    }
    // Three closings are phases 3, 4 and 5; one closing is phase 5.
    expect(planOf(THREE, 'ruins').dusk.phases).toHaveLength(3);
    expect(planOf(TEST_BOUT, 'ruins').dusk.phases).toHaveLength(1);
  });

  it('holds the light at least to the clock plus the Seedfalls forecast', () => {
    const early = testKind({
      dusk: { ...TEST_BOUT.dusk, lightOutS: 60, closings: [close(26, 30, 0.06)] },
    });
    const plan = planOf(early, 'lakes');
    expect(plan.dusk.lightOutS).toBe(early.playS + early.seedfalls!.forecastS);
    expect(plan.dusk.phases[0]!.holdTo).toBe(plan.dusk.lightOutS);
    expect(planOf(THREE, 'lakes').dusk.lightOutS).toBe(THREE.dusk.lightOutS);
  });
});

describe('the caches of a bout', () => {
  it('stand inside the Thornyard, golden first, held under its spots', () => {
    const roomy = testKind({ caches: { count: 60, backS: 30 }, seedfalls: undefined });
    for (const region of REGION_IDS) {
      for (const kind of [TEST_BOUT, THREE, roomy]) {
        const { sim } = buildBout({ kind, region });
        const yard = sim.royaleMode!.schedule.caps[0]!;
        const caches = sim.royale!.caches;
        const spots = layout.cacheSpots.filter((s) => insideCap(yard, s.pos));
        const seeds = kind.seedfalls?.seeds ?? 0;
        const want = Math.min(kind.caches.count, spots.length - 2 * seeds);
        expect(caches).toHaveLength(want);
        expect(boutCacheCount(layout.cacheSpots, yard, kind.caches.count, seeds)).toBe(want);
        for (const c of caches) expect(insideCap(yard, c.pos)).toBe(true);
        const golden = spots.filter((s) => s.golden).length;
        expect(caches.filter((c) => c.kind === 'golden')).toHaveLength(Math.min(golden, want));
      }
    }
  });

  it('come back after the bout own time, or never', () => {
    const cache = () => ({
      id: 0,
      pos: { x: 0, y: 80, z: 0 },
      kind: 'plain' as const,
      present: true,
      respawnAt: null,
      opener: 1,
      openSince: 0,
    });
    const seeker = { id: 1, pos: { x: 0, y: 80, z: 0 }, still: true, disturbedAt: -5 };
    for (const [backS, want] of [
      [30, 32],
      [null, null],
    ] as const) {
      const c = cache();
      stepCaches([c], [seeker], 2, 'respawn', DT, backS);
      expect(c.present).toBe(false);
      expect(c.respawnAt).toBe(want);
    }
  });
});

describe('the Seedfalls of a bout', () => {
  it('fall on the plan clock, called ahead, three seeds a burst', () => {
    const plan = TEST_BOUT.seedfalls!;
    const calls = seedfallSchedule('respawn', DROP_S, plan);
    expect(calls.map((c) => c.landsAt)).toEqual(plan.at.map((at) => DROP_S + at));
    expect(calls.map((c) => c.announceAt)).toEqual(plan.at.map((at) => DROP_S + at - plan.warnS));
    expect(calls.map((c) => c.ids)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect(seedfallSchedule('respawn', DROP_S, null)).toEqual([]);
  });

  it('spreads every burst apart, deep in the forecast light, in every region', () => {
    const late = testKind({ seedfalls: { ...TEST_BOUT.seedfalls!, at: [25, 55, 85] } });
    const sf = late.seedfalls!;
    for (const region of REGION_IDS) {
      const thornyard = thornyardOf(layout, region, late.thornyard.radius);
      for (let seed = 1; seed <= 20; seed++) {
        const mode = new RoyaleMode(new Rng(seed), planet.ground(), {
          variant: late.base,
          layout,
          bout: { kind: late, index: 0, final: false, thornyard },
        });
        const rng = new Rng(seed * 7);
        const taken: Vec3[] = [];
        for (const call of mode.seedfallCalls) {
          const cap = seedfallCap(mode.schedule, call.landsAt, 0, sf.forecastS);
          expect(cap.radius).toBeGreaterThan(0);
          const points = drawSeedfallPoints(
            rng,
            mode.seedfallSpots,
            cap,
            sf.seeds,
            layout,
            mode.ground,
            taken,
            sf,
          );
          expect(points).toHaveLength(3);
          for (let i = 0; i < points.length; i++) {
            expect(ground.walkable(points[i]!)).toBe(true);
            expect(depthInside(cap, points[i]!)).toBeGreaterThanOrEqual(sf.depthM - 1e-9);
            for (let j = i + 1; j < points.length; j++) {
              expect(dist(points[i]!, points[j]!)).toBeGreaterThanOrEqual(sf.apartM);
            }
          }
          taken.push(...points);
        }
      }
    }
  });

  it('never reads the dark for a Seedfall before the clock ends', () => {
    for (const region of REGION_IDS) {
      const plan = planOf(TEST_BOUT, region);
      const s = drawDusk(new Rng(9), layout, ground, DROP_S, plan.dusk);
      for (let t = 0; t < TEST_BOUT.playS; t += 0.5) {
        expect(
          seedfallCap(s, DROP_S + t, 0, TEST_BOUT.seedfalls!.forecastS).radius,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe('the landing of a bout', () => {
  it('brings a pick from outside into the Thornyard', () => {
    const yard = planOf(TEST_BOUT, 'lakes').thornyard;
    for (const far of REGION_IDS.filter((r) => r !== 'lakes')) {
      const at = landingIn(thornyardOf(layout, far, 40).center, yard, layout, ground);
      expect(at).not.toBeNull();
      expect(insideCap(yard, at!)).toBe(true);
    }
    const inside = ground.nearestWalkable(yard.center)!;
    expect(dist(landingIn(inside, yard, layout, ground)!, inside)).toBeLessThan(LANDING_DEPTH_M);
  });

  it('lands every seat and every return inside the Thornyard', () => {
    for (const [region, seed] of [
      ['sanctuary', 3],
      ['groves', 4],
      ['lakes', 5],
    ] as const) {
      const { sim, unitIds } = buildBout({ region, seed });
      const mode = sim.royaleMode!;
      // Two picks across the planet, one beside the heart; the bots pick
      // their own.
      sim.policies.delete(unitIds[0]!);
      sim.policies.delete(unitIds[1]!);
      sim.pickDrop(unitIds[0]!, thornyardOf(layout, 'cliffs', 40).center);
      sim.pickDrop(unitIds[1]!, thornyardOf(layout, region, 40).center);
      land(sim);
      const yard = mode.schedule.caps[0]!;
      for (const u of champions(sim)) expect(insideCap(yard, u.pos as Vec3)).toBe(true);
      let returns = 0;
      const dead = new Set<number>();
      while (sim.royale!.stage !== 'over' && sim.time < DROP_S + 120) {
        sim.tick();
        for (const u of champions(sim)) {
          if (u.dead) dead.add(u.id);
          else if (dead.delete(u.id)) {
            returns++;
            expect(insideCap(yard, u.pos as Vec3)).toBe(true);
          }
        }
      }
      expect(returns).toBeGreaterThan(0);
    }
  });
});

describe('the Grafts of a bout', () => {
  it('offers no Graft but the prize, to its seat at the drop', () => {
    for (const prize of [undefined, 3]) {
      const { sim, unitIds } = buildBout({ prize });
      const seen = new Set<number>();
      let prizes = 0;
      while (sim.royale!.stage !== 'over' && sim.time < DROP_S + 100) {
        sim.tick();
        for (const [id, queue] of sim.royale!.offers) {
          seen.add(id);
          for (const o of queue) {
            expect(o.prize).toBe(true);
            expect(o.grade).toBe('bough');
            prizes++;
          }
        }
      }
      expect([...seen]).toEqual(prize === undefined ? [] : [unitIds[prize]!]);
      if (prize !== undefined) expect(prizes).toBeGreaterThan(0);
      // The bot picked its prize: the one Graft held among the eight.
      const held = [...sim.royale!.grafts].filter(([, g]) => g.length > 0);
      expect(held.map(([id]) => id)).toEqual(prize === undefined ? [] : [unitIds[prize]!]);
    }
  });

  it('keeps a prize open through a fall and carries it, unchanged, to the next bout', () => {
    const { sim, unitIds } = buildBout({ kind: THREE, prize: 2, region: 'open' });
    // A person's seat that never picks.
    sim.policies.delete(unitIds[2]!);
    land(sim);
    const u = sim.units.get(unitIds[2]!)!;
    const offer = sim.royale!.offers.get(u.id)?.[0];
    expect(offer?.prize).toBe(true);
    // Brought down by the burn outside the Thornyard.
    u.pos = ground.nearestWalkable(thornyardOf(layout, 'sanctuary', 40).center)!;
    u.path = [];
    u.hp = 1;
    sim.tick();
    expect(u.dead).toBe(true);
    expect(sim.royale!.eliminated).toContain(u.id);
    expect(sim.royale!.offers.get(u.id)?.[0]).toEqual(offer);
    playOut(sim);
    const result = boutResult(sim.royaleMode!, sim);
    expect(result.pendingPrize).toEqual([{ seat: 2, cards: offer!.cards }]);
    // The next bout offers the very cards again at its drop.
    const next = buildBout({ kind: THREE, pendingPrize: result.pendingPrize, index: 1 });
    next.sim.tick();
    const again = next.sim.royale!.offers.get(next.unitIds[2]!)?.[0];
    expect(again?.cards).toEqual(offer!.cards);
    expect(again?.prize).toBe(true);
  });
});

describe('the seats of a bout', () => {
  it('land at the arc level and pieces, full, the carried Grafts held', () => {
    const grafts: string[][] = Array.from({ length: BOUT_SEATS }, () => []);
    grafts[5] = ['bloodsap'];
    for (const index of [0, 3, 5]) {
      const { sim, unitIds } = buildBout({ index, grafts });
      const arc = arcOf(index);
      for (const u of champions(sim)) {
        expect(u.level).toBe(arc.level);
        expect(u.skillPoints).toBe(0);
        expect(effectiveRank(u, 'R')).toBeGreaterThanOrEqual(1);
        expect(u.items.length).toBeGreaterThan(0);
        expect(u.hp).toBe(u.maxHp);
      }
      expect(sim.units.get(unitIds[5]!)!.grafts).toEqual(['bloodsap']);
      expect(sim.royale!.grafts.get(unitIds[5]!)).toEqual(['bloodsap']);
    }
    expect([0, 1, 2, 3, 4, 5].map((i) => arcOf(i))).toEqual([
      { level: 6, pieces: 2 },
      { level: 7, pieces: 4 },
      { level: 8, pieces: 6 },
      { level: 9, pieces: 8 },
      { level: 10, pieces: 10 },
      { level: 11, pieces: 12 },
    ]);
  });

  it('ends at its clock, or in One life with one standing', () => {
    const respawn = buildBout({ seed: 5 });
    playOut(respawn.sim);
    expect(respawn.sim.royale!.stage).toBe('over');
    // Over on the tick its clock ends, the sim's time then one tick on.
    expect(respawn.sim.time).toBeCloseTo(DROP_S + TEST_BOUT.playS + DT, 6);
    const oneLife = buildBout({ kind: THREE, seed: 5 });
    playOut(oneLife.sim, 300);
    expect(oneLife.sim.royale!.stage).toBe('over');
    const standing = champions(oneLife.sim).filter((u) => !u.dead);
    if (oneLife.sim.time < DROP_S + THREE.playS - 1e-6)
      expect(standing.length).toBeLessThanOrEqual(1);
    const b = oneLife.sim.royale!.bout!;
    expect(oneLife.sim.royale!.winnerId).toBe(b.seats[b.ranking![0]!]);
  });
});

describe('the Risings and the map of a bout', () => {
  it('raises only what the kind names, at its times', () => {
    const none = buildBout();
    expect(none.sim.ringStates).toHaveLength(0);
    expect(none.sim.objectives.nextSpawnAt).toBe(Number.POSITIVE_INFINITY);
    const kind = testKind({ id: 'testrise', systems: { risings: { voidmaul: 20, warden: 40 } } });
    const { sim } = buildBout({ kind, region: 'cliffs' });
    expect(sim.ringStates.map((r) => r.creature)).toEqual(['voidmaul']);
    expect(sim.ringStates[0]!.nextRiseAt).toBe(DROP_S + 20);
    expect(sim.objectives.nextSpawnAt).toBe(DROP_S + 40);
    const kinds = new Set<string>();
    while (sim.time < DROP_S + 45) {
      sim.tick();
      for (const u of sim.units.values()) kinds.add(u.kind);
    }
    expect(kinds.has('creature')).toBe(true);
    expect(kinds.has('warden')).toBe(true);
    expect(sim.royale!.risings.some((r) => r.kind === 'pyrefang')).toBe(false);
    expect(sim.royale!.risings.find((r) => r.kind === 'voidmaul')?.risesAt).toBe(DROP_S + 20);
  });

  it('stands no camp, ring or Warden a kind leaves out', () => {
    const full = planetGameMap(planet.layout);
    const bare = boutGameMap(full, {});
    expect(bare.camps).toEqual([]);
    expect(bare.rings).toEqual([]);
    expect(bare.wardenPits).toEqual([]);
    const some = boutGameMap(full, { camps: true, risings: { pyrefang: 30 } });
    expect(some.camps).toEqual(full.camps);
    expect(some.rings!.map((r) => r.id)).toEqual(['bot']);
    expect(some.wardenPits).toEqual([]);
    const { sim } = buildBout();
    while (sim.time < DROP_S + 40) sim.tick();
    for (const u of sim.units.values()) expect(u.kind).toBe('champion');
  });
});
