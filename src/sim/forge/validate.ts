// The deterministic validator (ADR 0006): the one gate every forged
// champion passes before it exists anywhere (draft save, finalize, match
// setup, replay load). Structure first, then the hard per-field bounds
// (forge/bounds.ts), then the power budget's three envelopes
// (forge/envelopes.ts) and the burst cap (forge/burst.ts). Errors are
// readable strings and the list is complete: the Forge editor shows them
// all, and the agent endpoint explains refusals with them.

import type { CastSpec } from '../combat/casting';
import type { EffectSpec } from '../combat/effects';
import type { ChampionRole } from '../content/champions';
import { boundsErrors, FLAVOR_MAX } from './bounds';
import { type BudgetBreakdown, budgetOf } from './budget';
import { burstErrors } from './burst';
import { envelopeErrors } from './envelopes';
import type { ForgedChampionDef } from './forged_def';
import { PASSIVE_TEMPLATES } from './passive_templates';

export type ForgedValidation =
  | { ok: true; cost: BudgetBreakdown }
  | { ok: false; errors: readonly string[]; cost: BudgetBreakdown | null };

export const FORGED_ID_PATTERN = /^forged_[a-z0-9_]{1,32}$/;

// Exported for the Forge editor's role picker: one source of truth for
// what a forged champion may declare.
export const FORGED_ROLES: readonly ChampionRole[] = [
  'Tank',
  'Fighter',
  'Mage',
  'Battlemage',
  'Assassin',
  'Marksman',
  'Support',
  'Skirmisher',
];

const NAME_MAX = 40;
const TAGLINE_MAX = 90;

// Instant hard crowd control must telegraph (the kits-v2 rule the roster
// already obeys: "the roar is seen before it takes hold"). A skillshot's
// flight, a zone's fuse, and a dash's visible travel are telegraphs by
// construction; an instant delivery is not, so it owes a windup.
const INSTANT_KINDS: readonly CastSpec['kind'][] = ['burst', 'cone', 'enemy_target'];
const HARD_CC: readonly EffectSpec['kind'][] = ['stun', 'taunt', 'knockup'];
const TELEGRAPH_WINDUP_MIN = 0.2;

function listHasHardCc(list: readonly EffectSpec[] | undefined): boolean {
  if (!list) return false;
  for (const e of list) {
    if (HARD_CC.includes(e.kind)) return true;
    if (e.kind === 'conditional') {
      if (listHasHardCc(e.effects) || listHasHardCc(e.otherwise)) return true;
    }
  }
  return false;
}

function instantEnemyEffects(spec: CastSpec): readonly EffectSpec[] | undefined {
  switch (spec.kind) {
    case 'burst':
      return spec.effects;
    case 'cone':
      return spec.onHit;
    case 'enemy_target':
      return spec.effects;
    default:
      return undefined;
  }
}

function checkString(
  errors: string[],
  path: string,
  value: unknown,
  max: number,
  required: boolean,
): void {
  if (typeof value !== 'string') {
    errors.push(`${path}: must be a string`);
    return;
  }
  if (required && value.trim().length === 0) errors.push(`${path}: must not be empty`);
  if (value.length > max) errors.push(`${path}: longer than ${max} characters`);
}

function structureErrors(def: ForgedChampionDef): string[] {
  const errors: string[] = [];
  if (typeof def !== 'object' || def === null) return ['def: must be an object'];
  if (typeof def.id !== 'string' || !FORGED_ID_PATTERN.test(def.id)) {
    errors.push(`id: must match ${FORGED_ID_PATTERN} (never a roster id)`);
  }
  checkString(errors, 'name', def.name, NAME_MAX, true);
  checkString(errors, 'title', def.title, NAME_MAX, false);
  checkString(errors, 'tagline', def.tagline, TAGLINE_MAX, false);
  checkString(errors, 'creator', def.creator, NAME_MAX, false);
  if (!FORGED_ROLES.includes(def.role)) {
    errors.push(`role: must be one of ${FORGED_ROLES.join(', ')}`);
  }
  return errors;
}

function passiveErrors(def: ForgedChampionDef): string[] {
  const errors: string[] = [];
  const ref = def.passive;
  if (typeof ref !== 'object' || ref === null) return ['passive: must be a template reference'];
  checkString(errors, 'passive.name', ref.name, NAME_MAX, true);
  if (ref.flavor !== undefined)
    checkString(errors, 'passive.flavor', ref.flavor, FLAVOR_MAX, false);
  const tpl = typeof ref.template === 'string' ? PASSIVE_TEMPLATES[ref.template] : undefined;
  if (!tpl) {
    errors.push(`passive.template: unknown template '${String(ref.template)}'`);
    return errors;
  }
  if (typeof ref.params !== 'object' || ref.params === null) {
    errors.push('passive.params: must be an object');
    return errors;
  }
  for (const param of tpl.params) {
    const value = ref.params[param.key];
    const path = `passive.params.${param.key}`;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${path}: must be a finite number`);
      continue;
    }
    if (value < param.min || value > param.max) {
      errors.push(`${path}: ${value} is outside [${param.min}, ${param.max}]`);
    }
    if (param.integer && !Number.isInteger(value)) {
      errors.push(`${path}: ${value} must be an integer`);
    }
  }
  const declared = new Set(tpl.params.map((p) => p.key));
  for (const key of Object.keys(ref.params)) {
    if (!declared.has(key)) {
      errors.push(`passive.params.${key}: not a parameter of '${tpl.id}'`);
    }
  }
  return errors;
}

function telegraphErrors(def: ForgedChampionDef): string[] {
  const errors: string[] = [];
  if (typeof def.abilities !== 'object' || def.abilities === null) return errors;
  for (const key of ['Q', 'W', 'E', 'R'] as const) {
    const ability = def.abilities[key];
    if (typeof ability !== 'object' || ability === null) continue;
    const specs = [ability.spec, ...(ability.atRank?.map((o) => o.spec) ?? [])];
    for (const spec of specs) {
      if (typeof spec !== 'object' || spec === null) continue;
      if (!INSTANT_KINDS.includes(spec.kind)) continue;
      if (!listHasHardCc(instantEnemyEffects(spec))) continue;
      if ((ability.windup ?? 0) < TELEGRAPH_WINDUP_MIN) {
        errors.push(
          `abilities.${key}: instant hard crowd control needs a windup of at least ` +
            `${TELEGRAPH_WINDUP_MIN} seconds (hard CC telegraphs itself)`,
        );
      }
      break;
    }
  }
  return errors;
}

export function validateForged(def: ForgedChampionDef): ForgedValidation {
  const errors = structureErrors(def);
  if (typeof def === 'object' && def !== null) {
    errors.push(...passiveErrors(def));
    errors.push(...boundsErrors(def));
  }
  // The budget walk assumes shapes the earlier checks guarantee: with any
  // structural or bounds error the bill cannot be trusted, so it is null.
  if (errors.length > 0) return { ok: false, errors, cost: null };
  errors.push(...telegraphErrors(def));
  const cost = budgetOf(def);
  errors.push(...envelopeErrors(cost));
  errors.push(...burstErrors(def));
  if (errors.length > 0) return { ok: false, errors, cost };
  return { ok: true, cost };
}
