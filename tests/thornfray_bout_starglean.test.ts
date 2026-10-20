// Starglean (CONTEXT.md: Starglean; docs/design/thornfray.md, Starglean;
// docs/plan-thornfray.md slice 3), on the real Wanderseed through the one
// construction (src/net/replay.ts buildBoutSim): its caches at landing
// inside the Thornyard, golden first, by region (18, 18, 14, 13, 12, 10),
// back 30 s after opened; the gleaned count (a cache 1, a golden 2, a
// Seedfall cache 3, each on a staged opening); a takedown moving one from
// the fallen to its taker and none from a fallen at nothing, the takedown
// score left as the planet keeps it; bursts of three seeds at 25, 55 and
// 85 s, called 12 s ahead, every seed 18 m from the two others and inside
// the light; the Seedfall cache's held opening; one closing as phase 5 and
// the light held to 120 s; eight house bots played to its clock at 105 s,
// the ranking total and by the count; the tie-breaks in order; a fall back
// in five seconds inside the light, in its Grace; no Rising, camp, pad,
// mark, Burr, Last light, Upstart or Graft; a replay that plays the bout
// it recorded.

import { describe, expect, it } from 'vitest';
import { loadRoyaleReplay, royaleReplayPlayable } from '../src/net/replay';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { BOUT_SEATS } from '../src/sim/content/bouts/match';
import { STARGLEAN } from '../src/sim/content/bouts/starglean';
import { dist, type Vec3 } from '../src/sim/geo';
import { Rng } from '../src/sim/rng';
import { GLEANED, gleanedScorer } from '../src/sim/royale/bouts/count';
import { boutRanking, boutResult } from '../src/sim/royale/bouts/end';
import { boutSeed, drawBouts } from '../src/sim/royale/bouts/ledger';
import { boutPlan, thornyardOf } from '../src/sim/royale/bouts/plan';
import { boutCacheCount } from '../src/sim/royale/caches';
import { DARK_PHASE, depthInside, drawDusk, duskAt, insideCap } from '../src/sim/royale/dusk';
import { REGION_IDS, type RegionId } from '../src/sim/royale/layout';
import { royaleGround } from '../src/sim/royale/mode';
import { royaleLayoutOf } from '../src/sim/royale/planet_map';
import { seedfallCap } from '../src/sim/royale/seedfall';
import { type CacheKind, type CacheState, DROP_S, RESPAWN_S } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { loadPlanet } from './royale_planet';
import { type BoutArgs, boutReplay, buildBout, land, playOut } from './thornfray_fixture';

const planet = loadPlanet();
const layout = royaleLayoutOf(planet.layout);
const ground = royaleGround(planet.ground());

// The design's caches at landing, region by region: eighteen at most, never
// more than the spots inside the Thornyard less six kept for the seeds.
const CACHES_BY_REGION: Readonly<Record<RegionId, number>> = {
  ruins: 18,
  sanctuary: 18,
  lakes: 14,
  cliffs: 13,
  open: 12,
  groves: 10,
};

// Bout 1 of match `seed`, as the ledger draws it from a pool of Starglean
// alone: its own seed and its region.
function firstBout(seed: number): BoutArgs {
  const region = drawBouts(seed, [STARGLEAN])[0]!.region;
  return { kind: STARGLEAN, matchSeed: seed, seed: boutSeed(seed, 0), index: 0, region };
}

// No bot plays these seats.
function idle(sim: Sim, unitIds: readonly number[]): void {
  for (const id of unitIds) sim.policies.delete(id);
}

// A point on the ground far outside a region's Thornyard.
function farFrom(region: RegionId): Vec3 {
  const other = REGION_IDS.find((r) => r !== region)!;
  return ground.nearestWalkable(thornyardOf(layout, other, 40).center)!;
}

function standAt(u: Unit, p: Vec3): void {
  u.pos = { ...p };
  u.path = [];
}

