// The Thornfray's ledger (src/sim/royale/bouts/ledger.ts; ADR 0035): the
// bushels by place, the Final double; the table a total order on every
// tie; the six bouts drawn as one sequence holding the draw's three rules
// on ten thousand seeds, with pools of two, three and four kinds and a kind
// held to one region, never a dead end; each bout's seed; the prize and
// the prizes carried.

import { describe, expect, it } from 'vitest';
import { BOUT_SEATS, BOUTS } from '../src/sim/content/bouts/match';
import type { BoutKind } from '../src/sim/content/bouts/types';
import { Rng } from '../src/sim/rng';
import {
  type BoutResult,
  boutPaid,
  boutSeed,
  boutsWon,
  bushelsFor,
  carriedGrafts,
  drawBouts,
  isFinal,
  kindsHold,
  matchWinner,
  newLedger,
  nextBout,
  recordBout,
  standings,
  totals,
} from '../src/sim/royale/bouts/ledger';
import { REGION_IDS } from '../src/sim/royale/layout';
import { testKind } from './thornfray_fixture';

const kind = (id: string, regions?: BoutKind['thornyard']['regions']): BoutKind =>
  testKind({ id, thornyard: { radius: 40, ...(regions ? { regions } : {}) } });

const A = kind('alpha');
const B = kind('beta');
const C = kind('gamma');
const D = kind('delta');
// A kind held to one region.
const S = kind('single', ['ruins']);

function result(ranking: number[], extra: Partial<BoutResult> = {}): BoutResult {
  return {
    kind: 'alpha',
    ranking,
    counts: ranking.map(() => 0),
    pendingPrize: [],
    prizeGrafts: [],
    ...extra,
  };
}

const seq = (n = BOUT_SEATS) => Array.from({ length: n }, (_, i) => i);

describe('the bushels', () => {
  it('pays 5 down to none by place, double in the Final', () => {
    expect(seq().map((i) => bushelsFor(i + 1, false))).toEqual([5, 4, 3, 2, 1, 0, 0, 0]);
    expect(seq().map((i) => bushelsFor(i + 1, true))).toEqual([10, 8, 6, 4, 2, 0, 0, 0]);
    expect(isFinal(BOUTS - 1)).toBe(true);
    expect(isFinal(0)).toBe(false);
  });

  it('adds up by seat, the most a seat can reach 35', () => {
    const ledger = newLedger(1, [A, B]);
    for (let b = 0; b < BOUTS; b++) recordBout(ledger, result(seq()));
    expect(totals(ledger)).toEqual([35, 28, 21, 14, 7, 0, 0, 0]);
    expect(boutPaid(ledger, BOUTS - 1)).toEqual([10, 8, 6, 4, 2, 0, 0, 0]);
    expect(boutsWon(ledger)).toEqual([6, 0, 0, 0, 0, 0, 0, 0]);
    expect(matchWinner(ledger)).toBe(0);
  });

  it('refuses a ranking that does not name every seat once, and a seventh bout', () => {
    const ledger = newLedger(1, [A, B]);
    expect(() => recordBout(ledger, result([0, 1, 2]))).toThrow();
    expect(() => recordBout(ledger, result([0, 0, 1, 2, 3, 4, 5, 6]))).toThrow();
    expect(() => recordBout(ledger, result([0, 1, 2, 3, 4, 5, 6, 8]))).toThrow();
    for (let b = 0; b < BOUTS; b++) recordBout(ledger, result(seq()));
    expect(() => recordBout(ledger, result(seq()))).toThrow();
  });
});

describe('the table', () => {
  it('breaks ties by bouts won, then the latest place, then the lower seat', () => {
    const ledger = newLedger(2, [A, B]);
    // Seats 0 and 1 win one bout each and tie on bushels.
    recordBout(ledger, result([0, 2, 3, 4, 5, 6, 7, 1]));
    recordBout(ledger, result([1, 2, 3, 4, 5, 6, 7, 0]));
    expect(totals(ledger)[0]).toBe(totals(ledger)[1]);
    // The latest bout's better place first: seat 1.
    expect(standings(ledger).indexOf(1)).toBeLessThan(standings(ledger).indexOf(0));
    // Seats 6 and 7 placed alike in both bouts but the latest: 6 before 7.
    expect(standings(ledger).indexOf(6)).toBeLessThan(standings(ledger).indexOf(7));
  });

  it('is a total order on every table, after the Final the Final decides last', () => {
    const rng = new Rng(77);
    for (let trial = 0; trial < 300; trial++) {
      const ledger = newLedger(trial, [A, B, C]);
      const played = 1 + rng.int(BOUTS);
      for (let b = 0; b < played; b++) {
        const ranking = seq();
        for (let i = ranking.length - 1; i > 0; i--) {
          const j = rng.int(i + 1);
          [ranking[i], ranking[j]] = [ranking[j]!, ranking[i]!];
        }
        recordBout(ledger, result(ranking));
      }
      const table = standings(ledger);
      expect([...table].sort((a, b) => a - b)).toEqual(seq());
      const bushels = totals(ledger);
      const won = boutsWon(ledger);
      const latest = ledger.results[ledger.results.length - 1]!.ranking;
      for (let i = 1; i < table.length; i++) {
        const a = table[i - 1]!;
        const b = table[i]!;
        const key = (s: number) => [-bushels[s]!, -won[s]!, latest.indexOf(s), s];
        const ka = key(a);
        const kb = key(b);
        const first = ka.findIndex((v, k) => v !== kb[k]);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(ka[first]!).toBeLessThan(kb[first]!);
      }
      expect(matchWinner(ledger)).toBe(played === BOUTS ? table[0] : null);
    }
  });
});

