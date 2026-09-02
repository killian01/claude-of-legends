// The power budget (ADR 0006, ADR 0013): every stat point and every effect
// primitive has a price, and a forged champion's bill must fit the three
// envelopes (forge/envelopes.ts) whose sum is POWER_BUDGET. This costing
// is the balance authority for everything but the size of one hit (that
// is forge/burst.ts); the per-field bounds in forge/bounds.ts are only
// the rails around it. Pure arithmetic on the def: same input, same cost,
// in every host. Calibrated so the ten roster champions, converted to
// forged shape, all fit with the priciest just under each envelope
// (tests/forge.test.ts pins this).

import type { AbilityDef, CastSpec } from '../combat/casting';
import { specForRank } from '../combat/casting';
import type { EffectSpec } from '../combat/effects';
import type { ChampionBaseStats, ChampionGrowth } from '../content/champions';
import type { AbilityKey } from '../types';
import { BASE_STAT_BOUNDS, GROWTH_BOUNDS } from './bounds';
import { GROWTH_ENVELOPE, KIT_ENVELOPE, STAT_ENVELOPE } from './envelopes';
import type { ForgedChampionDef, ForgedPassiveRef } from './forged_def';
import { PASSIVE_TEMPLATES } from './passive_templates';

export const POWER_BUDGET = STAT_ENVELOPE + GROWTH_ENVELOPE + KIT_ENVELOPE;

// One budget point is roughly one point of base damage on a single-target
// hit; everything else is priced relative to that. RATIO_VALUE is what a
// full 1.0 ad or ap ratio is worth once items exist.
export const EFFECT_PRICES = {
  ratioValue: 55,
  maxHpPctValue: 900,
  healWeight: 1.0,
  dotWeight: 0.8,
  slowPerPctSecond: 90,
  rootPerSecond: 110,
  stunPerSecond: 140,
  tauntPerSecond: 130,
  knockupPerSecond: 140,
  knockbackPerUnit: 22,
  pullPerUnit: 18,
  blindPerFactorSecond: 90,
  stealthPerSecond: 35,
  untargetablePerSecond: 110,
  shieldWeight: 0.9,
  shieldBurstWeight: 0.8,
  grievousPerFactorSecond: 80,
  buffMsPctSecond: 70,
  buffAsPctSecond: 60,
  buffArmorSecond: 1.2,
  buffMrSecond: 1.2,
  markOverhead: 5,
  // A conditional resolves one branch: the stronger one is paid in full,
  // the weaker one at a quarter (it still adds coverage).
  conditionalWeakBranch: 0.25,
  cooldownRefundPerPct: 60,
  empowerSplashWeight: 0.8,
} as const;

export const CAST_PRICES = {
  // Deliveries: how reliably and how widely a payload lands.
  skillshotPierce: 1.5,
  skillshotAllyWeight: 0.8,
  skillshotChainWeight: 0.5,
  skillshotAftershockWeight: 0.6,
  skillshotWallPerSecond: 12,
  // A repeating zone tick is heavily discounted: standing in it is the
  // victim's mistake, and leaving is always on the table.
  zoneTickWeight: 0.35,
  zoneDetonateWeight: 0.8,
  zoneBoundaryWeight: 0.25,
  zoneRevealPerSecond: 6,
  aoeWeight: 1.25,
  pointClickWeight: 1.35,
  mobilityPerRange: 14,
  blinkPremium: 35,
  dashToAllyDiscount: 0.8,
  dashPassThroughWeight: 1.3,
  dashUntargetable: 45,
  wallPerLengthSecond: 4.5,
  recastCost: 40,
} as const;

// Availability: a payload on a short cooldown is most of a champion's
// power; the same payload on an ultimate's clock is a moment. cd 4 counts
// full price, cd 8 about 70 percent, cd 60 about 15 percent.
export const AVAIL_PIVOT = 10;
export const AVAIL_SOFT = 6;
// Paying mana and telegraphing a windup both buy the cost down, capped.
export const MANA_RELIEF_PER_POINT = 0.0024;
export const MANA_RELIEF_CAP = 0.2;
export const WINDUP_RELIEF_PER_SECOND = 0.4;
export const WINDUP_RELIEF_CAP = 0.2;

// Price per point ABOVE the field's hard minimum (forge/bounds.ts), so a
// stat cost is never negative and dumping a stat frees budget for spells.
export const BASE_STAT_PRICES: Record<keyof ChampionBaseStats, number> = {
  hp: 0.15,
  mana: 0.03,
  ad: 2,
  ap: 0,
  armor: 1.5,
  mr: 1.5,
  attackRange: 7,
  attackSpeed: 80,
  moveSpeed: 50,
  hpRegen: 5,
  manaRegen: 5,
  radius: 0,
};

