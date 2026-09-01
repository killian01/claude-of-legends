// The Stat polygon's grant arithmetic: hard bounds first, then the
// budget line, exactly (stat pricing is linear, so no search). A vertex
// can always come down; it can only go up as far as the budget holds.

import { describe, expect, it } from 'vitest';
import type { ChampionBaseStats } from '../src/sim/content/champions';
import { BASE_STAT_BOUNDS, GROWTH_BOUNDS } from '../src/sim/forge/bounds';
import { BASE_STAT_PRICES, budgetOf, POWER_BUDGET } from '../src/sim/forge/budget';
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

describe('grantStat', () => {
  it('clamps to the hard bounds and always allows going down', () => {
    const def = base(0);
    expect(grantStat(def, 'base', 'hp', -5000)).toBe(BASE_STAT_BOUNDS.hp.min);
    expect(grantStat(def, 'growth', 'ad', 0)).toBe(GROWTH_BOUNDS.ad.min);
    expect(grantStat(def, 'base', 'hp', Number.NaN)).toBeNaN();
    expect(grantStat(def, 'base', 'nope', 500)).toBeNaN();
  });

  it('stops exactly at the budget line', () => {
    const def = base(0);
    const headroom = POWER_BUDGET - budgetOf(def).total;
    expect(headroom).toBeGreaterThan(0);
    const granted = grantStat(def, 'base', 'hp', BASE_STAT_BOUNDS.hp.max);
    const affordable = Math.min(
      BASE_STAT_BOUNDS.hp.max,
      def.base.hp + headroom / BASE_STAT_PRICES.hp,
    );
    expect(granted).toBeCloseTo(affordable, 6);
    // The granted value lands the whole champion on or under the line.
    expect(budgetOf(withStat(def, 'hp', granted)).total).toBeLessThanOrEqual(POWER_BUDGET + 1e-6);
  });

  it('grants from what the whole def leaves, kit and prior raises included', () => {
    const def = base(0);
    // Eat headroom with hp first; the next grant must use exactly what
    // remains, not what the original def had.
    def.base.hp = grantStat(def, 'base', 'hp', BASE_STAT_BOUNDS.hp.max);
    const left = POWER_BUDGET - budgetOf(def).total;
    const granted = grantStat(def, 'base', 'ad', BASE_STAT_BOUNDS.ad.max);
    expect(granted).toBeCloseTo(
      Math.min(BASE_STAT_BOUNDS.ad.max, def.base.ad + left / BASE_STAT_PRICES.ad),
      6,
    );
  });

  it('resolves a raise to a cut when the champion is already over budget', () => {
    const def = base(0);
    // Force an over-budget bill by inflating hp beyond what fits.
    const over = withStat(def, 'hp', BASE_STAT_BOUNDS.hp.max);
    if (budgetOf(over).total <= POWER_BUDGET) return; // twin too light to force it
    const granted = grantStat(over, 'base', 'mana', over.base.mana + 100);
    expect(granted).toBeLessThan(over.base.mana);
  });

  it('keeps the melee pin under the ranged floor', () => {
    expect(MELEE_REACH).toBeLessThan(RANGED_MIN);
    expect(MELEE_REACH).toBeGreaterThanOrEqual(BASE_STAT_BOUNDS.attackRange.min);
    expect(RANGED_MIN).toBeLessThanOrEqual(BASE_STAT_BOUNDS.attackRange.max);
  });
});
