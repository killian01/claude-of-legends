// Hard per-field bounds for forged champions (ADR 0006): the sanity rails
// around the power budget, which stays the sole balance authority
// (forge/budget.ts). Everything here is a runtime check, not a type check:
// a forged def ultimately arrives over the wire, so the walker trusts
// nothing, rejects non-finite numbers, unknown kinds, and over-deep
// nesting, and reports every violation as a readable string (the Forge
// editor and the agent endpoint both need the full list, not the first
// failure).

import type { AbilityDef, CastSpec } from '../combat/casting';
import type { EffectSpec } from '../combat/effects';
import type { ChampionBaseStats, ChampionGrowth } from '../content/champions';
import { CAST_SOUNDS, isCastSound } from '../content/sounds';
import type { ForgedChampionDef } from './forged_def';

export interface Bound {
  min: number;
  max: number;
  integer?: boolean;
}

function B(min: number, max: number, integer?: boolean): Bound {
  return integer ? { min, max, integer } : { min, max };
}

// Bounds sized from the roster extremes with working margin: the roster is
// the proof these values make a playable champion. ap stays pinned at zero
// exactly as it is for all ten roster champions (AP comes from items).
export const BASE_STAT_BOUNDS: Record<keyof ChampionBaseStats, Bound> = {
  hp: B(400, 800),
  mana: B(200, 600),
  ad: B(40, 80),
  ap: B(0, 0),
  armor: B(15, 45),
  mr: B(15, 45),
  attackRange: B(1, 7.5),
  attackSpeed: B(0.4, 1.0),
  moveSpeed: B(3.3, 4.2),
  hpRegen: B(0.5, 3),
  manaRegen: B(0.5, 3),
  radius: B(0.5, 0.9),
};

export const GROWTH_BOUNDS: Record<keyof ChampionGrowth, Bound> = {
  hp: B(40, 130),
  mana: B(10, 60),
  ad: B(1, 7),
  armor: B(1, 4.5),
  mr: B(0.5, 3),
};

// Per-ability numbers. Basics and ultimates get different cooldown rails: a
// 4 second ultimate must be impossible even for a kit that could afford it.
// The flavor line (CONTEXT.md): one authored sentence per spell and for
// the passive, capped so a card stays a card.
export const FLAVOR_MAX = 160;

export const ABILITY_BOUNDS = {
  manaCost: B(0, 120),
  castRange: B(0, 130),
  windup: B(0, 1.5),
  basicCooldown: B(2, 20),
  ultCooldown: B(30, 90),
  recastWindow: B(1, 8),
} as const;

export const CAST_BOUNDS: Record<string, Record<string, Bound>> = {
  skillshot: { speed: B(8, 45), radius: B(0.3, 2), range: B(3, 130) },
  zone: { radius: B(1.5, 7), duration: B(0.5, 6), tickEvery: B(0.25, 2), detonateDelay: B(0.4, 3) },
  self_or_ally: { searchRadius: B(0, 4) },
  enemy_target: { searchRadius: B(0.5, 4) },
  cone: { range: B(2, 7), halfAngle: B(Math.PI / 12, Math.PI / 2) },
  burst: { radius: B(1, 5) },
  dash: { range: B(1.5, 8), speed: B(10, 22), landRadius: B(0, 3.5) },
  wall: { length: B(2, 6), duration: B(1, 8) },
};

export const EFFECT_BOUNDS: Record<string, Record<string, Bound>> = {
  damage: { base: B(0, 320), adRatio: B(0, 2.2), apRatio: B(0, 1.6), maxHpPct: B(0, 0.15) },
  heal: { base: B(0, 200), apRatio: B(0, 1.2), maxHpPct: B(0, 0.2) },
  slow: { pct: B(0.05, 0.6), duration: B(0.25, 3) },
  root: { duration: B(0.25, 1.8) },
  stun: { duration: B(0.25, 1.6) },
  taunt: { duration: B(0.25, 1.5) },
  stealth: { duration: B(0.25, 3) },
  blind: { duration: B(0.25, 2), factor: B(0.05, 0.8) },
  knockback: { distance: B(0.5, 3) },
  pull: { distance: B(1, 7) },
  knockup: { duration: B(0.25, 1.2) },
  untargetable: { duration: B(0.2, 1.5) },
  shield: { base: B(0, 220), apRatio: B(0, 1.2), duration: B(0.5, 4) },
  dot: { duration: B(0.5, 4), perSecond: B(1, 40) },
  grievous: { duration: B(0.25, 3), factor: B(0.05, 0.5) },
  buff: { duration: B(0.5, 5), msPct: B(0, 0.5), asPct: B(0, 0.7), armor: B(0, 25), mr: B(0, 25) },
  mark: { duration: B(1, 6), stacksToTrigger: B(2, 4, true) },
  conditional: {},
  cooldownRefund: { pctOfRemaining: B(0.05, 1) },
  empower: { duration: B(0.5, 4), splashRadius: B(0, 3) },
};

