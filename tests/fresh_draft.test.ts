// The fresh draft: legal out of the box, under the line, and heavy
// enough that the Stat polygon plays from the first drag. The playtest
// found a placeholder kit so light that every vertex reached its rail
// with budget to spare, which made the polygon decorative.

import { describe, expect, it } from 'vitest';
import { BASE_STAT_BOUNDS, GROWTH_BOUNDS } from '../src/sim/forge/bounds';
import { budgetOf, POWER_BUDGET } from '../src/sim/forge/budget';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { freshDraftDef } from '../src/sim/forge/fresh_draft';
import { validateForged } from '../src/sim/forge/validate';
import { grantStat } from '../src/ui/stat_budget';
import { FORGED_TWINS } from './forged_twins';

function kitCost(def: ForgedChampionDef): number {
  const b = budgetOf(def);
  return b.passive + b.abilities.Q + b.abilities.W + b.abilities.E + b.abilities.R;
}

describe('the fresh draft', () => {
  it('is legal out of the box and under the line, with the id it was given', () => {
    const d = freshDraftDef('forged_fresh');
    expect(d.id).toBe('forged_fresh');
    expect(validateForged(d).ok).toBe(true);
    expect(budgetOf(d).total).toBeLessThanOrEqual(POWER_BUDGET);
  });

  it('weighs what a roster kit weighs', () => {
    const kits = FORGED_TWINS.map(kitCost);
    const mine = kitCost(freshDraftDef('forged_fresh'));
    expect(mine).toBeGreaterThanOrEqual(Math.min(...kits));
    expect(mine).toBeLessThanOrEqual(Math.max(...kits));
  });

  it('leaves room for a first pull, never for every vertex at its rail', () => {
    const d = freshDraftDef('forged_fresh');
    // A vertex that refuses to move on the very first drag reads as broken.
    expect(POWER_BUDGET - budgetOf(d).total).toBeGreaterThan(40);
    const maxed: ForgedChampionDef = { ...d, base: { ...d.base }, growth: { ...d.growth } };
    for (const key of Object.keys(BASE_STAT_BOUNDS) as (keyof typeof BASE_STAT_BOUNDS)[]) {
      maxed.base[key] = BASE_STAT_BOUNDS[key].max;
    }
    for (const key of Object.keys(GROWTH_BOUNDS) as (keyof typeof GROWTH_BOUNDS)[]) {
      maxed.growth[key] = GROWTH_BOUNDS[key].max;
    }
    expect(budgetOf(maxed).total).toBeGreaterThan(POWER_BUDGET);
    // Two heavy axes cannot both reach their rails: attack first, then hp
    // stops short of its own.
    const pulled: ForgedChampionDef = { ...d, base: { ...d.base } };
    pulled.base.ad = grantStat(pulled, 'base', 'ad', BASE_STAT_BOUNDS.ad.max);
    expect(pulled.base.ad).toBe(BASE_STAT_BOUNDS.ad.max);
    expect(grantStat(pulled, 'base', 'hp', BASE_STAT_BOUNDS.hp.max)).toBeLessThan(
      BASE_STAT_BOUNDS.hp.max,
    );
  });
});
