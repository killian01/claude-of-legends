// The power dial (CONTEXT.md): a spell's one intensity control, the
// Stat polygon's sibling. It scales the spell's AMOUNTS (damage,
// healing, crowd control durations) inside the engine's bounds and
// stops where the Kit envelope or a Burst cap runs out, exactly like a
// polygon vertex; searched rather than solved, because clamped scaling
// is monotone but not linear. The spell's STRUCTURE (cast kind, effect
// kinds, shapes, ranges) and its RHYTHM (cooldown, mana, cast range,
// windup) are not its business.

import type { AbilityDef, CastSpec } from '../combat/casting';
import type { EffectSpec } from '../combat/effects';
import type { AbilityKey } from '../types';
import { type Bound, CAST_BOUNDS, EFFECT_BOUNDS } from './bounds';
import { budgetOf } from './budget';
import { BASIC_KEYS, burstVerdict } from './burst';
import { KIT_ENVELOPE, kitSpendOf } from './envelopes';
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

// The step each amount is read in: a scaled amount lands on it, so
// neither the dial nor a fit hands the creator 1.0372 seconds or 73.284
// damage. Whole points for damage, healing, shields and resistances;
// hundredths for ratios and percentages; one tick (DT) for durations; a
// tenth of a unit for distances. Every bound above sits on its step.
const STEP_WHOLE = 1;
const STEP_RATIO = 0.01;
const STEP_TIME = 0.05;
const STEP_DISTANCE = 0.1;
const AMOUNT_STEPS: Record<string, number> = {
  base: STEP_WHOLE,
  perSecond: STEP_WHOLE,
  armor: STEP_WHOLE,
  mr: STEP_WHOLE,
  adRatio: STEP_RATIO,
  apRatio: STEP_RATIO,
  maxHpPct: STEP_RATIO,
  pct: STEP_RATIO,
  factor: STEP_RATIO,
  msPct: STEP_RATIO,
  asPct: STEP_RATIO,
  pctOfRemaining: STEP_RATIO,
  duration: STEP_TIME,
  distance: STEP_DISTANCE,
};

// `v` on the nearest step of `field`, written with that step's decimals
// so the number is exactly what the creator reads.
const stepOf = (field: string): number => AMOUNT_STEPS[field] ?? STEP_RATIO;

export function snapAmount(field: string, v: number): number {
  const step = stepOf(field);
  const decimals = step >= 1 ? 0 : Math.ceil(-Math.log10(step));
  return Number((Math.round(v / step + 1e-9) * step).toFixed(decimals));
}

// One visit per amount, in a fixed order: the scale and the top-up
// below are this same walk with a different hand.
type AmountFn = (field: string, v: number, bound: Bound | undefined) => number;

function mapEffects(list: readonly EffectSpec[] | undefined, fn: AmountFn): void {
  for (const e of list ?? []) {
    const fields = EFFECT_AMOUNTS[e.kind] ?? [];
    const bounds = EFFECT_BOUNDS[e.kind] ?? {};
    const rec = e as unknown as Record<string, unknown>;
    for (const field of fields) {
      const v = rec[field];
      if (typeof v === 'number') rec[field] = fn(field, v, bounds[field]);
    }
    // Effects that carry effects walk what they carry.
    if (e.kind === 'mark') mapEffects(e.onTrigger, fn);
    if (e.kind === 'conditional') {
      mapEffects(e.effects, fn);
      mapEffects(e.otherwise, fn);
    }
    if (e.kind === 'empower') {
      mapEffects(e.bonus, fn);
      mapEffects(e.splash, fn);
    }
    if (e.kind === 'shield' && e.burst) {
      mapEffects(e.burst.onBreak, fn);
      mapEffects(e.burst.onExpire, fn);
    }
  }
}

function mapSpec(spec: CastSpec, fn: AmountFn): void {
  switch (spec.kind) {
    case 'skillshot':
      mapEffects(spec.onHit, fn);
      mapEffects(spec.allyEffects, fn);
      if (spec.chain) mapEffects(spec.chain.onHit, fn);
      if (spec.aftershock) mapEffects(spec.aftershock.effects, fn);
      break;
    case 'zone':
      mapEffects(spec.onEnter, fn);
      mapEffects(spec.onTick, fn);
      mapEffects(spec.allyOnTick, fn);
      mapEffects(spec.onDetonate, fn);
      if (spec.boundary) mapEffects(spec.boundary.effects, fn);
      if (spec.leaveZone) mapEffects(spec.leaveZone.onTick, fn);
      break;
    case 'self_or_ally':
      mapEffects(spec.effects, fn);
      break;
    case 'enemy_target':
      mapEffects(spec.effects, fn);
      mapEffects(spec.selfEffects, fn);
      break;
    case 'cone':
      mapEffects(spec.onHit, fn);
      break;
    case 'burst':
      mapEffects(spec.effects, fn);
      mapEffects(spec.selfEffects, fn);
      break;
    case 'dash':
      mapEffects(spec.onLand, fn);
      mapEffects(spec.selfEffects, fn);
      mapEffects(spec.passThrough, fn);
      break;
    case 'wall':
      // A wall's whole payload is how long it stands.
      (spec as { duration: number }).duration = fn(
        'duration',
        spec.duration,
        CAST_BOUNDS.wall?.duration,
      );
      break;
  }
}