export const PREDICATE_BOUNDS: Record<string, Record<string, Bound>> = {
  distanceAtLeast: { distance: B(0, 130) },
  targetHpBelow: { frac: B(0.05, 0.9) },
  targetDying: {},
  targetIsolated: { radius: B(1, 8) },
  targetSlowed: {},
  targetNearTerrain: { distance: B(0.5, 3) },
  targetIsChampion: {},
  targetHasSourceDot: {},
  withinCenter: { radius: B(0.5, 4) },
};

export const NESTED_BOUNDS = {
  chainRadius: B(1, 5),
  leaveWallDuration: B(0.5, 8),
  aftershockDelay: B(0.5, 3),
  aftershockRadius: B(0.5, 2.5),
  aftershockSpacing: B(1, 4),
  boundaryPerUnitEvery: B(0.5, 4),
  leaveZoneRadius: B(1, 5),
  leaveZoneDuration: B(0.5, 4),
  leaveZoneTickEvery: B(0.25, 2),
  toAllySearchRadius: B(1, 5),
  shieldBurstRadius: B(1, 4),
} as const;

// Structural limits: what keeps a wire-delivered kit bounded in size and the
// costing walk bounded in depth.
export const EFFECT_LIST_MAX = 8;
export const EFFECT_DEPTH_MAX = 5;
export const ABILITY_EFFECT_MAX = 24;
export const AT_RANK_MAX = 2;

// Forged kits deal physical and magic damage; true damage stays an engine
// tool (tower heat, executes the roster itself does not print).
const FORGED_DAMAGE_TYPES: readonly string[] = ['physical', 'magic'];