// A built bout of idle seats, landed, every seat but the first parked on
// the ground nearest the Thornyard's heart: the first seat alone opens
// what it stands on.
function staged(region: RegionId, seed: number) {
  const { sim, unitIds } = buildBout({ kind: STARGLEAN, region, seed });
  idle(sim, unitIds);
  land(sim);
  const yard = sim.royaleMode!.schedule.caps[0]!;
  const park = ground.nearestWalkable(yard.center)!;
  for (const id of unitIds.slice(1)) standAt(sim.units.get(id)!, park);
  return { sim, unitIds, yard, park, b: sim.royale!.bout! };
}

// A standing cache of a kind, the farthest of them from `park`.
function farthestCache(sim: Sim, kind: CacheKind, park: Vec3): CacheState {
  const of = sim.royale!.caches.filter((c) => c.present && c.kind === kind);
  of.sort((a, c) => dist(c.pos, park) - dist(a.pos, park));
  expect(of.length).toBeGreaterThan(0);
  expect(dist(of[0]!.pos, park)).toBeGreaterThan(5);
  return of[0]!;
}

// The seat's unit stands at the cache, still, until a cache opens there;
// returns who opened it and how long it took.
function openAt(sim: Sim, u: Unit, cache: CacheState) {
  standAt(u, cache.pos);
  const from = sim.time;
  for (let i = 0; i < Math.round(12 / DT); i++) {
    for (const e of sim.tick()) {
      if (e.type === 'royale_cache' && e.cacheId === cache.id) {
        return { unitId: e.unitId, took: sim.time - from };
      }
    }
  }
  return null;
}

// A champion taken down by `taker` this tick: its last hit taken from the
// taker, its fall the burn outside the light. With no taker the world
// takes it. Returns the death's killer.
function takeDown(sim: Sim, victim: Unit, taker: Unit | null, region: RegionId): number {
  victim.lastHitByChampion = taker ? taker.id : 0;
  victim.lastHitAt = taker ? sim.time : -999;
  standAt(victim, farFrom(region));
  victim.hp = 0.01;
  const deaths = sim.tick().filter((e) => e.type === 'death' && e.unitId === victim.id);
  expect(deaths).toHaveLength(1);
  const d = deaths[0]!;
  return d.type === 'death' ? d.killerId : -1;
}

describe('the Starglean Dusk', () => {
  it('lights the Thornyard to 60 s, closes once as phase 5 and holds the light to 120 s', () => {
    for (const region of REGION_IDS) {
      const yard = thornyardOf(layout, region, STARGLEAN.thornyard.radius);
      const plan = boutPlan(STARGLEAN, yard);
      expect(plan.dusk.lightOutS).toBe(120);
      expect(plan.playS).toBe(105);
      for (let seed = 1; seed <= 5; seed++) {
        const s = drawDusk(new Rng(seed), layout, ground, DROP_S, plan.dusk);
        expect(s.caps.map((c) => c.radius)).toEqual([40, 26]);
        expect(s.caps[0]).toEqual({ center: yard.center, radius: 40 });
        const at = (t: number) => duskAt(s, DROP_S + t);
        expect(at(0)).toMatchObject({ phase: 0, burn: 0.04, now: s.caps[0] });
        expect(at(59.9).phase).toBe(0);
        expect(at(60)).toMatchObject({ phase: 5, shrinking: true, burn: 0.06 });
        expect(at(75)).toMatchObject({ phase: 5, shrinking: false, burn: 0.06 });
        expect(at(75).now.radius).toBe(26);
        expect(at(105).phase).toBe(5);
        expect(at(119.9).phase).toBe(5);
        expect(at(120).phase).toBe(DARK_PHASE);
      }
    }
  });
});

