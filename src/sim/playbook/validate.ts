// The playbook validator: the one door between untrusted JSON (the Academy
// conversation, the bots API, a replay file) and the interpreter. Judges
// structure and bounds only, never balance: a playbook is a set of
// decisions, and every decision it can express is one a human could make
// by hand. Returns a fresh object holding only known fields, so nothing
// unexpected rides into the sim.

import type { CoachOrder } from '../coach';
import { CHAMPIONS, type ChampionRole, DEFAULT_CHAMPION_ID } from '../content/champions';
import { ITEMS } from '../content/items';
import { GAME_MAP } from '../content/map';
import type { AbilityKey } from '../types';
import { MAX_BUILD } from './kit';
import {
  type Alone,
  type Behavior,
  type KitDef,
  type KitVariant,
  PLAYBOOK_FORMAT_VERSION,
  type PlaybookDef,
  type PlayDef,
  type Side,
  type SkillKey,
  type Stance,
  type TargetRule,
  type Trigger,
} from './types';

export const MAX_PLAYS = 48;
export const MAX_TRIGGER_DEPTH = 4;
export const MAX_VARIANTS = 8;
const MAX_BRANCHES = 8;
const STANCES: readonly Stance[] = ['auto', 'kite', 'front', 'poke'];
const TARGET_RULES: readonly TargetRule[] = ['nearest', 'lowest', 'squishiest', 'order'];
const ALONES: readonly Alone[] = ['engage', 'hold'];
const SKILL_KEYS: readonly SkillKey[] = ['Q', 'W', 'E'];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
const LANES = ['top', 'mid', 'bot'] as const;
const SIDES: readonly Side[] = ['own', 'enemy'];
const ROLES: readonly ChampionRole[] = [
  'Tank',
  'Fighter',
  'Mage',
  'Battlemage',
  'Assassin',
  'Marksman',
  'Support',
  'Skirmisher',
];
const ORDER_KINDS: readonly CoachOrder['kind'][] = [
  'goto',
  'warden',
  'focus',
  'back',
  'group',
  'hold',
];

export type PlaybookValidation = { ok: true; def: PlaybookDef } | { ok: false; errors: string[] };

