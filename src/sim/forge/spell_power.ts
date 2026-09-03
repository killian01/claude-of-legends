// The power dial (CONTEXT.md): a spell's one intensity control, the
// Stat polygon's sibling. It scales the spell's AMOUNTS (damage,
// healing, crowd control durations) inside the engine's bounds and
// stops where the power budget runs out, exactly like a polygon vertex;
// searched rather than solved, because clamped scaling is monotone but
// not linear. The spell's STRUCTURE (cast kind, effect kinds, shapes,
// ranges) and its RHYTHM (cooldown, mana, cast range, windup) are not
// its business.

import type { AbilityDef, CastSpec } from '../combat/casting';
import type { EffectSpec } from '../combat/effects';
import type { AbilityKey } from '../types';
import { type Bound, CAST_BOUNDS, EFFECT_BOUNDS } from './bounds';
import { budgetOf, POWER_BUDGET } from './budget';
import type { ForgedChampionDef } from './forged_def';

export const POWER_DIAL_MIN = 0.25;
export const POWER_DIAL_MAX = 2.5;

// The amount fields per effect kind: what the dial scales. Anything not
// listed is structure and stays put.
const EFFECT_AMOUNTS: Record<string, readonly string[]> = {
  damage: ['base', 'adRatio', 'apRatio', 'maxHpPct'],
  heal: ['base', 'apRatio', 'maxHpPct'],
  dot: ['perSecond'],
  slow: ['pct'],
  root: ['duration'],
  stun: ['duration'],
  taunt: ['duration'],
  knockup: ['duration'],
  knockback: ['distance'],
  pull: ['distance'],
  blind: ['factor'],
  stealth: ['duration'],
  untargetable: ['duration'],
  shield: ['base', 'apRatio'],
  grievous: ['factor'],
  buff: ['msPct', 'asPct', 'armor', 'mr'],
  cooldownRefund: ['pctOfRemaining'],
};

function clampTo(bound: Bound | undefined, v: number): number {
  if (!bound) return v;
  return Math.min(bound.max, Math.max(bound.min, v));
}

function scaleEffects(list: readonly EffectSpec[] | undefined, f: number): void {
  for (const e of list ?? []) {
    const fields = EFFECT_AMOUNTS[e.kind] ?? [];
    const bounds = EFFECT_BOUNDS[e.kind] ?? {};
    const rec = e as unknown as Record<string, unknown>;
    for (const field of fields) {
      const v = rec[field];
      if (typeof v === 'number') rec[field] = clampTo(bounds[field], v * f);
    }
    // Effects that carry effects scale what they carry.
    if (e.kind === 'mark') scaleEffects(e.onTrigger, f);
    if (e.kind === 'conditional') {
      scaleEffects(e.effects, f);
      scaleEffects(e.otherwise, f);
    }
    if (e.kind === 'empower') {
      scaleEffects(e.bonus, f);
      scaleEffects(e.splash, f);
    }
    if (e.kind === 'shield' && e.burst) {
      scaleEffects(e.burst.onBreak, f);
      scaleEffects(e.burst.onExpire, f);
    }
  }
}

function scaleSpec(spec: CastSpec, f: number): void {
  switch (spec.kind) {
    case 'skillshot':
      scaleEffects(spec.onHit, f);
      scaleEffects(spec.allyEffects, f);
      if (spec.chain) scaleEffects(spec.chain.onHit, f);
      if (spec.aftershock) scaleEffects(spec.aftershock.effects, f);
      break;
    case 'zone':
      scaleEffects(spec.onEnter, f);
      scaleEffects(spec.onTick, f);
      scaleEffects(spec.allyOnTick, f);
      scaleEffects(spec.onDetonate, f);
      if (spec.boundary) scaleEffects(spec.boundary.effects, f);
      if (spec.leaveZone) scaleEffects(spec.leaveZone.onTick, f);
      break;
    case 'self_or_ally':
      scaleEffects(spec.effects, f);
      break;
    case 'enemy_target':
      scaleEffects(spec.effects, f);
      scaleEffects(spec.selfEffects, f);
      break;
    case 'cone':
      scaleEffects(spec.onHit, f);
      break;
    case 'burst':
      scaleEffects(spec.effects, f);
      scaleEffects(spec.selfEffects, f);
      break;
    case 'dash':
      scaleEffects(spec.onLand, f);
      scaleEffects(spec.selfEffects, f);
      scaleEffects(spec.passThrough, f);
      break;
    case 'wall':
      // A wall's whole payload is how long it stands.
      (spec as { duration: number }).duration = clampTo(
        CAST_BOUNDS.wall?.duration,
        spec.duration * f,
      );
      break;
  }
}