describe('the Starglean caches', () => {
  it('stand at landing inside the Thornyard, golden first, as many as its region allows', () => {
    for (const region of REGION_IDS) {
      const { sim } = buildBout({ kind: STARGLEAN, region });
      const yard = sim.royaleMode!.schedule.caps[0]!;
      const spots = layout.cacheSpots.filter((s) => insideCap(yard, s.pos));
      const want = CACHES_BY_REGION[region];
      expect(boutCacheCount(layout.cacheSpots, yard, 18, 3)).toBe(want);
      const caches = sim.royale!.caches;
      expect(caches).toHaveLength(want);
      // Six spots at least kept free inside for the seeds.
      expect(spots.length - caches.length).toBeGreaterThanOrEqual(6);
      for (const c of caches) expect(insideCap(yard, c.pos)).toBe(true);
      // Every golden spot inside stands first.
      const golden = spots.filter((s) => s.golden);
      expect(caches.filter((c) => c.kind === 'golden')).toHaveLength(golden.length);
      for (const g of golden) {
        expect(caches.some((c) => c.kind === 'golden' && dist(c.pos, g.pos) < 1e-9)).toBe(true);
      }
    }
  });

  it('counts a cache 1, a golden 2 and a Seedfall cache 3, each staged', () => {
    expect(STARGLEAN.count).toBe(gleanedScorer);
    expect(GLEANED).toEqual({ plain: 1, golden: 2, seedfall: 3, steal: 1 });
    const { sim, unitIds, park, b } = staged('ruins', 3);
    const me = sim.units.get(unitIds[0]!)!;
    const score = sim.royale!.scores.get(me.id);
    const plain = openAt(sim, me, farthestCache(sim, 'plain', park));
    expect(plain?.unitId).toBe(me.id);
    expect(b.counts[0]).toBe(1);
    const golden = openAt(sim, me, farthestCache(sim, 'golden', park));
    expect(golden?.unitId).toBe(me.id);
    expect(b.counts[0]).toBe(3);
    // The first burst lands at 25 s; the seat walks onto the seed farthest
    // from the parked seats once it has landed.
    while (sim.royale!.seedfalls.filter((f) => f.landed).length < 3) sim.tick();
    const seed = farthestCache(sim, 'seedfall', park);
    const opened = openAt(sim, me, seed);
    expect(opened?.unitId).toBe(me.id);
    expect(opened!.took).toBeGreaterThan(3 - 1e-6);
    expect(b.counts[0]).toBe(6);
    expect(b.seedfalls[0]).toBe(1);
    // Nobody else gleaned a thing; the takedown score never moved.
    expect(b.counts.slice(1).every((c) => c === 0)).toBe(true);
    expect(sim.royale!.scores.get(me.id)).toBe(score);
    // Neither the golden cache nor the Seedfall's offers a Graft in a bout.
    expect(sim.royale!.offers.get(me.id) ?? []).toEqual([]);
  });

  it('holds a Seedfall cache opening through hits, slowed, and counts it 3', () => {
    const { sim, unitIds, park, b } = staged('lakes', 5);
    const me = sim.units.get(unitIds[0]!)!;
    while (sim.royale!.seedfalls.filter((f) => f.landed).length < 3) sim.tick();
    const seed = farthestCache(sim, 'seedfall', park);
    // The opening begins; then a hit every tick for two seconds: it holds
    // on, its clock at half speed, and never changes hands.
    standAt(me, seed.pos);
    while (seed.opener !== me.id) sim.tick();
    const from = sim.time;
    let held = 0;
    while (sim.time - from < 2 - 1e-9) {
      me.lastDamagedAt = sim.time;
      sim.tick();
      if (seed.opener === me.id) held++;
    }
    expect(held).toBe(Math.round(2 / DT));
    // About a second counted of the two.
    expect(sim.time - seed.openSince).toBeGreaterThan(0.9);
    expect(sim.time - seed.openSince).toBeLessThan(1.1);
    const opened = openAt(sim, me, seed);
    expect(opened?.unitId).toBe(me.id);
    // A second at half speed while the calm returns, then the rest in full:
    // some four and a half seconds where an undisturbed opening takes three.
    expect(sim.time - from).toBeGreaterThan(4.3);
    expect(sim.time - from).toBeLessThan(4.7);
    expect(b.counts[0]).toBe(GLEANED.seedfall);
  });

  it('brings an opened cache back 30 s after it was opened', () => {
    const { sim, unitIds, park } = staged('cliffs', 2);
    const me = sim.units.get(unitIds[0]!)!;
    const cache = farthestCache(sim, 'plain', park);
    expect(openAt(sim, me, cache)?.unitId).toBe(me.id);
    const openedAt = sim.time;
    expect(cache.present).toBe(false);
    expect(cache.respawnAt).toBeCloseTo(openedAt - DT + 30, 6);
    standAt(me, park);
    while (sim.time < openedAt + 29) sim.tick();
    expect(cache.present).toBe(false);
    while (sim.time < openedAt + 31) sim.tick();
    expect(cache.present).toBe(true);
  });
});