function checkNum(errors: string[], path: string, value: unknown, bound: Bound): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}: must be a finite number`);
    return;
  }
  if (value < bound.min || value > bound.max) {
    errors.push(`${path}: ${value} is outside [${bound.min}, ${bound.max}]`);
    return;
  }
  if (bound.integer && !Number.isInteger(value)) {
    errors.push(`${path}: ${value} must be an integer`);
  }
}

function checkOptNum(errors: string[], path: string, value: unknown, bound: Bound): void {
  if (value === undefined) return;
  checkNum(errors, path, value, bound);
}

function checkOptBool(errors: string[], path: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean') {
    errors.push(`${path}: must be a boolean when present`);
  }
}

function checkFields(
  errors: string[],
  path: string,
  obj: Record<string, unknown>,
  bounds: Record<string, Bound>,
  required: readonly string[],
): void {
  for (const [field, bound] of Object.entries(bounds)) {
    if (required.includes(field)) checkNum(errors, `${path}.${field}`, obj[field], bound);
    else checkOptNum(errors, `${path}.${field}`, obj[field], bound);
  }
}

interface Walk {
  effects: number;
}

function checkPredicate(errors: string[], path: string, p: unknown): void {
  if (typeof p !== 'object' || p === null) {
    errors.push(`${path}: must be a predicate object`);
    return;
  }
  const pred = p as Record<string, unknown>;
  const bounds = typeof pred.kind === 'string' ? PREDICATE_BOUNDS[pred.kind] : undefined;
  if (!bounds) {
    errors.push(`${path}.kind: unknown predicate kind '${String(pred.kind)}'`);
    return;
  }
  checkFields(errors, path, pred, bounds, Object.keys(bounds));
}

function checkEffectList(
  errors: string[],
  path: string,
  list: unknown,
  depth: number,
  walk: Walk,
  required: boolean,
): void {
  if (list === undefined) {
    if (required) errors.push(`${path}: must be an effect list`);
    return;
  }
  if (!Array.isArray(list)) {
    errors.push(`${path}: must be an effect list`);
    return;
  }
  if (depth > EFFECT_DEPTH_MAX) {
    errors.push(`${path}: effects nest deeper than ${EFFECT_DEPTH_MAX}`);
    return;
  }
  if (list.length > EFFECT_LIST_MAX) {
    errors.push(`${path}: ${list.length} effects in one list (max ${EFFECT_LIST_MAX})`);
    return;
  }
  for (let i = 0; i < list.length; i++) {
    checkEffect(errors, `${path}[${i}]`, list[i], depth, walk);
  }
}

function checkEffect(errors: string[], path: string, e: unknown, depth: number, walk: Walk): void {
  walk.effects += 1;
  if (typeof e !== 'object' || e === null) {
    errors.push(`${path}: must be an effect object`);
    return;
  }
  const fx = e as Record<string, unknown>;
  const bounds = typeof fx.kind === 'string' ? EFFECT_BOUNDS[fx.kind] : undefined;
  if (!bounds) {
    errors.push(`${path}.kind: unknown effect kind '${String(fx.kind)}'`);
    return;
  }
  switch (fx.kind as EffectSpec['kind']) {
    case 'damage':
      checkFields(errors, path, fx, bounds, ['base']);
      if (!FORGED_DAMAGE_TYPES.includes(fx.dtype as string)) {
        errors.push(`${path}.dtype: must be 'physical' or 'magic'`);
      }
      break;
    case 'heal':
      checkFields(errors, path, fx, bounds, ['base']);
      break;
    case 'buff':
      checkFields(errors, path, fx, bounds, ['duration']);
      break;
    case 'dot':
      checkFields(errors, path, fx, bounds, ['duration', 'perSecond']);
      if (!FORGED_DAMAGE_TYPES.includes(fx.dtype as string)) {
        errors.push(`${path}.dtype: must be 'physical' or 'magic'`);
      }
      break;
    case 'knockback':
      checkFields(errors, path, fx, bounds, ['distance']);
      if (
        fx.direction !== undefined &&
        fx.direction !== 'away' &&
        fx.direction !== 'aside' &&
        fx.direction !== 'toCenter'
      ) {
        errors.push(`${path}.direction: must be 'away', 'aside', or 'toCenter'`);
      }
      break;
    case 'shield': {
      checkFields(errors, path, fx, bounds, ['base', 'duration']);
      if (fx.burst !== undefined) {
        if (typeof fx.burst !== 'object' || fx.burst === null) {
          errors.push(`${path}.burst: must be an object`);
          break;
        }
        const burst = fx.burst as Record<string, unknown>;
        checkNum(errors, `${path}.burst.radius`, burst.radius, NESTED_BOUNDS.shieldBurstRadius);
        checkEffectList(errors, `${path}.burst.onBreak`, burst.onBreak, depth + 1, walk, false);
        checkEffectList(errors, `${path}.burst.onExpire`, burst.onExpire, depth + 1, walk, false);
      }
      break;
    }
    case 'mark':
      checkFields(errors, path, fx, bounds, ['duration', 'stacksToTrigger']);
      checkEffectList(errors, `${path}.onTrigger`, fx.onTrigger, depth + 1, walk, true);
      break;
    case 'conditional':
      checkPredicate(errors, `${path}.when`, fx.when);
      checkEffectList(errors, `${path}.effects`, fx.effects, depth + 1, walk, true);
      checkEffectList(errors, `${path}.otherwise`, fx.otherwise, depth + 1, walk, false);
      break;
    case 'cooldownRefund':
      checkFields(errors, path, fx, bounds, ['pctOfRemaining']);
      if (fx.key !== 'Q' && fx.key !== 'W' && fx.key !== 'E' && fx.key !== 'R') {
        errors.push(`${path}.key: must be Q, W, E, or R`);
      }
      break;
    case 'empower':
      checkFields(errors, path, fx, bounds, ['duration']);
      checkEffectList(errors, `${path}.bonus`, fx.bonus, depth + 1, walk, true);
      checkEffectList(errors, `${path}.splash`, fx.splash, depth + 1, walk, false);
      break;
    default:
      // Every remaining kind carries only the numeric fields its bounds
      // table declares, all required.
      checkFields(errors, path, fx, bounds, Object.keys(bounds));
      break;
  }
}

export function checkCastSpec(errors: string[], path: string, spec: unknown, walk: Walk): void {
  if (typeof spec !== 'object' || spec === null) {
    errors.push(`${path}: must be a cast spec object`);
    return;
  }
  const s = spec as Record<string, unknown>;
  const bounds = typeof s.kind === 'string' ? CAST_BOUNDS[s.kind] : undefined;
  if (!bounds) {
    errors.push(`${path}.kind: unknown cast kind '${String(s.kind)}'`);
    return;
  }
  switch (s.kind as CastSpec['kind']) {
    case 'skillshot': {
      checkFields(errors, path, s, bounds, ['speed', 'radius', 'range']);
      checkOptBool(errors, `${path}.pierce`, s.pierce);
      checkEffectList(errors, `${path}.onHit`, s.onHit, 1, walk, true);
      checkEffectList(errors, `${path}.allyEffects`, s.allyEffects, 1, walk, false);
      if (s.chain !== undefined) {
        const chain = s.chain as Record<string, unknown>;
        checkNum(errors, `${path}.chain.radius`, chain?.radius, NESTED_BOUNDS.chainRadius);
        checkEffectList(errors, `${path}.chain.onHit`, chain?.onHit, 2, walk, true);
      }
      if (s.leaveWall !== undefined) {
        const lw = s.leaveWall as Record<string, unknown>;
        checkNum(
          errors,
          `${path}.leaveWall.duration`,
          lw?.duration,
          NESTED_BOUNDS.leaveWallDuration,
        );
      }
      if (s.aftershock !== undefined) {
        const a = s.aftershock as Record<string, unknown>;
        checkNum(errors, `${path}.aftershock.delay`, a?.delay, NESTED_BOUNDS.aftershockDelay);
        checkNum(errors, `${path}.aftershock.radius`, a?.radius, NESTED_BOUNDS.aftershockRadius);
        checkNum(errors, `${path}.aftershock.spacing`, a?.spacing, NESTED_BOUNDS.aftershockSpacing);
        checkEffectList(errors, `${path}.aftershock.effects`, a?.effects, 2, walk, true);
      }
      break;
    }
    case 'zone': {
      checkFields(errors, path, s, bounds, ['radius', 'duration']);
      checkOptBool(errors, `${path}.reveal`, s.reveal);
      checkEffectList(errors, `${path}.onEnter`, s.onEnter, 1, walk, false);
      checkEffectList(errors, `${path}.onTick`, s.onTick, 1, walk, false);
      checkEffectList(errors, `${path}.allyOnTick`, s.allyOnTick, 1, walk, false);
      checkEffectList(errors, `${path}.onDetonate`, s.onDetonate, 1, walk, false);
      if (s.onDetonate !== undefined && s.detonateDelay === undefined) {
        errors.push(`${path}.detonateDelay: required when onDetonate is present`);
      }
      if (s.boundary !== undefined) {
        const b = s.boundary as Record<string, unknown>;
        checkNum(
          errors,
          `${path}.boundary.perUnitEvery`,
          b?.perUnitEvery,
          NESTED_BOUNDS.boundaryPerUnitEvery,
        );
        checkEffectList(errors, `${path}.boundary.effects`, b?.effects, 2, walk, true);
      }
      if (s.leaveZone !== undefined) {
        const lz = s.leaveZone as Record<string, unknown>;
        checkNum(errors, `${path}.leaveZone.radius`, lz?.radius, NESTED_BOUNDS.leaveZoneRadius);
        checkNum(
          errors,
          `${path}.leaveZone.duration`,
          lz?.duration,
          NESTED_BOUNDS.leaveZoneDuration,
        );
        checkOptNum(
          errors,
          `${path}.leaveZone.tickEvery`,
          lz?.tickEvery,
          NESTED_BOUNDS.leaveZoneTickEvery,
        );
        checkEffectList(errors, `${path}.leaveZone.onTick`, lz?.onTick, 2, walk, false);
      }
      break;
    }
    case 'self_or_ally':
      checkFields(errors, path, s, bounds, ['searchRadius']);
      checkEffectList(errors, `${path}.effects`, s.effects, 1, walk, true);
      break;
    case 'enemy_target':
      checkFields(errors, path, s, bounds, ['searchRadius']);
      checkEffectList(errors, `${path}.effects`, s.effects, 1, walk, true);
      checkEffectList(errors, `${path}.selfEffects`, s.selfEffects, 1, walk, false);
      break;
    case 'cone':
      checkFields(errors, path, s, bounds, ['range', 'halfAngle']);
      checkEffectList(errors, `${path}.onHit`, s.onHit, 1, walk, true);
      break;
    case 'burst':
      checkFields(errors, path, s, bounds, ['radius']);
      checkEffectList(errors, `${path}.effects`, s.effects, 1, walk, true);
      checkEffectList(errors, `${path}.selfEffects`, s.selfEffects, 1, walk, false);
      break;
    case 'dash': {
      checkFields(errors, path, s, bounds, ['range']);
      checkOptBool(errors, `${path}.untargetableDuringTravel`, s.untargetableDuringTravel);
      checkEffectList(errors, `${path}.onLand`, s.onLand, 1, walk, false);
      checkEffectList(errors, `${path}.selfEffects`, s.selfEffects, 1, walk, false);
      checkEffectList(errors, `${path}.passThrough`, s.passThrough, 1, walk, false);
      if (s.toAlly !== undefined) {
        const t = s.toAlly as Record<string, unknown>;
        checkNum(
          errors,
          `${path}.toAlly.searchRadius`,
          t?.searchRadius,
          NESTED_BOUNDS.toAllySearchRadius,
        );
      }
      break;
    }
    case 'wall':
      checkFields(errors, path, s, bounds, ['length', 'duration']);
      break;
  }
}

function checkAbility(errors: string[], key: string, def: unknown): void {
  const path = `abilities.${key}`;
  if (typeof def !== 'object' || def === null) {
    errors.push(`${path}: must be an ability object`);
    return;
  }
  const a = def as Record<string, unknown> & Partial<AbilityDef>;
  if (a.flavor !== undefined && (typeof a.flavor !== 'string' || a.flavor.length > FLAVOR_MAX)) {
    errors.push(`${path}.flavor: must be a string of at most ${FLAVOR_MAX} characters`);
  }
  if (a.sound !== undefined && !isCastSound(a.sound)) {
    errors.push(`${path}.sound: must be one of ${CAST_SOUNDS.map((s) => s.id).join(', ')}`);
  }
  checkNum(errors, `${path}.manaCost`, a.manaCost, ABILITY_BOUNDS.manaCost);
  checkNum(errors, `${path}.castRange`, a.castRange, ABILITY_BOUNDS.castRange);
  checkOptNum(errors, `${path}.windup`, a.windup, ABILITY_BOUNDS.windup);
  const cdBound = key === 'R' ? ABILITY_BOUNDS.ultCooldown : ABILITY_BOUNDS.basicCooldown;
  checkNum(errors, `${path}.cooldown`, a.cooldown, cdBound);
  if (a.recast !== undefined) {
    const recast = a.recast as Record<string, unknown>;
    checkNum(errors, `${path}.recast.window`, recast?.window, ABILITY_BOUNDS.recastWindow);
    if (recast?.returnBlink !== true) {
      errors.push(`${path}.recast.returnBlink: must be true (the only recast the engine has)`);
    }
  }

  const walk: Walk = { effects: 0 };
  checkCastSpec(errors, `${path}.spec`, a.spec, walk);
  if (a.atRank !== undefined) {
    if (!Array.isArray(a.atRank)) {
      errors.push(`${path}.atRank: must be an array`);
    } else if (a.atRank.length > AT_RANK_MAX) {
      errors.push(`${path}.atRank: ${a.atRank.length} overrides (max ${AT_RANK_MAX})`);
    } else {
      const maxRank = key === 'R' ? 3 : 5;
      for (let i = 0; i < a.atRank.length; i++) {
        const o = a.atRank[i] as Record<string, unknown>;
        checkNum(errors, `${path}.atRank[${i}].rank`, o?.rank, B(2, maxRank, true));
        checkCastSpec(errors, `${path}.atRank[${i}].spec`, o?.spec, walk);
      }
    }
  }
  if (walk.effects > ABILITY_EFFECT_MAX) {
    errors.push(
      `${path}: ${walk.effects} effect primitives in one ability (max ${ABILITY_EFFECT_MAX})`,
    );
  }
}

// Every hard-bound violation in the def, as readable strings; empty means
// the def fits the rails (the budget still has the last word).
export function boundsErrors(def: ForgedChampionDef): string[] {
  const errors: string[] = [];
  const base = def.base as unknown as Record<string, unknown>;
  const growth = def.growth as unknown as Record<string, unknown>;
  if (typeof base !== 'object' || base === null) {
    errors.push('base: must be a stats object');
  } else {
    for (const [field, bound] of Object.entries(BASE_STAT_BOUNDS)) {
      checkNum(errors, `base.${field}`, base[field], bound);
    }
  }
  if (typeof growth !== 'object' || growth === null) {
    errors.push('growth: must be a growth object');
  } else {
    for (const [field, bound] of Object.entries(GROWTH_BOUNDS)) {
      checkNum(errors, `growth.${field}`, growth[field], bound);
    }
  }
  const abilities = def.abilities as unknown as Record<string, unknown>;
  if (typeof abilities !== 'object' || abilities === null) {
    errors.push('abilities: must declare Q, W, E, and R');
  } else {
    for (const key of ['Q', 'W', 'E', 'R']) {
      if (abilities[key] === undefined) errors.push(`abilities.${key}: missing`);
      else checkAbility(errors, key, abilities[key]);
    }
    for (const key of Object.keys(abilities)) {
      if (!['Q', 'W', 'E', 'R'].includes(key)) errors.push(`abilities.${key}: unknown ability key`);
    }
  }
  return errors;
}