describe('the draw', () => {
  const pools: { name: string; pool: BoutKind[] }[] = [
    { name: 'two kinds', pool: [A, B] },
    { name: 'two kinds, one held to a region', pool: [A, S] },
    { name: 'three kinds', pool: [A, B, C] },
    { name: 'three kinds, one held to a region', pool: [A, B, S] },
    { name: 'four kinds', pool: [A, B, C, D] },
    { name: 'four kinds, one held to a region', pool: [A, B, C, S] },
  ];

  for (const { name, pool } of pools) {
    it(`holds every rule on seeds 1 to 10000 with ${name}`, () => {
      const firsts = new Set<string>();
      const sequences = new Set<string>();
      for (let seed = 1; seed <= 10000; seed++) {
        const draws = drawBouts(seed, pool);
        expect(draws).toHaveLength(BOUTS);
        const kinds = draws.map((d) => d.kind);
        expect(kindsHold(kinds, pool.length)).toBe(true);
        const count = new Map<string, number>();
        draws.forEach((d, i) => {
          const k = pool.find((p) => p.id === d.kind)!;
          const allowed = k.thornyard.regions ?? REGION_IDS;
          expect(allowed).toContain(d.region);
          count.set(d.kind, (count.get(d.kind) ?? 0) + 1);
          if (i === 0) return;
          expect(d.kind).not.toBe(draws[i - 1]!.kind);
          if (allowed.length > 1) expect(d.region).not.toBe(draws[i - 1]!.region);
        });
        if (pool.length >= 3) for (const n of count.values()) expect(n).toBeLessThanOrEqual(2);
        firsts.add(kinds[0]!);
        sequences.add(draws.map((d) => `${d.kind}@${d.region}`).join(' '));
      }
      // Every kind opens some match, and the draw varies.
      expect(firsts.size).toBe(pool.length);
      expect(sequences.size).toBeGreaterThan(100);
    });
  }

  it('is the seed: the same seed draws the same bouts', () => {
    expect(drawBouts(42, [A, B, C])).toEqual(drawBouts(42, [A, B, C]));
    expect(newLedger(42, [A, B, C]).draws).toEqual(drawBouts(42, [A, B, C]));
  });

  it('alternates two kinds, either first by the seed', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const kinds = drawBouts(seed, [A, B]).map((d) => d.kind);
      expect(kinds.filter((k) => k === 'alpha')).toHaveLength(3);
    }
  });

  it('draws from one kind at least', () => {
    expect(() => drawBouts(1, [])).toThrow();
    expect(drawBouts(1, [A]).every((d) => d.kind === 'alpha')).toBe(true);
  });
});

describe('the bout seed', () => {
  it('is the match seed and the index on a stream of its own, every bout apart', () => {
    for (let m = 1; m <= 500; m++) {
      const seeds = Array.from({ length: BOUTS }, (_, i) => boutSeed(m, i));
      expect(new Set(seeds).size).toBe(BOUTS);
      for (const s of seeds) {
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(2 ** 32);
      }
      expect(seeds).toEqual(Array.from({ length: BOUTS }, (_, i) => boutSeed(m, i)));
    }
    expect(boutSeed(1, 0)).not.toBe(boutSeed(2, 0));
  });
});

describe('the prize', () => {
  it('goes to the last bout winner, none in the first bout and after the Final', () => {
    const ledger = newLedger(3, [A, B]);
    const first = nextBout(ledger, 'next')!;
    expect(first.index).toBe(0);
    expect(first.prize).toBeNull();
    expect(first.pendingPrize).toEqual([]);
    expect(first.seed).toBe(boutSeed(3, 0));
    expect(first.kind).toBe(ledger.draws[0]!.kind);
    expect(first.region).toBe(ledger.draws[0]!.region);
    recordBout(ledger, result([4, 0, 1, 2, 3, 5, 6, 7]));
    expect(nextBout(ledger, 'next')!.prize).toBe(4);
    for (let b = 1; b < BOUTS - 1; b++) recordBout(ledger, result(seq()));
    const final = nextBout(ledger, 'next')!;
    expect(final.final).toBe(true);
    expect(final.index).toBe(BOUTS - 1);
    recordBout(ledger, result(seq()));
    expect(nextBout(ledger, 'next')).toBeNull();
  });

  it('carries a prize left unpicked to the next bout, unchanged', () => {
    const ledger = newLedger(3, [A, B]);
    recordBout(ledger, result([4, 0, 1, 2, 3, 5, 6, 7]));
    const cards = ['bloodsap', 'thornhide', 'chainsap'];
    recordBout(ledger, result([1, 0, 2, 3, 4, 5, 6, 7], { pendingPrize: [{ seat: 4, cards }] }));
    const next = nextBout(ledger, 'next')!;
    expect(next.prize).toBe(1);
    expect(next.pendingPrize).toEqual([{ seat: 4, cards }]);
  });

  it('lasts the next bout only, or the match when it says so', () => {
    const ledger = newLedger(3, [A, B]);
    recordBout(ledger, result(seq(), { prizeGrafts: [] }));
    recordBout(ledger, result(seq(), { prizeGrafts: [{ seat: 0, graft: 'bloodsap' }] }));
    recordBout(ledger, result(seq(), { prizeGrafts: [{ seat: 0, graft: 'thornhide' }] }));
    expect(nextBout(ledger, 'next')!.grafts.every((g) => g.length === 0)).toBe(true);
    expect(carriedGrafts(ledger, 'all')[0]).toEqual(['bloodsap', 'thornhide']);
    expect(nextBout(ledger, 'all')!.grafts[0]).toEqual(['bloodsap', 'thornhide']);
  });
});