class Errors {
  readonly list: string[] = [];
  add(msg: string): void {
    if (this.list.length < 20) this.list.push(msg);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// A finite number inside [min, max], or undefined when absent. Anything
// else is an error.
function optNumber(
  raw: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  at: string,
  errors: Errors,
  integer = false,
): number | undefined {
  const v = raw[field];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    errors.add(`${at}: ${field} must be a number between ${min} and ${max}`);
    return undefined;
  }
  if (integer && !Number.isInteger(v)) {
    errors.add(`${at}: ${field} must be a whole number`);
    return undefined;
  }
  return v;
}

function reqNumber(
  raw: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  at: string,
  errors: Errors,
): number {
  const v = optNumber(raw, field, min, max, at, errors);
  if (v === undefined) {
    if (raw[field] === undefined) errors.add(`${at}: ${field} is required`);
    return min;
  }
  return v;
}

function range(
  raw: Record<string, unknown>,
  min: number,
  max: number,
  at: string,
  errors: Errors,
): { below?: number; atLeast?: number } {
  const below = optNumber(raw, 'below', min, max, at, errors);
  const atLeast = optNumber(raw, 'atLeast', min, max, at, errors);
  if (below === undefined && atLeast === undefined) {
    errors.add(`${at}: needs below or atLeast`);
  }
  const out: { below?: number; atLeast?: number } = {};
  if (below !== undefined) out.below = below;
  if (atLeast !== undefined) out.atLeast = atLeast;
  return out;
}

function count(
  raw: Record<string, unknown>,
  at: string,
  errors: Errors,
): { within: number; atLeast?: number; atMost?: number } {
  const within = reqNumber(raw, 'within', 0, 200, at, errors);
  const atLeast = optNumber(raw, 'atLeast', 0, 10, at, errors, true);
  const atMost = optNumber(raw, 'atMost', 0, 10, at, errors, true);
  if (atLeast === undefined && atMost === undefined) {
    errors.add(`${at}: needs atLeast or atMost`);
  }
  const out: { within: number; atLeast?: number; atMost?: number } = { within };
  if (atLeast !== undefined) out.atLeast = atLeast;
  if (atMost !== undefined) out.atMost = atMost;
  return out;
}

function trigger(raw: unknown, at: string, depth: number, errors: Errors): Trigger {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    errors.add(`${at}: a trigger needs a kind`);
    return { kind: 'always' };
  }
  if (depth > MAX_TRIGGER_DEPTH) {
    errors.add(`${at}: triggers nest at most ${MAX_TRIGGER_DEPTH} deep`);
    return { kind: 'always' };
  }
  switch (raw.kind) {
    case 'always':
    case 'enemyVisible':
    case 'atFountain':
    case 'underTower':
      return { kind: raw.kind };
    case 'hp':
    case 'mana':
      return { kind: raw.kind, ...range(raw, 0, 1, at, errors) };
    case 'level':
      return { kind: 'level', ...range(raw, 1, 18, at, errors) };
    case 'gold':
      return { kind: 'gold', ...range(raw, 0, 1_000_000, at, errors) };
    case 'time':
      return { kind: 'time', ...range(raw, 0, 36_000, at, errors) };
    case 'enemies':
    case 'allies':
      return { kind: raw.kind, ...count(raw, at, errors) };
    case 'warden': {
      const state = raw.state;
      if (state !== 'up' && state !== 'spawning' && state !== 'down') {
        errors.add(`${at}: warden state must be up, spawning or down`);
        return { kind: 'warden', state: 'up' };
      }
      const within = optNumber(raw, 'within', 0, 600, at, errors);
      return within === undefined ? { kind: 'warden', state } : { kind: 'warden', state, within };
    }
    case 'abilityReady': {
      const key = raw.key;
      if (typeof key !== 'string' || !(ABILITY_KEYS as readonly string[]).includes(key)) {
        errors.add(`${at}: abilityReady key must be Q, W, E or R`);
        return { kind: 'abilityReady', key: 'Q' };
      }
      return { kind: 'abilityReady', key: key as AbilityKey };
    }
    case 'sigilReady': {
      const id = raw.id;
      if (typeof id !== 'string' || !ID_RE.test(id)) {
        errors.add(`${at}: sigilReady needs a sigil id`);
        return { kind: 'sigilReady', id: 'mend' };
      }
      return { kind: 'sigilReady', id };
    }
    case 'allyFighting':
      return { kind: 'allyFighting', within: reqNumber(raw, 'within', 0, 200, at, errors) };
    case 'order': {
      const is = raw.is;
      if (is === undefined) return { kind: 'order' };
      if (typeof is !== 'string' || !(ORDER_KINDS as readonly string[]).includes(is)) {
        errors.add(`${at}: order kind must be one of ${ORDER_KINDS.join(', ')}`);
        return { kind: 'order' };
      }
      return { kind: 'order', is: is as CoachOrder['kind'] };
    }
    case 'lane': {
      const is = raw.is;
      if (is !== 'top' && is !== 'mid' && is !== 'bot') {
        errors.add(`${at}: lane must be top, mid or bot`);
        return { kind: 'lane', is: 'mid' };
      }
      return { kind: 'lane', is };
    }
    case 'champion':
      return { kind: 'champion', side: side(raw, at, errors), is: champion(raw, at, errors) };
    case 'roles': {
      const role = raw.role;
      const known = typeof role === 'string' && (ROLES as readonly string[]).includes(role);
      if (!known) errors.add(`${at}: roles needs a role among ${ROLES.join(', ')}`);
      const atLeast = optNumber(raw, 'atLeast', 0, 5, at, errors, true);
      const atMost = optNumber(raw, 'atMost', 0, 5, at, errors, true);
      if (atLeast === undefined && atMost === undefined) {
        errors.add(`${at}: roles needs atLeast or atMost`);
      }
      return {
        kind: 'roles',
        side: side(raw, at, errors),
        role: known ? (role as ChampionRole) : 'Mage',
        ...(atLeast !== undefined ? { atLeast } : {}),
        ...(atMost !== undefined ? { atMost } : {}),
      };
    }
    case 'enemyDamage': {
      const mostly = raw.mostly;
      if (mostly !== 'magic' && mostly !== 'physical') {
        errors.add(`${at}: enemyDamage mostly must be magic or physical`);
        return { kind: 'enemyDamage', mostly: 'magic' };
      }
      return { kind: 'enemyDamage', mostly };
    }
    case 'enemyItem': {
      if (typeof raw.item !== 'string' || ITEMS[raw.item] === undefined) {
        errors.add(`${at}: enemyItem needs an item id from the shop`);
        return { kind: 'enemyItem', item: 'iron_blade' };
      }
      return { kind: 'enemyItem', item: raw.item };
    }
    case 'laneOpponent':
      return { kind: 'laneOpponent', is: champion(raw, at, errors) };
    case 'lanePartner':
      return { kind: 'lanePartner', is: champion(raw, at, errors) };
    case 'not':
      return { kind: 'not', of: trigger(raw.of, `${at}.not`, depth + 1, errors) };
    case 'all':
    case 'any': {
      const of = raw.of;
      if (!Array.isArray(of) || of.length === 0 || of.length > MAX_BRANCHES) {
        errors.add(`${at}: ${raw.kind} needs 1 to ${MAX_BRANCHES} triggers`);
        return { kind: 'always' };
      }
      return {
        kind: raw.kind,
        of: of.map((sub, i) => trigger(sub, `${at}.${raw.kind}[${i}]`, depth + 1, errors)),
      };
    }
    default:
      errors.add(`${at}: unknown trigger kind "${raw.kind}"`);
      return { kind: 'always' };
  }
}