export const GROWTH_PRICES: Record<keyof ChampionGrowth, number> = {
  hp: 0.4,
  mana: 0.15,
  ad: 9,
  armor: 10,
  mr: 10,
};

export function costOfEffects(list: readonly EffectSpec[] | undefined): number {
  if (!list) return 0;
  let total = 0;
  for (const e of list) total += costOfEffect(e);
  return total;
}

export function costOfEffect(e: EffectSpec): number {
  const P = EFFECT_PRICES;
  switch (e.kind) {
    case 'damage':
      return (
        e.base +
        (e.adRatio ?? 0) * P.ratioValue +
        (e.apRatio ?? 0) * P.ratioValue +
        (e.maxHpPct ?? 0) * P.maxHpPctValue
      );
    case 'heal':
      return (
        (e.base + (e.apRatio ?? 0) * P.ratioValue + (e.maxHpPct ?? 0) * P.maxHpPctValue) *
        P.healWeight
      );
    case 'dot':
      return e.perSecond * e.duration * P.dotWeight;
    case 'slow':
      return e.pct * e.duration * P.slowPerPctSecond;
    case 'root':
      return e.duration * P.rootPerSecond;
    case 'stun':
      return e.duration * P.stunPerSecond;
    case 'taunt':
      return e.duration * P.tauntPerSecond;
    case 'knockup':
      return e.duration * P.knockupPerSecond;
    case 'knockback':
      return e.distance * P.knockbackPerUnit;
    case 'pull':
      return e.distance * P.pullPerUnit;
    case 'blind':
      return e.duration * e.factor * P.blindPerFactorSecond;
    case 'stealth':
      return e.duration * P.stealthPerSecond;
    case 'untargetable':
      return e.duration * P.untargetablePerSecond;
    case 'shield': {
      const value = (e.base + (e.apRatio ?? 0) * P.ratioValue) * P.shieldWeight;
      const burst = e.burst
        ? Math.max(costOfEffects(e.burst.onBreak), costOfEffects(e.burst.onExpire)) *
          P.shieldBurstWeight
        : 0;
      return value + burst;
    }
    case 'grievous':
      return e.duration * e.factor * P.grievousPerFactorSecond;
    case 'buff':
      return (
        e.duration *
        ((e.msPct ?? 0) * P.buffMsPctSecond +
          (e.asPct ?? 0) * P.buffAsPctSecond +
          (e.armor ?? 0) * P.buffArmorSecond +
          (e.mr ?? 0) * P.buffMrSecond)
      );
    case 'mark':
      return P.markOverhead + costOfEffects(e.onTrigger) / e.stacksToTrigger;
    case 'conditional': {
      const a = costOfEffects(e.effects);
      const b = costOfEffects(e.otherwise);
      return Math.max(a, b) + P.conditionalWeakBranch * Math.min(a, b);
    }
    case 'cooldownRefund':
      return e.pctOfRemaining * P.cooldownRefundPerPct;
    case 'empower':
      return costOfEffects(e.bonus) + costOfEffects(e.splash) * P.empowerSplashWeight;
  }
}

