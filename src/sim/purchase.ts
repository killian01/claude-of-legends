// How an item lands in a champion's bag: one instance of each component
// the item builds from is consumed, its price discounted by theirs, the
// item takes a slot, the stats are recomputed. The shop's rule (Sim.buyItem
// adds the gold and the fountain around it) and the battle royale's loot
// (royale/loot.ts, neither) both land a purchase through here, so a piece
// of loot is exactly the item the shop would have sold.

import { ITEMS } from './content/items';
import { BAG_SLOTS } from './playbook/kit';
import { recalcChampion } from './stats';
import type { Unit } from './unit';

export interface PurchasePlan {
  // Bag slots the purchase consumes, in the order they were matched.
  consumed: number[];
  // The price after the components held are discounted.
  cost: number;
}

// The purchase planned against a bag; null when the item is unknown or the
// bag has no room for it once its components are consumed.
export function planPurchase(bag: readonly string[], itemId: string): PurchasePlan | null {
  const def = ITEMS[itemId];
  if (!def) return null;
  const consumed: number[] = [];
  let discount = 0;
  for (const compId of def.buildsFrom ?? []) {
    const idx = bag.findIndex((it, i) => it === compId && !consumed.includes(i));
    if (idx !== -1) {
      consumed.push(idx);
      discount += ITEMS[compId]?.cost ?? 0;
    }
  }
  if (bag.length - consumed.length >= BAG_SLOTS) return null;
  return { consumed, cost: Math.max(0, def.cost - discount) };
}

// The planned purchase applied: components out, the item in, stats
// recomputed (an item's health arrives with it, recalcChampion's rule).
export function applyPurchase(u: Unit, itemId: string, plan: PurchasePlan): void {
  u.items = u.items.filter((_, i) => !plan.consumed.includes(i));
  u.items.push(itemId);
  recalcChampion(u);
}

// The item given outright, whatever it costs: the loot's road.
export function equipItem(u: Unit, itemId: string): boolean {
  const plan = planPurchase(u.items, itemId);
  if (!plan) return false;
  applyPurchase(u, itemId, plan);
  return true;
}
