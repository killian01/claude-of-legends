// The budget-clamped grant behind the Stat polygon (CONTEXT.md): how far
// an axis may actually extend. Pure arithmetic on the def, never
// mutating it, and exact rather than searched, because stat pricing is
// linear: price times the points above the field's floor (budget.ts).
// Overspending is impossible by construction; when the champion is
// already over budget (a heavy kit), every raise resolves to a cut.

import { RANGED_THRESHOLD } from '../sim/combat/auto_attack';
import type { ChampionBaseStats, ChampionGrowth } from '../sim/content/champions';
import { BASE_STAT_BOUNDS, GROWTH_BOUNDS } from '../sim/forge/bounds';
import { BASE_STAT_PRICES, budgetOf, GROWTH_PRICES, POWER_BUDGET } from '../sim/forge/budget';
import type { ForgedChampionDef } from '../sim/forge/forged_def';

export type StatGroup = 'base' | 'growth';

// The melee pin: the roster's standard melee reach, safely under the
// engine's ranged threshold (auto_attack.ts).
export const MELEE_REACH = 1.8;
// The ranged axis floor: clearly above the threshold, so an axis dragged
// to its minimum never flips the champion back to melee by accident.
export const RANGED_MIN = RANGED_THRESHOLD + 0.5;

// The value the budget actually grants when an axis asks for `want`:
// clamped to the field's hard bounds first, then pulled back exactly to
// the budget line when the raise would cross it.
export function grantStat(
  def: ForgedChampionDef,
  group: StatGroup,
  key: string,
  want: number,
): number {
  const bound =
    group === 'base'
      ? BASE_STAT_BOUNDS[key as keyof ChampionBaseStats]
      : GROWTH_BOUNDS[key as keyof ChampionGrowth];
  const price =
    group === 'base'
      ? BASE_STAT_PRICES[key as keyof ChampionBaseStats]
      : GROWTH_PRICES[key as keyof ChampionGrowth];
  if (!bound || price === undefined || !Number.isFinite(want)) return Number.NaN;
  const have =
    group === 'base'
      ? def.base[key as keyof ChampionBaseStats]
      : def.growth[key as keyof ChampionGrowth];
  let v = Math.min(bound.max, Math.max(bound.min, want));
  if (price <= 0) return v;
  const total = budgetOf(def).total + (v - have) * price;
  if (total > POWER_BUDGET) {
    v = Math.max(bound.min, v - (total - POWER_BUDGET) / price);
  }
  return bound.integer ? Math.floor(v) : v;
}