function mapAbility(ability: AbilityDef, fn: AmountFn): void {
  mapSpec(ability.spec, fn);
  for (const o of ability.atRank ?? []) mapSpec(o.spec, fn);
}

// The scale's hand: every amount at `factor` times its value, on its
// step, inside its bound.
const scaledBy =
  (factor: number): AmountFn =>
  (field, v, bound) =>
    clampTo(bound, snapAmount(field, v * factor));

// The ability at `factor` times the anchor's amounts, bounds respected.
export function scaleAbility(anchor: AbilityDef, factor: number): AbilityDef {
  const out = structuredClone(anchor) as AbilityDef;
  mapAbility(out, scaledBy(factor));
  return out;
}

// What stopped a dial short of its ask: the Kit envelope, the spell's own
// Burst cap, or the cap on the three basics together (CONTEXT.md). The
// creator has to know which, because the way to free room differs.
export type DialStop = 'envelope' | 'burst' | 'kit_burst';

// The kit's verdict with these abilities in place: inside its envelope
// and under every burst cap.
function kitFits(def: ForgedChampionDef, abilities: Record<AbilityKey, AbilityDef>): boolean {
  const d = { ...def, abilities };
  return kitSpendOf(budgetOf(d)) <= KIT_ENVELOPE && burstVerdict(d).ok;
}

// The first line these abilities cross, in the order the creator reads
// them: the envelope, this spell's own cap, the basics together.
function stopOf(
  def: ForgedChampionDef,
  key: AbilityKey,
  abilities: Record<AbilityKey, AbilityDef>,
): DialStop | null {
  const d = { ...def, abilities };
  if (kitSpendOf(budgetOf(d)) > KIT_ENVELOPE) return 'envelope';
  const v = burstVerdict(d);
  if (!v.abilities[key]) return 'burst';
  if (!v.basics) return 'kit_burst';
  return null;
}

// A step past a stop, to name what binds there: larger than the search
// tolerance, smaller than anything the dial can show.
const STOP_PROBE = 1e-3;

export interface PowerGrant {
  ability: AbilityDef;
  factor: number;
  // Null when the ask was granted whole.
  stop: DialStop | null;
}

// The dial's grant: the requested factor, or the largest the kit
// envelope and the burst caps afford, searched down the monotone curve.
// Even at the floor an over-line champion gets the floor: the dial can
// always come down.
export function grantSpellPower(
  def: ForgedChampionDef,
  key: AbilityKey,
  anchor: AbilityDef,
  want: number,
): PowerGrant {
  const f = Math.min(POWER_DIAL_MAX, Math.max(POWER_DIAL_MIN, want));
  const withFactor = (factor: number): Record<AbilityKey, AbilityDef> => ({
    ...def.abilities,
    [key]: scaleAbility(anchor, factor),
  });
  if (kitFits(def, withFactor(f))) return { ability: withFactor(f)[key], factor: f, stop: null };
  let lo = POWER_DIAL_MIN;
  let hi = f;
  for (let i = 0; i < 32; i += 1) {
    const mid = (lo + hi) / 2;
    if (kitFits(def, withFactor(mid))) lo = mid;
    else hi = mid;
  }
  const stop = stopOf(def, key, withFactor(Math.min(f, lo + STOP_PROBE))) ?? 'envelope';
  return { ability: withFactor(lo)[key], factor: lo, stop };
}

export interface KitFit {
  abilities: Record<AbilityKey, AbilityDef>;
  // The shared factor the spells still free at the end were scaled by.
  factor: number;
  // The spells a burst cap stopped: held where the cap caught them while
  // the others took the room they left.
  held: readonly AbilityKey[];
}

const KIT_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

// How many amounts an ability carries, so each can be addressed by its
// place in the walk.
function amountCount(ability: AbilityDef): number {
  let n = 0;
  mapAbility(structuredClone(ability) as AbilityDef, (_field, v) => {
    n += 1;
    return v;
  });
  return n;
}