describe('the Starglean takedowns', () => {
  it('moves one from the fallen to its taker, none from a fallen at nothing', () => {
    const region: RegionId = 'sanctuary';
    const { sim, unitIds, b } = staged(region, 7);
    const [taker, rich, poor, alone] = [0, 1, 2, 3].map((s) => sim.units.get(unitIds[s]!)!);
    b.counts[1] = 2;
    b.counts[3] = 3;
    const score = () => sim.royale!.scores.get(taker!.id) ?? 0;
    const before = score();
    expect(takeDown(sim, rich!, taker!, region)).toBe(taker!.id);
    expect(b.counts.slice(0, 4)).toEqual([1, 1, 0, 3]);
    expect(b.falls[1]).toBe(1);
    // The takedown scores as on the planet, one, beside the count.
    expect(score()).toBe(before + 1);
    // A fallen at nothing gives nothing; the takedown still scores.
    expect(takeDown(sim, poor!, taker!, region)).toBe(taker!.id);
    expect(b.counts.slice(0, 4)).toEqual([1, 1, 0, 3]);
    expect(score()).toBe(before + 2);
    // A fall to the world alone moves nothing.
    expect(takeDown(sim, alone!, null, region)).toBe(0);
    expect(b.counts.slice(0, 4)).toEqual([1, 1, 0, 3]);
    expect(b.falls.slice(0, 4)).toEqual([0, 1, 1, 1]);
  });

  it('brings a fall back in five seconds inside the light, in its Grace, where it picked', () => {
    const region: RegionId = 'ruins';
    const { sim, unitIds, yard, park } = staged(region, 9);
    const u = sim.units.get(unitIds[4]!)!;
    takeDown(sim, u, null, region);
    expect(u.dead).toBe(true);
    const fellAt = sim.time;
    // A tap on the globe while it waits.
    expect(sim.pickDrop(u.id, park)).toBe(true);
    while (u.dead && sim.time < fellAt + 10) sim.tick();
    expect(u.dead).toBe(false);
    expect(sim.time - fellAt).toBeGreaterThan(RESPAWN_S - DT - 1e-6);
    expect(sim.time - fellAt).toBeLessThan(RESPAWN_S + 2 * DT);
    expect(insideCap(yard, u.pos as Vec3)).toBe(true);
    expect(dist(u.pos, park)).toBeLessThan(12);
    expect(sim.royale!.arriving.has(u.id)).toBe(true);
  });
});