// A side of the lineup, own by default when missing.
function side(raw: Record<string, unknown>, at: string, errors: Errors): Side {
  const v = raw.side;
  if (typeof v !== 'string' || !(SIDES as readonly string[]).includes(v)) {
    errors.add(`${at}: side must be own or enemy`);
    return 'enemy';
  }
  return v as Side;
}

// A roster champion id in `is`.
function champion(raw: Record<string, unknown>, at: string, errors: Errors): string {
  const v = raw.is;
  if (typeof v !== 'string' || CHAMPIONS[v] === undefined) {
    errors.add(`${at}: ${String(raw.kind)} needs a roster champion id`);
    return DEFAULT_CHAMPION_ID;
  }
  return v;
}

function behavior(raw: unknown, at: string, errors: Errors): Behavior {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    errors.add(`${at}: a behavior needs a kind`);
    return { kind: 'hold' };
  }
  const opt = (field: string, min: number, max: number, integer = false) =>
    optNumber(raw, field, min, max, at, errors, integer);
  const withOpt = (b: Behavior, field: string, v: number | undefined): Behavior =>
    v === undefined ? b : ({ ...b, [field]: v } as Behavior);
  switch (raw.kind) {
    case 'retreat':
    case 'hold':
    case 'shop':
    case 'goShop':
    case 'finishSanctum':
    case 'farm':
    case 'takeCamp':
    case 'obeyOrder':
      return { kind: raw.kind };
    case 'avoidTower': {
      let b: Behavior = { kind: 'avoidTower' };
      b = withOpt(b, 'escortMin', opt('escortMin', 0, 10, true));
      return withOpt(b, 'hpBelow', opt('hpBelow', 0, 1));
    }
    case 'fight': {
      const b: Behavior = { kind: 'fight' };
      if (raw.stance !== undefined) {
        if (!(STANCES as readonly unknown[]).includes(raw.stance)) {
          errors.add(`${at}: stance must be one of ${STANCES.join(', ')}`);
        } else b.stance = raw.stance as Stance;
      }
      if (raw.target !== undefined) {
        if (!(TARGET_RULES as readonly unknown[]).includes(raw.target)) {
          errors.add(`${at}: target must be one of ${TARGET_RULES.join(', ')}`);
        } else b.target = raw.target as TargetRule;
      }
      if (raw.alone !== undefined) {
        if (!(ALONES as readonly unknown[]).includes(raw.alone)) {
          errors.add(`${at}: alone must be one of ${ALONES.join(', ')}`);
        } else b.alone = raw.alone as Alone;
      }
      return b;
    }
    case 'sell': {
      if (typeof raw.item !== 'string' || ITEMS[raw.item] === undefined) {
        errors.add(`${at}: sell needs an item id from the shop`);
        return { kind: 'sell', item: 'iron_blade' };
      }
      return { kind: 'sell', item: raw.item };
    }
    case 'hunt':
      return withOpt({ kind: 'hunt' }, 'hpAbove', opt('hpAbove', 0, 1));
    case 'answerVanish':
      return withOpt({ kind: 'answerVanish' }, 'hpAtLeast', opt('hpAtLeast', 0, 1));
    case 'contestWarden': {
      let b: Behavior = { kind: 'contestWarden' };
      b = withOpt(b, 'hpAtLeast', opt('hpAtLeast', 0, 1));
      return withOpt(b, 'prepSeconds', opt('prepSeconds', 0, 300));
    }
    case 'siege':
      return withOpt({ kind: 'siege' }, 'escortMin', opt('escortMin', 0, 10, true));
    case 'push': {
      const b: Behavior = { kind: 'push' };
      const lane = raw.lane;
      if (lane !== undefined) {
        if (lane !== 'assigned' && !(LANES as readonly string[]).includes(lane as string)) {
          errors.add(`${at}: push lane must be top, mid, bot or assigned`);
        } else {
          b.lane = lane as 'top' | 'mid' | 'bot' | 'assigned';
        }
      }
      if (raw.regroupAt === null) b.regroupAt = null;
      else {
        const regroupAt = opt('regroupAt', 0, 7200);
        if (regroupAt !== undefined) b.regroupAt = regroupAt;
      }
      return b;
    }
    case 'followAlly':
      return withOpt({ kind: 'followAlly' }, 'keep', opt('keep', 0, 50));
    case 'joinAlly':
      return withOpt({ kind: 'joinAlly' }, 'within', opt('within', 0, 200));
    case 'fallBack':
      return { kind: 'fallBack' };
    case 'holdPosition': {
      const b: Behavior = {
        kind: 'holdPosition',
        x: reqNumber(raw, 'x', 0, GAME_MAP.size, at, errors),
        z: reqNumber(raw, 'z', 0, GAME_MAP.size, at, errors),
      };
      return withOpt(b, 'within', opt('within', 0, 50));
    }
    default:
      errors.add(`${at}: unknown behavior kind "${raw.kind}"`);
      return { kind: 'hold' };
  }
}

