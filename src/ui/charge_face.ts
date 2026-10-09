// What an ability's button shows when the spell is cast from a store of
// charges (CONTEXT.md: Charge): the count in a corner, and a clock that runs
// only while the store is empty (to the next charge) or the beat between
// two casts holds it. A spell without charges shows its cooldown as ever.
// Pure, so the HUD builds every slot the same way and the rule is tested
// without a DOM.

import type { AbilityDef } from '../sim/combat/casting';
import type { ChargeState } from '../sim/combat/charges';

export interface ChargeFace {
  // The charges in store, null for a spell that has none.
  count: number | null;
  // Seconds until the button can be pressed again, zero or less when now.
  remaining: number;
}

export function chargeFace(
  def: AbilityDef | undefined,
  store: ChargeState | undefined,
  cooldownEnd: number,
  time: number,
): ChargeFace {
  const beat = cooldownEnd - time;
  if (!def?.charges) return { count: null, remaining: beat };
  const count = store?.count ?? 0;
  if (count > 0) return { count, remaining: beat };
  const next = store ? store.nextAt - time : beat;
  return { count, remaining: Math.max(beat, next) };
}