// The ability with its `index`th amount one step up, inside its bound;
// null when that amount is already at its ceiling.
function raisedAt(ability: AbilityDef, index: number): AbilityDef | null {
  const out = structuredClone(ability) as AbilityDef;
  let seen = 0;
  let raised = false;
  mapAbility(out, (field, v, bound) => {
    const here = seen;
    seen += 1;
    if (here !== index) return v;
    const next = clampTo(bound, snapAmount(field, v + stepOf(field)));
    raised = next > v;
    return next;
  });
  return raised ? out : null;
}

// The steps' price: amounts land on what the creator reads, so the
// shared factor stops where the next step of some amount would cross
// the line, a point or two under it. The top-up takes that room back:
// one pass over every amount of every spell, each raised a single step
// where the envelope and the caps still hold. One step is invisible to
// the design (a point of damage, a hundredth of a ratio, a tick of
// crowd control); more than one would let the cheapest amounts drift.
function topUp(
  def: ForgedChampionDef,
  start: Record<AbilityKey, AbilityDef>,
): Record<AbilityKey, AbilityDef> {
  let abilities = start;
  for (const key of KIT_KEYS) {
    const count = amountCount(abilities[key]);
    for (let i = 0; i < count; i += 1) {
      const trial = raisedAt(abilities[key], i);
      if (!trial) continue;
      const next = { ...abilities, [key]: trial };
      if (kitFits(def, next)) abilities = next;
    }
  }
  return abilities;
}

// The whole kit at one shared factor: the largest the kit envelope and
// the burst caps afford inside the dial's range, so a proposal lands on
// the envelope line with its spells' relative weights intact. When a
// burst cap stops the shared factor first, the spell it caught is held
// there and the search runs again over the others, so the kit still
// reaches the line rather than tiptoeing under it. This is how the kit
// conversation hands the numbers to the arithmetic instead of the model:
// the model owns structure and theme, the fit owns the amounts. Null when
// even the floor overspends or overshoots a cap: the structure itself is
// the problem, and no trimming of amounts can help.
export function fitKitPower(def: ForgedChampionDef): KitFit | null {
  const anchors = def.abilities;
  let abilities: Record<AbilityKey, AbilityDef> = {
    Q: scaleAbility(anchors.Q, 1),
    W: scaleAbility(anchors.W, 1),
    E: scaleAbility(anchors.E, 1),
    R: scaleAbility(anchors.R, 1),
  };
  const held = new Set<AbilityKey>();
  let factor = 1;
  const at = (f: number, free: readonly AbilityKey[]): Record<AbilityKey, AbilityDef> => {
    const out = { ...abilities };
    for (const k of free) out[k] = scaleAbility(anchors[k], f);
    return out;
  };
  // One round per spell at most: every round either ends the fit or holds
  // at least one more spell.
  for (let round = 0; round < KIT_KEYS.length; round += 1) {
    const free = KIT_KEYS.filter((k) => !held.has(k));
    if (free.length === 0) break;
    let f = POWER_DIAL_MAX;
    if (!kitFits(def, at(POWER_DIAL_MAX, free))) {
      if (!kitFits(def, at(POWER_DIAL_MIN, free))) {
        if (round === 0) return null;
        break;
      }
      let lo = POWER_DIAL_MIN;
      let hi = POWER_DIAL_MAX;
      for (let i = 0; i < 32; i += 1) {
        const mid = (lo + hi) / 2;
        if (kitFits(def, at(mid, free))) lo = mid;
        else hi = mid;
      }
      f = lo;
    }
    abilities = at(f, free);
    factor = f;
    if (f >= POWER_DIAL_MAX) break;
    // What binds a step past the stop: the envelope ends the fit; a
    // spell's own cap holds that spell; the basics' cap holds the three.
    const past = { ...def, abilities: at(f + STOP_PROBE, free) };
    if (kitSpendOf(budgetOf(past)) > KIT_ENVELOPE) break;
    const v = burstVerdict(past);
    let caught = false;
    for (const k of free) {
      if (!v.abilities[k]) {
        held.add(k);
        caught = true;
      }
    }
    if (!v.basics) {
      for (const k of BASIC_KEYS) held.add(k);
      caught = true;
    }
    if (!caught) break;
  }
  // Not past the dial's ceiling: there the kit is as strong as its
  // structure allows and the line is not the stop.
  if (factor < POWER_DIAL_MAX) abilities = topUp(def, abilities);
  return { abilities, factor, held: [...held] };
}
