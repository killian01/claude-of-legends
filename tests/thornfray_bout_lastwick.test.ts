// Lastwick (CONTEXT.md: Lastwick; docs/design/thornfray.md, Lastwick;
// docs/plan-thornfray.md slice 2), on the real Wanderseed through the one
// construction (src/net/replay.ts buildBoutSim): the Thornyard a cap of
// 40 m around its region's heart, its three closings phases 3, 4 and 5 and
// the light out at 92 s (phase 6); twelve caches inside it, none back;
// nobody landing outside it; the outside burning 3 percent a second from
// the first tick; eight house bots ending the bout by its rule by 115 s;
// the places the order of the falls, a same-tick pair placed by the health
// it had the tick before; its clock a backstop that ranks those standing
// by health; no Seedfall, Rising, camp, pad, mark, Burr or Upstart; a
// replay that plays the bout it recorded.

import { describe, expect, it } from 'vitest';
import { loadRoyaleReplay, royaleReplayPlayable } from '../src/net/replay';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { LASTWICK } from '../src/sim/content/bouts/lastwick';
import { BOUT_SEATS } from '../src/sim/content/bouts/match';
import { DARK_BURN } from '../src/sim/content/dusk';
import type { Vec3 } from '../src/sim/geo';
import { Rng } from '../src/sim/rng';
import { boutResult } from '../src/sim/royale/bouts/end';
import { boutSeed, drawBouts } from '../src/sim/royale/bouts/ledger';
import { boutPlan, thornyardOf } from '../src/sim/royale/bouts/plan';
import { boutCacheCount } from '../src/sim/royale/caches';
import { DARK_PHASE, drawDusk, duskAt, insideCap } from '../src/sim/royale/dusk';
import { REGION_IDS, type RegionId } from '../src/sim/royale/layout';
import { royaleGround } from '../src/sim/royale/mode';
import { royaleLayoutOf } from '../src/sim/royale/planet_map';
import { DROP_S } from '../src/sim/royale/types';
import type { Sim, SimEvent } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { loadPlanet } from './royale_planet';
import {
  type BoutArgs,
  boutPicks,
  boutReplay,
  buildBout,
  land,
  playOut,
} from './thornfray_fixture';

const planet = loadPlanet();
const layout = royaleLayoutOf(planet.layout);
const ground = royaleGround(planet.ground());

function champions(sim: Sim) {
  return [...sim.units.values()].filter((u) => u.kind === 'champion');
}

// Bout 1 of match `seed`, as the ledger draws it from a pool of Lastwick
// alone: its own seed and its region.
function firstBout(seed: number): BoutArgs {
  const region = drawBouts(seed, [LASTWICK])[0]!.region;
  return { kind: LASTWICK, matchSeed: seed, seed: boutSeed(seed, 0), index: 0, region };
}

// A point on the ground far outside a region's Thornyard.
function farFrom(region: RegionId): Vec3 {
  const other = REGION_IDS.find((r) => r !== region)!;
  return ground.nearestWalkable(thornyardOf(layout, other, 40).center)!;
}

// Every seat's unit standing nowhere a fight finds it: no bot plays it.
function idle(sim: Sim, unitIds: readonly number[]): void {
  for (const id of unitIds) sim.policies.delete(id);
}