function play(raw: unknown, index: number, seen: Set<string>, errors: Errors): PlayDef {
  const at = `plays[${index}]`;
  if (!isRecord(raw)) {
    errors.add(`${at}: a play is an object`);
    return { id: `play-${index}`, when: { kind: 'always' }, do: { kind: 'hold' } };
  }
  let id = `play-${index}`;
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) {
    errors.add(`${at}: id must be 1 to 32 lowercase letters, digits, - or _`);
  } else if (seen.has(raw.id)) {
    errors.add(`${at}: duplicate id "${raw.id}"`);
  } else {
    id = raw.id;
    seen.add(id);
  }
  const out: PlayDef = {
    id,
    when: trigger(raw.when, `${at}.when`, 1, errors),
    do: behavior(raw.do, `${at}.do`, errors),
  };
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') errors.add(`${at}: enabled must be true or false`);
    else if (!raw.enabled) out.enabled = false;
  }
  return out;
}

// A build: item ids from the shop, in order. An item may be listed more
// than once: each listing is one more copy to own (kit.ts, unsatisfied).
function build(raw: unknown, at: string, errors: Errors): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BUILD) {
    errors.add(`${at}: build must list 1 to ${MAX_BUILD} items`);
    return undefined;
  }
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || ITEMS[id] === undefined) {
      errors.add(`${at}: unknown item "${String(id)}"`);
      return undefined;
    }
    out.push(id);
  }
  return out;
}