describe('the Starglean Seedfalls', () => {
  it('fall in threes at 25, 55 and 85 s, called 12 s ahead, apart and in the light', () => {
    const sf = STARGLEAN.seedfalls!;
    expect(sf).toMatchObject({ at: [25, 55, 85], seeds: 3, warnS: 12, forecastS: 15 });
    for (const region of REGION_IDS) {
      for (const seed of [1, 2, 3]) {
        const { sim, unitIds } = buildBout({ kind: STARGLEAN, region, seed: 40 + seed });
        idle(sim, unitIds);
        land(sim);
        const mode = sim.royaleMode!;
        const calls: { at: number; id: number; pos: Vec3; landsAt: number }[] = [];
        const lands: { at: number; id: number; light: ReturnType<typeof duskAt> }[] = [];
        while (sim.time < DROP_S + 87) {
          const at = sim.time - DROP_S;
          for (const e of sim.tick()) {
            if (e.type === 'royale_seedfall') {
              calls.push({ at, id: e.seedfallId, pos: e.at, landsAt: e.landsAt });
            } else if (e.type === 'royale_seedfall_land') {
              lands.push({ at, id: e.seedfallId, light: sim.royale!.dusk });
            }
          }
        }
        expect(calls).toHaveLength(9);
        expect(lands.map((l) => l.id)).toEqual(calls.map((c) => c.id));
        for (let w = 0; w < 3; w++) {
          const burst = calls.slice(3 * w, 3 * w + 3);
          const landsAt = sf.at[w]!;
          for (const c of burst) {
            // Called on the first tick at or past 12 s ahead of its impact.
            expect(c.at).toBeGreaterThan(landsAt - sf.warnS - 1e-6);
            expect(c.at).toBeLessThan(landsAt - sf.warnS + DT + 1e-6);
            expect(c.landsAt).toBeCloseTo(DROP_S + landsAt, 9);
            // Deep in the light as it will stand 15 s past the impact.
            const cap = seedfallCap(mode.schedule, c.landsAt, 0, sf.forecastS);
            expect(depthInside(cap, c.pos)).toBeGreaterThanOrEqual(sf.depthM - 1e-9);
            expect(ground.walkable(c.pos)).toBe(true);
          }
          for (let i = 0; i < 3; i++) {
            for (let j = i + 1; j < 3; j++) {
              expect(dist(burst[i]!.pos, burst[j]!.pos)).toBeGreaterThanOrEqual(sf.apartM);
            }
          }
          // In the light on the tick it lands.
          for (const l of lands.slice(3 * w, 3 * w + 3)) {
            const c = calls.find((k) => k.id === l.id)!;
            expect(insideCap(l.light.now, c.pos)).toBe(true);
          }
        }
      }
    }
  });
});