describe('the Lastwick Dusk', () => {
  it('stands its Thornyard 40 m around the heart and closes it as phases 3, 4 and 5', () => {
    for (const region of REGION_IDS) {
      const yard = thornyardOf(layout, region, LASTWICK.thornyard.radius);
      const plan = boutPlan(LASTWICK, yard);
      for (let seed = 1; seed <= 10; seed++) {
        const s = drawDusk(new Rng(seed), layout, ground, DROP_S, plan.dusk);
        expect(s.caps[0]).toEqual({ center: yard.center, radius: 40 });
        expect(s.caps.map((c) => c.radius)).toEqual([40, 26, 14, 5]);
        const at = (t: number) => duskAt(s, DROP_S + t);
        // The calm: the Thornyard lit, the outside burning 3 percent.
        expect(at(0)).toMatchObject({ phase: 0, burn: 0.03, now: s.caps[0] });
        expect(at(19.9).phase).toBe(0);
        // Phase 3 closes to 26 m from 20 to 35 s and holds to 45.
        expect(at(20)).toMatchObject({ phase: 3, shrinking: true, burn: 0.04 });
        expect(at(35)).toMatchObject({ phase: 3, shrinking: false, burn: 0.04 });
        expect(at(35).now.radius).toBe(26);
        // Phase 4 to 14 m from 45 to 60, holds to 70.
        expect(at(45)).toMatchObject({ phase: 4, shrinking: true, burn: 0.07 });
        expect(at(60).now.radius).toBe(14);
        expect(at(69.9).phase).toBe(4);
        // Phase 5 to 5 m from 70 to 82, holds to 92.
        expect(at(70)).toMatchObject({ phase: 5, shrinking: true, burn: 0.12 });
        expect(at(81.9).now.radius).toBeGreaterThan(5);
        expect(at(82)).toMatchObject({ phase: 5, shrinking: false, burn: 0.12 });
        expect(at(82).now.radius).toBe(5);
        expect(at(91.9).phase).toBe(5);
      }
    }
  });

  it('puts the light out at 92 s, phase 6, burning harder every 10 s', () => {
    const plan = boutPlan(LASTWICK, thornyardOf(layout, 'lakes', 40));
    expect(plan.dusk.lightOutS).toBe(92);
    const s = drawDusk(new Rng(4), layout, ground, DROP_S, plan.dusk);
    const dark = duskAt(s, DROP_S + 92);
    expect(dark.phase).toBe(DARK_PHASE);
    expect(dark.now.radius).toBe(0);
    expect(dark.phaseEndsAt).toBe(DROP_S + 92);
    expect(dark.burn).toBeCloseTo(DARK_BURN, 9);
    expect(duskAt(s, DROP_S + 102).burn).toBeCloseTo(2 * DARK_BURN, 9);

    // On the bout's own clock: every phase told on its tick.
    const { sim, unitIds } = buildBout({ kind: LASTWICK, region: 'lakes', seed: 4 });
    idle(sim, unitIds);
    land(sim);
    const told: { phase: number; at: number }[] = [];
    while (sim.time < DROP_S + 95) {
      const at = sim.time - DROP_S;
      // Kept alive: the light's times are the test, not the falls.
      for (const u of champions(sim)) u.hp = u.maxHp;
      for (const e of sim.tick()) if (e.type === 'royale_dusk') told.push({ phase: e.phase, at });
    }
    expect(told.map((t) => t.phase)).toEqual([3, 4, 5, DARK_PHASE]);
    // On the first tick at or past each time (the clock adds DT a tick).
    told.forEach((t, i) => {
      const want = [20, 45, 70, 92][i]!;
      expect(t.at).toBeGreaterThan(want - 1e-6);
      expect(t.at).toBeLessThan(want + DT + 1e-6);
    });
  });
});

