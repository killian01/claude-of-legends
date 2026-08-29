// The environment's request handling, pure and transport free: one request
// object in, one response object out, plus the environment to use for the
// next one. headless/main.ts is then nothing but a line reader, which is
// what keeps the protocol testable without spawning a process.
//
// Everything arriving here is a stranger's JSON, so seats and actions clear
// a validator before they reach the sim (src/net/policy_wire.ts).

import { parseAction } from '../src/net/policy_wire';
import { CHAMPIONS } from '../src/sim/content/champions';
import type { Action } from '../src/sim/policy';
import type { TeamId } from '../src/sim/types';
import { Env, type EnvSeatSpec } from './env';

export function parseSeats(raw: unknown): EnvSeatSpec[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: EnvSeatSpec[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const s = item as Record<string, unknown>;
    if (typeof s.championId !== 'string' || !CHAMPIONS[s.championId]) return null;
    const team: TeamId = s.team === 1 ? 1 : 0;
    const sigils = Array.isArray(s.sigils) && s.sigils.length === 2 ? s.sigils : null;
    out.push({
      team,
      championId: s.championId,
      remote: s.remote === true,
      ...(typeof s.bot === 'string' ? { bot: s.bot } : {}),
      ...(sigils ? { sigils: [String(sigils[0]), String(sigils[1])] as [string, string] } : {}),
    });
  }
  return out;
}

// A malformed action is silently nothing, never a guess: that seat simply
// said nothing this slot, and its persistent intentions carry on.
export function parseActions(raw: unknown): Record<number, Action> {
  const out: Record<number, Action> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    const action = parseAction(value);
    if (action) out[index] = action;
  }
  return out;
}

export interface RequestResult {
  env: Env;
  response: Record<string, unknown>;
  close?: boolean;
}

export function handleRequest(env: Env, raw: unknown): RequestResult {
  if (typeof raw !== 'object' || raw === null) {
    return { env, response: { t: 'error', message: 'malformed request' } };
  }
  const msg = raw as Record<string, unknown>;
  switch (msg.t) {
    case 'info':
      return { env, response: { t: 'info', ...env.info() } };
    case 'reset': {
      const seats = msg.seats === undefined ? undefined : parseSeats(msg.seats);
      if (seats === null) return { env, response: { t: 'error', message: 'malformed seats' } };
      const next = new Env({
        ...(typeof msg.seed === 'number' && Number.isFinite(msg.seed) ? { seed: msg.seed } : {}),
        ...(seats ? { seats } : {}),
        ...(typeof msg.maxTicks === 'number' && msg.maxTicks > 0
          ? { maxTicks: Math.floor(msg.maxTicks) }
          : {}),
      });
      return { env: next, response: { t: 'obs', ...next.reset() } };
    }
    case 'step':
      return { env, response: { t: 'obs', ...env.step(parseActions(msg.actions)) } };
    case 'close':
      return { env, response: { t: 'bye' }, close: true };
    default:
      return { env, response: { t: 'error', message: 'unknown request' } };
  }
}
