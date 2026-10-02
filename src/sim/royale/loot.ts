// Loot (CONTEXT.md: Loot; ADR 0031): no shop, no gold, no recall. A cache,
// a camp and a takedown each give the champion the next piece of its
// house build, the role build the house bots walk (playbook/kit.ts), as
// the kit walker would buy it with a bottomless purse: a component when a
// component is next, the finished item once its parts are in the bag, a
// sale first when the bag is full of what the build no longer wants. The
// purchase lands the way the sim's shop lands one (equipItem): components
// consumed, the item in the bag, the stats recomputed, the health the
// item adds given at once. A finished build gives nothing more.

import { nextKitStep, roleBuild } from '../playbook/kit';
import { equipItem } from '../purchase';
import { recalcChampion } from '../stats';
import type { Unit } from '../unit';

// A golden cache gives this many pieces, a plain one, a camp or a
// takedown one.
export const GOLDEN_PIECES = 2;

// The next piece for this champion and bag, without touching either: the
// item the walker buys next, and the slot it sells first when the bag is
// full (null when it sells nothing). Null when the build is done.
export function nextPiece(
  championId: string | null,
  bag: readonly string[],
): { itemId: string; sell: number[] } | null {
  const build = roleBuild(championId);
  let items = [...bag];
  const sell: number[] = [];
  // At most a sale per slot before the buy; the walker never sells twice
  // in a row without a purchase in between unless the bag asks it to.
  for (let guard = 0; guard < 7; guard++) {
    const step = nextKitStep(build, items, Number.POSITIVE_INFINITY);
    if (step === null) return null;
    if (step.kind === 'buy') return { itemId: step.itemId, sell };
    sell.push(step.slot);
    items = items.filter((_, i) => i !== step.slot);
  }
  return null;
}

// Gives the champion its next piece; returns the item given, or null when
// its build is complete (or the bag cannot take it).
export function grantPiece(u: Unit): string | null {
  if (u.kind !== 'champion') return null;
  const piece = nextPiece(u.championId, u.items);
  if (!piece) return null;
  if (piece.sell.length > 0) {
    // The sales the walker asked for, slot by slot as the walker saw the
    // bag shrink; a royale sale pays nothing.
    for (const slot of piece.sell) u.items = u.items.filter((_, i) => i !== slot);
    recalcChampion(u);
  }
  return equipItem(u, piece.itemId) ? piece.itemId : null;
}

// Gives up to `count` pieces; returns the items given in order.
export function grantPieces(u: Unit, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = grantPiece(u);
    if (id === null) break;
    out.push(id);
  }
  return out;
}

// A share of the maximum health back, capped at full: a takedown's and a
// camp's heal (TAKEDOWN_HEAL, CAMP_HEAL).
export function healShare(u: Unit, share: number): void {
  if (u.dead) return;
  u.hp = Math.min(u.maxHp, u.hp + u.maxHp * share);
}