// The ability at `factor` times the anchor's amounts, bounds respected.
export function scaleAbility(anchor: AbilityDef, factor: number): AbilityDef {
  const out = structuredClone(anchor) as AbilityDef;
  scaleSpec(out.spec, factor);
  for (const o of out.atRank ?? []) scaleSpec(o.spec, factor);
  return out;
}

export interface PowerGrant {
  ability: AbilityDef;
  factor: number;
}

// The dial's grant: the requested factor, or the largest the budget can
// afford, searched down the monotone cost curve. Even at the floor an
// over-budget champion gets the floor: the dial can always come down.
export function grantSpellPower(
  def: ForgedChampionDef,
  key: AbilityKey,
  anchor: AbilityDef,
  want: number,
): PowerGrant {
  const f = Math.min(POWER_DIAL_MAX, Math.max(POWER_DIAL_MIN, want));
  const totalAt = (factor: number): { ability: AbilityDef; total: number } => {
    const ability = scaleAbility(anchor, factor);
    const total = budgetOf({
      ...def,
      abilities: { ...def.abilities, [key]: ability },
    }).total;
    return { ability, total };
  };
  let at = totalAt(f);
  if (at.total <= POWER_BUDGET) return { ability: at.ability, factor: f };
  let lo = POWER_DIAL_MIN;
  let hi = f;
  for (let i = 0; i < 32; i += 1) {
    const mid = (lo + hi) / 2;
    if (totalAt(mid).total <= POWER_BUDGET) lo = mid;
    else hi = mid;
  }
  at = totalAt(lo);
  return { ability: at.ability, factor: lo };
}

export interface KitFit {
  abilities: Record<AbilityKey, AbilityDef>;
  factor: number;
}

// The whole kit at one shared factor: the largest the budget affords
// inside the dial's range, so a proposal lands on the budget line with
// its spells' relative weights intact. This is how the kit conversation
// hands the numbers to the arithmetic instead of the model: the model
// owns structure and theme, the fit owns the amounts. Null when even the
// floor overspends: the structure itself is too heavy, and no trimming
// of amounts can help.
export function fitKitPower(def: ForgedChampionDef): KitFit | null {
  const at = (factor: number): KitFit & { total: number } => {
    const abilities = {
      Q: scaleAbility(def.abilities.Q, factor),
      W: scaleAbility(def.abilities.W, factor),
      E: scaleAbility(def.abilities.E, factor),
      R: scaleAbility(def.abilities.R, factor),
    };
    return { abilities, factor, total: budgetOf({ ...def, abilities }).total };
  };
  const top = at(POWER_DIAL_MAX);
  if (top.total <= POWER_BUDGET) return { abilities: top.abilities, factor: top.factor };
  if (!(at(POWER_DIAL_MIN).total <= POWER_BUDGET)) return null;
  let lo = POWER_DIAL_MIN;
  let hi = POWER_DIAL_MAX;
  for (let i = 0; i < 32; i += 1) {
    const mid = (lo + hi) / 2;
    if (at(mid).total <= POWER_BUDGET) lo = mid;
    else hi = mid;
  }
  const fit = at(lo);
  return { abilities: fit.abilities, factor: lo };
}