// A skill order: Q, W and E, each once.
function skills(raw: unknown, at: string, errors: Errors): SkillKey[] | undefined {
  if (raw === undefined) return undefined;
  if (
    !Array.isArray(raw) ||
    raw.length !== 3 ||
    !raw.every((k) => (SKILL_KEYS as readonly unknown[]).includes(k)) ||
    new Set(raw).size !== 3
  ) {
    errors.add(`${at}: skills must order Q, W and E, each once`);
    return undefined;
  }
  return raw as SkillKey[];
}

function kit(raw: unknown, errors: Errors): KitDef | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    errors.add('kit must be an object');
    return undefined;
  }
  const out: KitDef = {};
  const b = build(raw.build, 'kit', errors);
  if (b) out.build = b;
  const s = skills(raw.skills, 'kit', errors);
  if (s) out.skills = s;
  if (raw.variants !== undefined) {
    if (!Array.isArray(raw.variants) || raw.variants.length > MAX_VARIANTS) {
      errors.add(`kit: at most ${MAX_VARIANTS} variants`);
    } else {
      const variants: KitVariant[] = [];
      raw.variants.forEach((v, i) => {
        const at = `kit.variants[${i}]`;
        if (!isRecord(v)) {
          errors.add(`${at}: a variant is an object`);
          return;
        }
        const variant: KitVariant = { when: trigger(v.when, `${at}.when`, 1, errors) };
        const vb = build(v.build, at, errors);
        if (vb) variant.build = vb;
        const vs = skills(v.skills, at, errors);
        if (vs) variant.skills = vs;
        if (!vb && !vs) errors.add(`${at}: a variant needs a build or a skill order`);
        variants.push(variant);
      });
      if (variants.length > 0) out.variants = variants;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function validatePlaybook(raw: unknown): PlaybookValidation {
  const errors = new Errors();
  if (!isRecord(raw)) return { ok: false, errors: ['a playbook is an object'] };
  const version = raw.version;
  if (!Number.isInteger(version) || (version as number) < 1) {
    errors.add('version must be a whole number from 1');
  } else if ((version as number) > PLAYBOOK_FORMAT_VERSION) {
    errors.add(`version ${version} is newer than this engine (${PLAYBOOK_FORMAT_VERSION})`);
  }
  const plays = raw.plays;
  if (!Array.isArray(plays) || plays.length === 0) {
    errors.add('plays must hold at least one play');
    return { ok: false, errors: errors.list };
  }
  if (plays.length > MAX_PLAYS) {
    errors.add(`at most ${MAX_PLAYS} plays`);
    return { ok: false, errors: errors.list };
  }
  const seen = new Set<string>();
  const out = plays.map((p, i) => play(p, i, seen, errors));
  const k = kit(raw.kit, errors);
  const lanes = lanePreference(raw.lanes, errors);
  if (errors.list.length > 0) return { ok: false, errors: errors.list };
  return {
    ok: true,
    def: {
      version: version as number,
      plays: out,
      ...(k ? { kit: k } : {}),
      ...(lanes ? { lanes } : {}),
    },
  };
}

// The lane preference: one to three distinct lanes, in order; absent when
// the playbook states none.
function lanePreference(raw: unknown, errors: Errors): ('top' | 'mid' | 'bot')[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 3) {
    errors.add('lanes must list one to three lanes');
    return undefined;
  }
  const out: ('top' | 'mid' | 'bot')[] = [];
  for (const lane of raw) {
    if ((lane !== 'top' && lane !== 'mid' && lane !== 'bot') || out.includes(lane)) {
      errors.add('lanes must be distinct among top, mid and bot');
      return undefined;
    }
    out.push(lane);
  }
  return out;
}
