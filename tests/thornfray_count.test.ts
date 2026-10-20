// A bout's count, end and observation (src/sim/royale/bouts/count.ts,
// end.ts, goals.ts, observe.ts; ADR 0035): the shared scorers on staged
// events (the order of the falls, a same-tick pair placed by health
// before; a cache by its kind and a takedown's steal, none from a fallen at
// nothing, the weights in the kind's fingerprint; the time a circle or a
// carrier is held), the kind's own scorer
// fed the damage events, every seat ranked by the count then the kind's
// tie-breaks in order down to the lower seat, and the bout as a seat's
// observation reads it, its goals' holders named by unit id.

import { describe, expect, it } from 'vitest';
import { boutFingerprint } from '../src/sim/content/bouts';
import type { BoutView, GoalPrimitive, GoalSlot } from '../src/sim/content/bouts/types';
import { Rng } from '../src/sim/rng';
import {
  GLEANED,
  gleanedScorer,
  heldTimeScorer,
  survivalScorer,
  weightedScorer,
} from '../src/sim/royale/bouts/count';
import { boutRanking } from '../src/sim/royale/bouts/end';
import type { CacheKind } from '../src/sim/royale/types';
import type { SimEvent } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { buildBout, land, playOut, TEST_BOUT, testKind } from './thornfray_fixture';

// A view over plain seats: seat i is unit 100 + i.
function view(
  seats: number,
  opts: {
    hpBefore?: number[];
    caches?: Record<number, CacheKind>;
    pos?: ({ x: number; y: number; z: number } | null)[];
    prims?: GoalPrimitive[];
  } = {},
): BoutView {
  const counts = new Array<number>(seats).fill(0);
  const slots = new Map<string, GoalSlot>();
  return {
    time: 20,
    tick: 400,
    landAt: 10,
    index: 0,
    thornyard: { center: { x: 80, y: 0, z: 0 }, radius: 40 },
    rng: new Rng(1),
    seatCount: seats,
    counts,
    seatOf: (unitId) => (unitId >= 100 && unitId < 100 + seats ? unitId - 100 : null),
    seat: (seat) => ({
      seat,
      unitId: 100 + seat,
      pos: opts.pos?.[seat] ?? null,
      hp: 100,
      maxHp: 100,
      dead: false,
    }),
    hpBefore: (seat) => opts.hpBefore?.[seat] ?? 0,
    cacheKind: (id) => opts.caches?.[id] ?? null,
    goal: (id) => {
      let s = slots.get(id);
      if (!s) {
        s = { prims: [], nums: [] };
        slots.set(id, s);
      }
      return s;
    },
    primitives: () => opts.prims ?? [],
  };
}

const death = (seat: number, killerSeat: number | null): SimEvent => ({
  type: 'death',
  unitId: 100 + seat,
  killerId: killerSeat === null ? 0 : 100 + killerSeat,
});

describe('the survival count', () => {
  it('counts the order of the falls, a same-tick pair by health before', () => {
    const v = view(4, { hpBefore: [50, 80, 20, 60] });
    survivalScorer.start!(v);
    expect(v.counts).toEqual([4, 4, 4, 4]);
    survivalScorer.onEvents([death(1, 0)], v);
    expect(v.counts).toEqual([4, 0, 4, 4]);
    // Seats 2 and 3 fall on one tick: 2 had less health, so placed worse.
    survivalScorer.onEvents([death(3, 0), death(2, 0)], v);
    expect(v.counts).toEqual([4, 0, 1, 2]);
    // A fallen seat is never counted again.
    survivalScorer.onEvents([death(1, 0)], v);
    expect(v.counts).toEqual([4, 0, 1, 2]);
  });

  it('places the higher seat worse on a same-tick tie of health', () => {
    const v = view(3, { hpBefore: [30, 30, 30] });
    survivalScorer.start!(v);
    survivalScorer.onEvents([death(0, null), death(1, null)], v);
    expect(v.counts).toEqual([1, 0, 3]);
  });
});