describe('a Starglean bout', () => {
  for (const seed of [1, 2, 3]) {
    it(`ends at its clock, 105 s, with eight house bots on seed ${seed}`, () => {
      const { sim, unitIds } = buildBout(firstBout(seed));
      land(sim);
      let falls = 0;
      while (sim.royale!.stage !== 'over' && sim.time < DROP_S + 200) {
        for (const e of sim.tick()) if (e.type === 'death') falls++;
      }
      expect(sim.royale!.stage).toBe('over');
      expect(sim.time - DROP_S).toBeCloseTo(STARGLEAN.playS + DT, 6);
      // Respawn's death: the falls never end it before its clock.
      expect(falls).toBeGreaterThan(0);
      const r = boutResult(sim.royaleMode!, sim);
      expect([...r.ranking].sort((a, c) => a - c)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      // By the count, best first; the winner the first.
      for (let i = 1; i < r.ranking.length; i++) {
        expect(r.counts[r.ranking[i - 1]!]!).toBeGreaterThanOrEqual(r.counts[r.ranking[i]!]!);
      }
      expect(sim.royale!.winnerId).toBe(unitIds[r.ranking[0]!]);
      expect(r.counts[r.ranking[0]!]).toBeGreaterThan(0);
      // The ranking the mode tells is the bout's, by unit.
      expect(sim.royaleMode!.ranking(sim)).toEqual(r.ranking.map((s) => unitIds[s]));
    });
  }

  it('breaks a tie on Seedfall caches, then fewer falls, then the earlier count, then seat', () => {
    expect(STARGLEAN.ties).toEqual(['seedfalls', 'falls', 'reached', 'seat']);
    const { sim } = buildBout(firstBout(2));
    idle(sim, [...sim.units.keys()]);
    land(sim);
    const b = sim.royale!.bout!;
    b.counts.splice(0, BOUT_SEATS, 5, 5, 5, 5, 5, 5, 7, 2);
    b.seedfalls.splice(0, BOUT_SEATS, 1, 2, 2, 2, 2, 1, 0, 0);
    b.falls.splice(0, BOUT_SEATS, 0, 1, 1, 0, 0, 0, 3, 0);
    b.reached.splice(0, BOUT_SEATS, 300, 300, 300, 500, 400, 300, 900, 100);
    expect(boutRanking(sim.royaleMode!, sim)).toEqual([6, 4, 3, 1, 2, 0, 5, 7]);
  });

  it('runs its Seedfalls and Clamors, and no Rising, camp, pad, mark, Burr, Last light, Upstart or Graft', () => {
    const { sim } = buildBout(firstBout(1));
    const mode = sim.royaleMode!;
    expect(mode.seedfallCalls).toHaveLength(3);
    expect(sim.map.camps).toEqual([]);
    expect(sim.map.rings ?? []).toEqual([]);
    expect(sim.map.wardenPits).toEqual([]);
    expect(sim.ringStates).toHaveLength(0);
    expect(sim.objectives.nextSpawnAt).toBe(Number.POSITIVE_INFINITY);
    expect(sim.royale!.pads).toEqual([]);
    for (const system of ['pads', 'burr', 'lastLight', 'marks', 'upstart', 'camps'] as const) {
      expect(mode.runs(system)).toBe(false);
    }
    expect(mode.runs('clamors')).toBe(true);
    const seen = new Set<string>();
    let offers = 0;
    while (sim.royale!.stage !== 'over' && sim.time < DROP_S + 200) {
      for (const e of sim.tick()) seen.add(e.type);
      for (const u of sim.units.values()) expect(u.kind).toBe('champion');
      for (const q of sim.royale!.offers.values()) offers += q.length;
    }
    expect(seen.has('royale_seedfall_land')).toBe(true);
    expect(mode.tally.seedfallsOpened).toBeGreaterThan(0);
    for (const type of ['royale_rising', 'royale_pad', 'royale_mark', 'royale_last_light']) {
      expect(seen.has(type)).toBe(false);
    }
    const s = sim.royale!;
    expect(s.risings).toEqual([]);
    expect(s.marks).toEqual([]);
    expect(s.burrs.size).toBe(0);
    expect(mode.tally.upstarts).toBe(0);
    // No Graft: no prize was owed, and no cache, Seedfall or takedown
    // offers one in a bout.
    expect(offers).toBe(0);
    expect([...s.grafts.values()].every((g) => g.length === 0)).toBe(true);
  });

  it('replays the bout it recorded, from the registry', () => {
    const args = firstBout(3);
    const record = boutReplay(args);
    expect(BOUT_KINDS).toContain(STARGLEAN);
    expect(royaleReplayPlayable(record)).toBe(true);
    const live = buildBout(args);
    const again = loadRoyaleReplay(planet, record)!;
    const a = playOut(live.sim);
    const b = playOut(again.sim);
    expect(live.sim.royale!.stage).toBe('over');
    expect(b.checks).toEqual(a.checks);
    const summary = (sim: Sim) => {
      const r = boutResult(sim.royaleMode!, sim);
      return {
        checksum: sim.checksum(),
        ticks: sim.tickCount,
        counts: r.counts,
        ranking: r.ranking,
      };
    };
    expect(summary(again.sim)).toEqual(summary(live.sim));
    // A count moved by hand moves the checksum.
    const sum = live.sim.checksum();
    live.sim.royale!.bout!.counts[0]! += 1;
    expect(live.sim.checksum()).not.toBe(sum);
  });
});
