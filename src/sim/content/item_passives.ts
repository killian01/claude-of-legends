// Item passives: code-bearing content on the champion-passive hook shapes,
// keyed by item id and dispatched from src/sim/passives.ts (the only place
// the engine calls them). Owning multiple copies of an item grants its
// passive ONCE. Deterministic like every passive: sim state and ctx only.
// The first three break the "stat sticks only" ceiling with one signature
// effect per role: sustain for tanks, an execute for carries, mobility for
// the attack-speed line.

import { addStatus, healFactor } from '../combat/status';
import type { DamageVia } from '../passive_types';
import type { CombatCtx } from '../sim_context';
import type { DamageType } from '../types';
import type { Unit } from '../unit';

export interface ItemPassiveDef {
  itemId: string;
  name: string;
  description: string;
  // After an auto-attack of `self` lands on `target`.
  onAttackHit?(ctx: CombatCtx, self: Unit, target: Unit): void;
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
}

const HEARTBEAT_CALM_S = 5;
const HEARTBEAT_HP_PCT_PER_S = 0.02;
// stepPassives fires each unit at 4 Hz.
const TICK_PERIOD_S = 0.25;

const DEATHMARK_THRESHOLD = 0.3;
const DEATHMARK_BONUS = 1.12;

const GALE_MS_PCT = 0.12;
const GALE_DURATION_S = 1.5;

const WORLDHEART: ItemPassiveDef = {
  itemId: 'worldheart',
  name: 'Heartbeat',
  description: 'After 5s without taking damage, regenerate 2% max health per second.',
  onTick(ctx, self) {
    if (self.hp >= self.maxHp) return;
    if (ctx.time - self.lastDamagedAt < HEARTBEAT_CALM_S) return;
    const amount = self.maxHp * HEARTBEAT_HP_PCT_PER_S * TICK_PERIOD_S;
    self.hp = Math.min(self.maxHp, self.hp + amount * healFactor(self, ctx.time));
  },
};

const DOOMBRAND: ItemPassiveDef = {
  itemId: 'doombrand',
  name: 'Deathmark',
  description: 'Your damage against targets below 30% health is increased by 12%.',
  modifyDamage(_ctx, _self, target, amount) {
    if (target.maxHp > 0 && target.hp / target.maxHp < DEATHMARK_THRESHOLD) {
      return amount * DEATHMARK_BONUS;
    }
    return amount;
  },
};

const SKYSHEAR: ItemPassiveDef = {
  itemId: 'skyshear',
  name: 'Gale',
  description: 'Attacks on champions grant 12% move speed for 1.5s.',
  onAttackHit(ctx, self, target) {
    if (target.kind !== 'champion') return;
    addStatus(self, {
      kind: 'buff',
      until: ctx.time + GALE_DURATION_S,
      msPct: GALE_MS_PCT,
      asPct: 0,
      armor: 0,
      mr: 0,
    });
  },
};

export const ITEM_PASSIVES: Readonly<Record<string, ItemPassiveDef>> = {
  [WORLDHEART.itemId]: WORLDHEART,
  [DOOMBRAND.itemId]: DOOMBRAND,
  [SKYSHEAR.itemId]: SKYSHEAR,
};
