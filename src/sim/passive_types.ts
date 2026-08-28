// The champion passive contract: code-bearing content (like bot Policies),
// hooked into fixed engine points. Passives must stay deterministic: sim
// state and ctx only, no wall clock, no unseeded randomness.

import type { CombatCtx } from './sim_context';
import type { DamageType } from './types';
import type { Unit } from './unit';

export type DamageVia = 'attack' | 'ability' | 'other';

export interface ChampionPassive {
  name: string;
  description: string;
  // After an auto-attack of `self` lands on `target`.
  onAttackHit?(ctx: CombatCtx, self: Unit, target: Unit): void;
  // After `self` pays for an ability cast (before it resolves).
  onCast?(ctx: CombatCtx, self: Unit, key: 'Q' | 'W' | 'E' | 'R'): void;
  // Before mitigation of damage dealt BY `self`; returns the new amount.
  modifyDamage?(
    ctx: CombatCtx,
    self: Unit,
    target: Unit,
    amount: number,
    dtype: DamageType,
    via: DamageVia,
  ): number;
  // Every 5th tick (4 Hz), staggered by unit id.
  onTick?(ctx: CombatCtx, self: Unit): void;
  // After a heal from `self` landed on `target` for `amount`.
  onHealGiven?(ctx: CombatCtx, self: Unit, target: Unit, amount: number): void;
  // After `self` earned a takedown (kill or assist) on an enemy champion
  // (kits-v2 cooldown events: winning an exchange buys back the tools).
  onTakedown?(ctx: CombatCtx, self: Unit, victim: Unit): void;
}