describe('the weighted count', () => {
  const gleaned = weightedScorer('gleaned', { plain: 1, golden: 2, seedfall: 3, steal: 1 });
  const cache = (seat: number, cacheId: number): SimEvent => ({
    type: 'royale_cache',
    unitId: 100 + seat,
    cacheId,
  });

  it('counts a cache by its kind', () => {
    const v = view(3, { caches: { 0: 'plain', 1: 'golden', 2: 'seedfall' } });
    gleaned.onEvents([cache(0, 0), cache(1, 1), cache(2, 2), cache(2, 0)], v);
    expect(v.counts).toEqual([1, 2, 4]);
  });

  it('moves one from the fallen to its taker, none from a fallen at nothing', () => {
    const v = view(3, { caches: { 0: 'seedfall' } });
    gleaned.onEvents([cache(0, 0)], v);
    gleaned.onEvents([death(0, 1)], v);
    expect(v.counts).toEqual([2, 1, 0]);
    gleaned.onEvents([death(2, 1)], v);
    expect(v.counts).toEqual([2, 1, 0]);
    // The world's fall, or one's own, moves nothing.
    gleaned.onEvents([death(0, null), death(0, 0)], v);
    expect(v.counts).toEqual([2, 1, 0]);
  });

  it('carries its weights as data, where a kind fingerprint reads them', () => {
    expect(gleanedScorer.id).toBe('gleaned');
    expect(gleanedScorer.weights).toEqual(GLEANED);
    const kind = testKind({ count: gleanedScorer });
    const heavier = testKind({ count: weightedScorer('gleaned', { ...GLEANED, seedfall: 4 }) });
    const same = testKind({ count: weightedScorer('gleaned', { ...GLEANED }) });
    expect(boutFingerprint(heavier)).not.toBe(boutFingerprint(kind));
    expect(boutFingerprint(same)).toBe(boutFingerprint(kind));
  });
});

describe('the held time count', () => {
  it('counts the seconds a circle and a carrier are held', () => {
    const at = { x: 80, y: 0, z: 0 };
    const v = view(3, {
      pos: [at, { x: 79.9, y: 3, z: 0 }, { x: 70, y: 30, z: 0 }],
      prims: [
        { shape: 'circle', at, radius: 5, holder: null },
        { shape: 'carrier', at, radius: 1, holder: 2 },
        { shape: 'target', at, radius: 1, holder: 0 },
      ],
    });
    const held = heldTimeScorer('held');
    held.onEvents([], v);
    held.onEvents([], v);
    expect(v.counts).toEqual([2 * DT, 2 * DT, 2 * DT]);
  });
});

describe('the ranking of a bout', () => {
  it('ranks by the count, then the kind tie-breaks in order, then the lower seat', () => {
    const { sim } = buildBout({
      kind: testKind({ ties: ['seedfalls', 'falls', 'reached', 'seat'] }),
    });
    land(sim);
    const b = sim.royale!.bout!;
    b.counts.splice(0, 8, 5, 5, 5, 5, 9, 1, 5, 0);
    b.seedfalls.splice(0, 8, 0, 2, 0, 0, 0, 0, 0, 0);
    b.falls.splice(0, 8, 1, 0, 0, 2, 0, 0, 0, 0);
    b.reached.splice(0, 8, 0, 0, 300, 0, 0, 0, 200, 0);
    // 4 by its count; then 1 by Seedfalls; then 2 and 6 by fewer falls,
    // 6 before 2 by the earlier tick; then 0 before 3 by falls; then 5, 7.
    expect(boutRanking(sim.royaleMode!, sim)).toEqual([4, 1, 6, 2, 0, 3, 5, 7]);
  });

  it('ranks a whole bout, every seat once, its winner the first', () => {
    const { sim } = buildBout({ seed: 8 });
    playOut(sim);
    const b = sim.royale!.bout!;
    expect([...b.ranking!].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(sim.royale!.winnerId).toBe(b.seats[b.ranking![0]!]);
    expect(sim.royaleMode!.ranking(sim)).toEqual(b.ranking!.map((s) => b.seats[s]));
    for (let i = 1; i < b.ranking!.length; i++) {
      expect(b.counts[b.ranking![i - 1]!]!).toBeGreaterThanOrEqual(b.counts[b.ranking![i]!]!);
    }
  });
});

describe('the observation of a bout', () => {
  it('reads the kind, the index, the count and place, the best and the goals', () => {
    const { sim, unitIds } = buildBout({ index: 5, seed: 6 });
    land(sim);
    while (sim.time < 40) sim.tick();
    const mode = sim.royaleMode!;
    const b = sim.royale!.bout!;
    const ranking = boutRanking(mode, sim);
    for (const [seat, id] of unitIds.entries()) {
      const obs = mode.observe(sim, sim.units.get(id)!).bout!;
      expect(obs.kind).toBe(TEST_BOUT.id);
      expect(obs.index).toBe(5);
      expect(obs.of).toBe(6);
      expect(obs.double).toBe(true);
      expect(obs.count).toBe(b.counts[seat]);
      expect(obs.place).toBe(ranking.indexOf(seat) + 1);
      expect(obs.best).toBe(Math.max(...b.counts));
      expect(obs.goals!.map((g) => g.shape)).toEqual(['circle', 'carrier', 'target']);
      for (const g of obs.goals!) {
        if (g.holder !== null) expect(unitIds).toContain(g.holder);
      }
    }
  });
});
