// The Stat polygon's grant arithmetic: hard bounds first, then the
// group's envelope line, exactly (stat pricing is linear, so no search).
// A vertex can always come down; it can only go up as far as its own
// envelope holds, and the kit never buys it room (ADR 0015).

import { describe, expect, it } from 'vitest';
import type { ChampionBaseStats } from '../src/sim/content/champions';
import { BASE_STAT_BOUNDS, GROWTH_BOUNDS } from '../src/sim/forge/bounds';
import { BASE_STAT_PRICES, budgetOf, GROWTH_PRICES } from '../src/sim/forge/budget';
import { envelopeSpend, GROWTH_ENVELOPE, STAT_ENVELOPE } from '../src/sim/forge/envelopes';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { grantStat, MELEE_REACH, RANGED_MIN } from '../src/ui/stat_budget';
import { FORGED_TWINS } from './forged_twins';

function base(i: number): ForgedChampionDef {
  return structuredClone(FORGED_TWINS[i]!);
}

function withStat(def: ForgedChampionDef, key: keyof ChampionBaseStats, v: number) {
  const d = structuredClone(def);
  d.base[key] = v;
  return d;
}

function statHeadroom(def: ForgedChampionDef): number {
  return STAT_ENVELOPE - envelopeSpend(budgetOf(def)).stats;
}

describe('grantStat', () => {
  it('clamps to the hard bounds and always allows going down', () => {
    const def = base(0);
    expect(grantStat(def, 'base', 'hp', -5000)).toBe(BASE_STAT_BOUNDS.hp.min);
    expect(grantStat(def, 'growth', 'ad', 0)).toBe(GROWTH_BOUNDS.ad.min);
    expect(grantStat(def, 'base', 'hp', Number.NaN)).toBeNaN();
    expect(grantStat(def, 'base', 'nope', 500)).toBeNaN();
  });

  it('stops exactly at the stat envelope line', () => {
    const def = base(0);
    const headroom = statHeadroom(def);
    expect(headroom).toBeGreaterThan(0);
    const granted = grantStat(def, 'base', 'hp', BASE_STAT_BOUNDS.hp.max);
    const affordable = Math.min(
      BASE_STAT_BOUNDS.hp.max,
      def.base.hp + headroom / BASE_STAT_PRICES.hp,
    );
    expect(granted).toBeCloseTo(affordable, 6);
    // The granted value lands the stats on or under their line.
    expect(envelopeSpend(budgetOf(withStat(def, 'hp', granted))).stats).toBeLessThanOrEqual(
      STAT_ENVELOPE + 1e-6,
    );
  });

  it('grants from what the envelope leaves, prior raises included', () => {
    const def = base(0);
    // Eat headroom with hp first; the next grant must use exactly what
    // remains, not what the original def had.
    def.base.hp = grantStat(def, 'base', 'hp', BASE_STAT_BOUNDS.hp.max);
    const left = statHeadroom(def);
    const granted = grantStat(def, 'base', 'ad', BASE_STAT_BOUNDS.ad.max);
    expect(granted).toBeCloseTo(
      Math.min(BASE_STAT_BOUNDS.ad.max, def.base.ad + left / BASE_STAT_PRICES.ad),
      6,
    );
  });

  it('never lets a lighter kit buy stat room', () => {
    const def = base(0);
    const before = grantStat(def, 'base', 'hp', BASE_STAT_BOUNDS.hp.max);
    // Gut the kit: every spell at a whisper. The stat grant does not move.
    const bare = structuredClone(def);
    for (const key of ['Q', 'W', 'E', 'R'] as const) {
      bare.abilities[key] = {
        ...bare.abilities[key],
        spec: { kind: 'dash', range: 1.5, speed: 20 },
      };
    }
    expect(grantStat(bare, 'base', 'hp', BASE_STAT_BOUNDS.hp.max)).toBeCloseTo(before, 6);
  });

  it('spends growth from its own envelope, apart from the stats', () => {
    const def = base(0);
    const headroom = GROWTH_ENVELOPE - envelopeSpend(budgetOf(def)).growth;
    expect(headroom).toBeGreaterThan(0);
    const granted = grantStat(def, 'growth', 'ad', GROWTH_BOUNDS.ad.max);
    expect(granted).toBeCloseTo(
      Math.min(GROWTH_BOUNDS.ad.max, def.growth.ad + headroom / GROWTH_PRICES.ad),
      6,
    );
    // Filling the stat envelope leaves the growth grant untouched.
    def.base.hp = grantStat(def, 'base', 'hp', BASE_STAT_BOUNDS.hp.max);
    def.base.ad = grantStat(def, 'base', 'ad', BASE_STAT_BOUNDS.ad.max);
    expect(grantStat(def, 'growth', 'ad', GROWTH_BOUNDS.ad.max)).toBeCloseTo(granted, 6);
  });

  it('resolves a raise to a cut when the envelope is already over', () => {
    const def = base(0);
    // Force an over-line bill by inflating hp beyond what fits.
    const over = withStat(def, 'hp', BASE_STAT_BOUNDS.hp.max);
    if (envelopeSpend(budgetOf(over)).stats <= STAT_ENVELOPE) return; // twin too light
    const granted = grantStat(over, 'base', 'mana', over.base.mana + 100);
    expect(granted).toBeLessThan(over.base.mana);
  });

  it('keeps the melee pin under the ranged floor', () => {
    expect(MELEE_REACH).toBeLessThan(RANGED_MIN);
    expect(MELEE_REACH).toBeGreaterThanOrEqual(BASE_STAT_BOUNDS.attackRange.min);
    expect(RANGED_MIN).toBeLessThanOrEqual(BASE_STAT_BOUNDS.attackRange.max);
  });
});