export function costOfCast(spec: CastSpec, castRange: number): number {
  const C = CAST_PRICES;
  switch (spec.kind) {
    case 'skillshot': {
      let payload = costOfEffects(spec.onHit) * (spec.pierce ? C.skillshotPierce : 1);
      payload += costOfEffects(spec.allyEffects) * C.skillshotAllyWeight;
      if (spec.chain) payload += costOfEffects(spec.chain.onHit) * C.skillshotChainWeight;
      if (spec.leaveWall) payload += spec.leaveWall.duration * C.skillshotWallPerSecond;
      if (spec.aftershock) {
        payload += costOfEffects(spec.aftershock.effects) * C.skillshotAftershockWeight;
      }
      return payload * (0.85 + spec.radius * 0.25) * (1 + spec.range * 0.015);
    }
    case 'zone': {
      const ticks = spec.duration / (spec.tickEvery ?? 0.5);
      let payload = costOfEffects(spec.onEnter);
      payload +=
        (costOfEffects(spec.onTick) + costOfEffects(spec.allyOnTick)) * ticks * C.zoneTickWeight;
      payload += costOfEffects(spec.onDetonate) * C.zoneDetonateWeight;
      if (spec.boundary) {
        payload +=
          costOfEffects(spec.boundary.effects) *
          (spec.duration / spec.boundary.perUnitEvery) *
          C.zoneBoundaryWeight;
      }
      if (spec.reveal) payload += spec.duration * C.zoneRevealPerSecond;
      if (spec.leaveZone) {
        const lz = spec.leaveZone;
        payload +=
          costOfEffects(lz.onTick) *
          (lz.duration / (lz.tickEvery ?? 0.5)) *
          C.zoneTickWeight *
          (0.8 + lz.radius * 0.15);
      }
      return payload * (0.8 + spec.radius * 0.15) * (1 + castRange * 0.012);
    }
    case 'self_or_ally':
      return costOfEffects(spec.effects);
    case 'enemy_target':
      return (
        (costOfEffects(spec.effects) * C.pointClickWeight + costOfEffects(spec.selfEffects)) *
        (1 + castRange * 0.015)
      );
    case 'cone':
      return (
        costOfEffects(spec.onHit) * C.aoeWeight * (0.8 + spec.range * 0.08 + spec.halfAngle * 0.25)
      );
    case 'burst':
      return (
        costOfEffects(spec.effects) * C.aoeWeight * (0.7 + spec.radius * 0.15) +
        costOfEffects(spec.selfEffects)
      );
    case 'dash': {
      let cost = spec.range * C.mobilityPerRange * (spec.toAlly ? C.dashToAllyDiscount : 1);
      if (spec.speed === undefined) cost += C.blinkPremium;
      cost += costOfEffects(spec.onLand) * (0.9 + (spec.landRadius ?? 0) * 0.15);
      cost += costOfEffects(spec.passThrough) * C.dashPassThroughWeight;
      cost += costOfEffects(spec.selfEffects);
      if (spec.untargetableDuringTravel) cost += C.dashUntargetable;
      return cost;
    }
    case 'wall':
      return spec.length * spec.duration * C.wallPerLengthSecond;
  }
}

// The full ability price: the priciest reachable rank spec, scaled by how
// often the button is available and relieved by what the press costs the
// caster (mana, windup telegraph).
export function costOfAbility(def: AbilityDef): number {
  let delivery = costOfCast(def.spec, def.castRange);
  if (def.atRank) {
    const maxRank = Math.max(...def.atRank.map((o) => o.rank));
    delivery = Math.max(delivery, costOfCast(specForRank(def, maxRank), def.castRange));
  }
  const availability = AVAIL_PIVOT / (AVAIL_SOFT + def.cooldown);
  const manaRelief = Math.min(MANA_RELIEF_CAP, def.manaCost * MANA_RELIEF_PER_POINT);
  const windupRelief = Math.min(WINDUP_RELIEF_CAP, (def.windup ?? 0) * WINDUP_RELIEF_PER_SECOND);
  let cost = delivery * availability * (1 - manaRelief) * (1 - windupRelief);
  if (def.recast) cost += CAST_PRICES.recastCost;
  return cost;
}

export function costOfBaseStats(base: ChampionBaseStats): number {
  let total = 0;
  for (const key of Object.keys(BASE_STAT_PRICES) as (keyof ChampionBaseStats)[]) {
    total += Math.max(0, base[key] - BASE_STAT_BOUNDS[key].min) * BASE_STAT_PRICES[key];
  }
  return total;
}

export function costOfGrowth(growth: ChampionGrowth): number {
  let total = 0;
  for (const key of Object.keys(GROWTH_PRICES) as (keyof ChampionGrowth)[]) {
    total += Math.max(0, growth[key] - GROWTH_BOUNDS[key].min) * GROWTH_PRICES[key];
  }
  return total;
}

// The template prices itself: flat base plus linear per-param pricing,
// clamped at zero (a weak setting never refunds points).
export function costOfPassive(ref: ForgedPassiveRef): number {
  const tpl = PASSIVE_TEMPLATES[ref.template];
  if (!tpl) return 0;
  let total = tpl.baseCost;
  for (const param of tpl.params) {
    total += (ref.params[param.key] ?? param.min) * param.costPerUnit;
  }
  return Math.max(0, total);
}

export interface BudgetBreakdown {
  stats: number;
  growth: number;
  abilities: Record<AbilityKey, number>;
  passive: number;
  total: number;
}

// The whole bill, itemized for the Forge's budget meter.
export function budgetOf(def: ForgedChampionDef): BudgetBreakdown {
  const abilities = {
    Q: costOfAbility(def.abilities.Q),
    W: costOfAbility(def.abilities.W),
    E: costOfAbility(def.abilities.E),
    R: costOfAbility(def.abilities.R),
  };
  const stats = costOfBaseStats(def.base);
  const growth = costOfGrowth(def.growth);
  const passive = costOfPassive(def.passive);
  return {
    stats,
    growth,
    abilities,
    passive,
    total: stats + growth + passive + abilities.Q + abilities.W + abilities.E + abilities.R,
  };
}
