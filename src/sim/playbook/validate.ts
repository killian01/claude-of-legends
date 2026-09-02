// The playbook validator: the one door between untrusted JSON (the Academy
// conversation, the bots API, a replay file) and the interpreter. Judges
// structure and bounds only, never balance: a playbook is a set of
// decisions, and every decision it can express is one a human could make
// by hand. Returns a fresh object holding only known fields, so nothing
// unexpected rides into the sim.

import { GAME_MAP } from '../content/map';
import type { AbilityKey } from '../types';
import {
  type Behavior,
  PLAYBOOK_FORMAT_VERSION,
  type PlaybookDef,
  type PlayDef,
  type Trigger,
} from './types';

export const MAX_PLAYS = 48;
export const MAX_TRIGGER_DEPTH = 4;
const MAX_BRANCHES = 8;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
const LANES = ['top', 'mid', 'bot'] as const;

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
    case 'lane': {
      const is = raw.is;
      if (is !== 'top' && is !== 'mid' && is !== 'bot') {
        errors.add(`${at}: lane must be top, mid or bot`);
        return { kind: 'lane', is: 'mid' };
      }
      return { kind: 'lane', is };
    }
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
    case 'fight':
    case 'farm':
    case 'takeCamp':
      return { kind: raw.kind };
    case 'avoidTower': {
      let b: Behavior = { kind: 'avoidTower' };
      b = withOpt(b, 'escortMin', opt('escortMin', 0, 10, true));
      return withOpt(b, 'hpBelow', opt('hpBelow', 0, 1));
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
  if (errors.list.length > 0) return { ok: false, errors: errors.list };
  return { ok: true, def: { version: version as number, plays: out } };
}