describe('the Lastwick Thornyard', () => {
  it('stands twelve caches inside it, golden first, never back', () => {
    for (const region of REGION_IDS) {
      const { sim } = buildBout({ kind: LASTWICK, region });
      const yard = sim.royaleMode!.schedule.caps[0]!;
      const spots = layout.cacheSpots.filter((s) => insideCap(yard, s.pos));
      // Every region has room for them: at least 16 spots within 40 m.
      expect(spots.length).toBeGreaterThanOrEqual(16);
      expect(boutCacheCount(layout.cacheSpots, yard, 12, 0)).toBe(12);
      const caches = sim.royale!.caches;
      expect(caches).toHaveLength(12);
      for (const c of caches) expect(insideCap(yard, c.pos)).toBe(true);
      const golden = spots.filter((s) => s.golden).length;
      expect(caches.filter((c) => c.kind === 'golden')).toHaveLength(Math.min(golden, 12));
      expect(sim.royaleMode!.plan!.caches.backS).toBeNull();
    }
  });

  it('lands nobody outside it, a pick from across the planet brought in', () => {
    REGION_IDS.forEach((region, i) => {
      const { sim, unitIds } = buildBout({ kind: LASTWICK, region, seed: 30 + i });
      // A person's pick on another region; the bots pick their own.
      idle(sim, [unitIds[0]!]);
      sim.pickDrop(unitIds[0]!, farFrom(region));
      land(sim);
      const yard = sim.royaleMode!.schedule.caps[0]!;
      const seats = champions(sim);
      expect(seats).toHaveLength(BOUT_SEATS);
      for (const u of seats) expect(insideCap(yard, u.pos as Vec3)).toBe(true);
    });
  });

  it('burns a champion left outside it 3 percent a second from the first tick', () => {
    const { sim, unitIds } = buildBout({ kind: LASTWICK, region: 'cliffs', seed: 6 });
    idle(sim, unitIds);
    land(sim);
    const yard = sim.royaleMode!.schedule.caps[0]!;
    const [out, inside] = [sim.units.get(unitIds[0]!)!, sim.units.get(unitIds[1]!)!];
    out.pos = farFrom('cliffs');
    out.path = [];
    expect(insideCap(yard, out.pos as Vec3)).toBe(false);
    expect(insideCap(yard, inside.pos as Vec3)).toBe(true);
    // The burn the world deals it, a tick at a time.
    const burnOf = (events: readonly SimEvent[]) =>
      events
        .filter((e) => e.type === 'damage' && e.targetId === out.id && e.sourceId === 0)
        .reduce((sum, e) => sum + (e.type === 'damage' ? e.amount : 0), 0);
    const full = { out: out.hp, inside: inside.hp };
    let burned = burnOf(sim.tick());
    expect(burned).toBeCloseTo(out.maxHp * 0.03 * DT, 6);
    expect(full.out - out.hp).toBeCloseTo(out.maxHp * 0.03 * DT, 6);
    // A whole second of it (the champion's own regeneration aside).
    for (let i = 1; i < Math.round(1 / DT); i++) burned += burnOf(sim.tick());
    expect(burned).toBeCloseTo(out.maxHp * 0.03, 6);
    expect(inside.hp).toBe(full.inside);
  });

  it('burns a Korrath left outside it past his Shieldskin, down to his fall', () => {
    // Korrath's passive shields him after 4 s with no damage taken, and the
    // burn leaves that clock alone: absorbed, his shield came back every
    // tick and the burn never reached his health.
    const picks = boutPicks(1);
    picks[0] = { ...picks[0]!, championId: 'korrath' };
    const { sim, unitIds } = buildBout({ kind: LASTWICK, region: 'cliffs', seed: 6, picks });
    idle(sim, unitIds);
    land(sim);
    const korrath = sim.units.get(unitIds[0]!)!;
    expect(korrath.championId).toBe('korrath');
    korrath.pos = farFrom('cliffs');
    korrath.path = [];
    const full = korrath.hp;
    // Five calm seconds: his shield is up, and the burn goes past it.
    for (let i = 0; i < Math.round(5 / DT); i++) sim.tick();
    expect(korrath.statuses.some((s) => s.kind === 'shield')).toBe(true);
    expect(full - korrath.hp).toBeGreaterThan(korrath.maxHp * 0.03 * 4);
    // Left there, he falls to it as anyone would, inside the bout's first
    // minute.
    while (!korrath.dead && sim.time < DROP_S + 60) sim.tick();
    expect(korrath.dead).toBe(true);
  });
});

