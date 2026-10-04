// Runs the champion, item AND Graft passive hooks. Passives are code-bearing
// content (ChampionDef in src/sim/content/champions/, ITEM_PASSIVES in
// src/sim/content/item_passives.ts; a forged champion's come instantiated
// from a template); this module is the only place the engine calls them
// from. The battle royale's Grafts (content/grafts.ts) run beside the item
// passives, only for a champion that holds one: everywhere else the list
// is empty and nothing more runs.

import { GRAFTS, type GraftDef } from './content/grafts';
import { ITEM_PASSIVES, type ItemPassiveDef } from './content/item_passives';
import type { ChampionPassive, DamageVia } from './passive_types';
import type { CombatCtx } from './sim_context';
import type { DamageType } from './types';
import type { Unit } from './unit';

export const PASSIVE_PERIOD_TICKS = 5;

export function passiveOf(u: Unit): ChampionPassive | undefined {
  if (u.kind !== 'champion') return undefined;
  return u.champion?.passive;
}

const NO_ITEM_PASSIVES: readonly ItemPassiveDef[] = [];

// The unit's live item passives, each unique item granting its passive once.
export function itemPassivesOf(u: Unit): readonly ItemPassiveDef[] {
  if (u.kind !== 'champion' || u.items.length === 0) return NO_ITEM_PASSIVES;
  let out: ItemPassiveDef[] | null = null;
  for (const id of u.items) {
    const p = ITEM_PASSIVES[id];
    if (!p) continue;
    if (out === null) out = [p];
    else if (!out.includes(p)) out.push(p);
  }
  return out ?? NO_ITEM_PASSIVES;
}

const NO_GRAFTS: readonly GraftDef[] = [];

// The unit's Grafts with a hook, each once (a Sprout's second stack adds no
// second hook).
export function graftPassivesOf(u: Unit): readonly GraftDef[] {
  if (u.kind !== 'champion' || u.grafts.length === 0) return NO_GRAFTS;
  const out: GraftDef[] = [];
  for (const id of u.grafts) {
    const g = GRAFTS[id];
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

// One-line call sites for the engine: item and Graft onAttackHit after a
// landed auto.
export function runItemAttackHits(ctx: CombatCtx, self: Unit, target: Unit): void {
  for (const p of itemPassivesOf(self)) p.onAttackHit?.(ctx, self, target);
  for (const g of graftPassivesOf(self)) g.onAttackHit?.(ctx, self, target);
}

// A hit `target` took and stood (combat/damage.ts): its Grafts' answer.
export function runGraftDamaged(
  ctx: CombatCtx,
  target: Unit,
  source: Unit | undefined,
  amount: number,
  via: DamageVia,
): void {
  for (const g of graftPassivesOf(target)) g.onDamaged?.(ctx, target, source, amount, via);
}

// A takedown `self` earned, kill or assist (the sim's death handling).
export function runGraftTakedown(ctx: CombatCtx, self: Unit, victim: Unit): void {
  for (const g of graftPassivesOf(self)) g.onTakedown?.(ctx, self, victim);
}

// A cast `self` paid for, its cooldown set (combat/casting.ts).
export function runGraftCast(ctx: CombatCtx, self: Unit, key: 'Q' | 'W' | 'E' | 'R'): void {
  for (const g of graftPassivesOf(self)) g.onCast?.(ctx, self, key);
}

// Item and Graft damage modifiers, applied after the champion passive's.
export function applyItemDamageModifiers(
  ctx: CombatCtx,
  self: Unit,
  target: Unit,
  amount: number,
  dtype: DamageType,
  via: DamageVia,
): number {
  for (const p of itemPassivesOf(self)) {
    if (p.modifyDamage) amount = p.modifyDamage(ctx, self, target, amount, dtype, via);
  }
  for (const g of graftPassivesOf(self)) {
    if (g.modifyDamage) amount = g.modifyDamage(ctx, self, target, amount, dtype, via);
  }
  return amount;
}

export function stepPassives(ctx: CombatCtx, tickCount: number): void {
  for (const u of ctx.units.values()) {
    if (u.kind !== 'champion' || u.dead || ctx.dead.has(u.id)) continue;
    if ((tickCount + u.id) % PASSIVE_PERIOD_TICKS !== 0) continue;
    passiveOf(u)?.onTick?.(ctx, u);
    for (const p of itemPassivesOf(u)) p.onTick?.(ctx, u);
    for (const g of graftPassivesOf(u)) g.onTick?.(ctx, u);
  }
}
