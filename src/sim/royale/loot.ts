// Loot (CONTEXT.md: Loot; ADR 0031): no shop, no gold, no recall. A cache,
// a camp and a takedown each give the champion the next piece of its build,
// fixed for the seat when it is seated (the bot's kit build, else the
// champion's planet build, content/royale_builds.ts, the same rule for a
// person). The piece is
// walked from the kit walker's own recipes (playbook/kit.ts) in build
// order, without gold: the next target's first missing component, the
// target itself once its parts are in the bag, the target outright when
// the bag is full; with a full bag and a piece that needs a slot, what the
// build no longer wants goes first, else the cheapest item when the target
// is worth more. The purchase lands the way the shop lands one
// (src/sim/purchase.ts): components consumed, the item in the bag, the
// stats recomputed, the health the item adds given at once. A finished
// build gives nothing more.

import { ITEMS } from '../content/items';
import { planetBuild } from '../content/royale_builds';
import {
  BAG_SLOTS,
  cheapestSlot,
  roleBuild,
  stepToward,
  unsatisfied,
  unwantedSlots,
} from '../playbook/kit';
import { equipItem } from '../purchase';
import { recalcChampion } from '../stats';
import type { Unit } from '../unit';
import { STREAK_FALLOFF } from './types';

// A golden cache gives this many pieces, a plain one, a camp or a
// takedown one.
export const GOLDEN_PIECES = 2;

export interface LootStep {
  itemId: string;
  // The bag slot given up first to make room, null when none is.
  sell: number | null;
}

function pieceFor(target: string, bag: readonly string[]): { id: string; consumes: number } {
  return stepToward(target, bag, BAG_SLOTS - bag.length <= 0);
}

// The next piece of `build` for this bag, without touching it; null once
// the build is done (or nothing in a full bag is worth less than it).
export function nextLootPiece(build: readonly string[], bag: readonly string[]): LootStep | null {
  const target = unsatisfied(build, bag)[0];
  if (target === undefined) return null;
  const step = pieceFor(target, bag);
  if (step.consumes > 0 || bag.length < BAG_SLOTS) return { itemId: step.id, sell: null };
  // A full bag and a piece that needs a slot.
  const unwanted = unwantedSlots(build, bag);
  let sell: number | null = null;
  if (unwanted.length > 0) sell = cheapestSlot(bag, unwanted);
  else {
    const cheapest = cheapestSlot(
      bag,
      bag.map((_, i) => i),
    );
    if ((ITEMS[target]?.cost ?? 0) > (ITEMS[bag[cheapest]!]?.cost ?? 0)) sell = cheapest;
  }
  if (sell === null) return null;
  const after = bag.filter((_, i) => i !== sell);
  return { itemId: pieceFor(target, after).id, sell };
}

// The build a seat walks: the one it was seated with, else its
// champion's planet build (content/royale_builds.ts), else its role's.
export function seatBuild(championId: string | null, kitBuild?: readonly string[]): string[] {
  if (kitBuild && kitBuild.length > 0) return [...kitBuild];
  return [...(planetBuild(championId) ?? roleBuild(championId))];
}

// Gives the champion its next piece of `build`; returns the item given, or
// null when the build is complete.
export function grantPiece(u: Unit, build: readonly string[]): string | null {
  if (u.kind !== 'champion') return null;
  const piece = nextLootPiece(build, u.items);
  if (!piece) return null;
  if (piece.sell !== null) {
    // A royale sale pays nothing: the slot is simply given up.
    const slot = piece.sell;
    u.items = u.items.filter((_, i) => i !== slot);
    recalcChampion(u);
  }
  return equipItem(u, piece.itemId) ? piece.itemId : null;
}

// Gives up to `count` pieces; returns the items given in order.
export function grantPieces(u: Unit, build: readonly string[], count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = grantPiece(u, build);
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

// The share of a takedown's heal and mana a killer on this streak gets.
export function streakShare(streak: number): number {
  return 1 / (1 + STREAK_FALLOFF * Math.max(0, streak - 1));
}

// A share of the maximum mana back, capped at full: what a takedown, a camp
// and a cache restore (TAKEDOWN_MANA, CAMP_MANA, CACHE_MANA).
export function manaShare(u: Unit, share: number): void {
  if (u.dead || u.maxMana <= 0) return;
  u.mana = Math.min(u.maxMana, u.mana + u.maxMana * share);
}