describe('a Lastwick bout', () => {
  for (const seed of [1, 2, 3]) {
    it(`ends by its rule by 115 s with eight house bots on seed ${seed}`, () => {
      const { sim, unitIds } = buildBout(firstBout(seed));
      land(sim);
      const outs = new Map<number, number>();
      while (sim.royale!.stage !== 'over' && sim.time < DROP_S + 200) {
        for (const e of sim.tick()) if (e.type === 'royale_out') outs.set(e.unitId, e.place);
      }
      expect(sim.royale!.stage).toBe('over');
      expect(sim.time - DROP_S).toBeLessThanOrEqual(115);
      // Over by its rule, not its clock: one champion standing at most.
      expect(sim.time - DROP_S).toBeLessThan(LASTWICK.playS);
      const standing = champions(sim).filter((u) => !u.dead);
      expect(standing.length).toBeLessThanOrEqual(1);
      // Every seat ranked once, the winner first, every fallen seat at the
      // place One life told it.
      const r = boutResult(sim.royaleMode!, sim);
      expect([...r.ranking].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(sim.royale!.winnerId).toBe(unitIds[r.ranking[0]!]);
      for (const u of standing) expect(u.id).toBe(sim.royale!.winnerId);
      for (const [id, place] of outs)
        expect(r.ranking.indexOf(unitIds.indexOf(id)) + 1).toBe(place);
      expect(outs.size).toBeGreaterThanOrEqual(BOUT_SEATS - 1);
    });
  }

  it('places by the order of the falls, a same-tick pair by the health before', () => {
    const { sim, unitIds } = buildBout(firstBout(1));
    land(sim);
    // Seats 2 and 5 left outside the light with almost nothing: the burn
    // takes both on the next tick, seat 5 with more health before it.
    const [two, five] = [sim.units.get(unitIds[2]!)!, sim.units.get(unitIds[5]!)!];
    idle(sim, [two.id, five.id]);
    const region = firstBout(1).region!;
    for (const u of [two, five]) {
      u.pos = farFrom(region);
      u.path = [];
    }
    two.hp = 0.2;
    five.hp = 0.4;
    const fell: SimEvent[] = sim.tick().filter((e) => e.type === 'death');
    expect(fell.map((e) => (e.type === 'death' ? e.unitId : 0)).sort()).toEqual(
      [two.id, five.id].sort(),
    );
    const b = sim.royale!.bout!;
    expect(b.counts[2]).toBe(0);
    expect(b.counts[5]).toBe(1);
    expect(b.fellHp[2]).toBeCloseTo(0.2, 9);
    expect(b.fellHp[5]).toBeCloseTo(0.4, 9);
    // The rest by the bots, every fall noted in its order, best first:
    // so far seat 5, then seat 2.
    const order: number[] = [5, 2];
    while (sim.royale!.stage !== 'over' && sim.time < DROP_S + 200) {
      const tick = sim.tick().filter((e) => e.type === 'death');
      const seats = tick
        .map((e) => (e.type === 'death' ? unitIds.indexOf(e.unitId) : -1))
        .filter((s) => s >= 0)
        .sort((x, y) => b.fellHp[x]! - b.fellHp[y]! || y - x);
      // Worst first on a tick; the list is best first.
      for (const s of seats) order.unshift(s);
    }
    const r = boutResult(sim.royaleMode!, sim);
    const winner = r.ranking[0]!;
    const fallen = order.filter((s) => s !== winner);
    expect(r.ranking).toEqual([winner, ...fallen]);
    expect(r.ranking.slice(-2)).toEqual([5, 2]);
  });

  it('ends at its clock as a backstop, those standing ranked by health', () => {
    const { sim, unitIds } = buildBout({ kind: LASTWICK, region: 'ruins', seed: 8 });
    idle(sim, unitIds);
    land(sim);
    // Seat 6 falls on the tenth tick, seat 1 on the twentieth, each left
    // outside the light with almost nothing; the six left are kept standing.
    const falls = new Map([
      [10, sim.units.get(unitIds[6]!)!],
      [20, sim.units.get(unitIds[1]!)!],
    ]);
    for (let ticks = 1; sim.royale!.stage !== 'over' && sim.time < DROP_S + 200; ticks++) {
      for (const u of champions(sim)) if (!u.dead) u.hp = u.maxHp;
      const u = falls.get(ticks);
      if (u) {
        u.hp = 0.01;
        u.pos = farFrom('ruins');
        u.path = [];
      }
      sim.tick();
    }
    expect(sim.royale!.stage).toBe('over');
    expect(sim.time - DROP_S).toBeCloseTo(LASTWICK.playS + DT, 6);
    const r = boutResult(sim.royaleMode!, sim);
    const standing = r.ranking.slice(0, 6);
    const health = (seat: number) => sim.units.get(unitIds[seat]!)!.hp;
    expect(standing).toEqual([0, 2, 3, 4, 5, 7].sort((a, c) => health(c) - health(a) || a - c));
    expect(r.ranking.slice(6)).toEqual([1, 6]);
  });

  it('runs no Seedfall, Rising, camp, pad, mark, Burr, Last light or Upstart', () => {
    const { sim } = buildBout(firstBout(2));
    const mode = sim.royaleMode!;
    expect(mode.seedfallCalls).toEqual([]);
    expect(mode.seedfallPlan).toBeNull();
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
    while (sim.royale!.stage !== 'over' && sim.time < DROP_S + 200) {
      for (const e of sim.tick()) seen.add(e.type);
      for (const u of sim.units.values()) expect(u.kind).toBe('champion');
    }
    for (const type of [
      'royale_seedfall',
      'royale_rising',
      'royale_pad',
      'royale_mark',
      'royale_last_light',
    ]) {
      expect(seen.has(type)).toBe(false);
    }
    const s = sim.royale!;
    expect(s.seedfalls).toEqual([]);
    expect(s.risings).toEqual([]);
    expect(s.marks).toEqual([]);
    expect(s.burrs.size).toBe(0);
    expect(mode.tally.upstarts).toBe(0);
    // No Graft either: no prize was owed.
    expect([...s.grafts.values()].every((g) => g.length === 0)).toBe(true);
  });

  it('replays the bout it recorded, from the registry', () => {
    const args = firstBout(3);
    const record = boutReplay(args);
    expect(BOUT_KINDS).toContain(LASTWICK);
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
  });
});
