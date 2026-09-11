// Coach orders (docs/design/bots.md, ADR 0013): the one live instruction a
// bot's owner can give it during a match. Sim state on the unit, set by a
// command like any order and therefore recorded and replayed; read by the
// playbook through the observation (an additive optional field, ADR 0005).
// One order is active at a time, persistent until released or done: a
// goto clears itself on arrival, a focus when its target is gone.

import { hypot } from './exact';
import type { Sim } from './sim';
import type { Unit } from './unit';

export type CoachOrder =
  | { kind: 'goto'; x: number; z: number }
  | { kind: 'warden' }
  // Take the rings' creature: the live one, else the next to rise.
  | { kind: 'creature' }
  | { kind: 'focus'; targetId: number }
  | { kind: 'back' }
  | { kind: 'group' }
  | { kind: 'hold'; x: number; z: number };

export type CoachOrderKind = CoachOrder['kind'] | 'free';

export const COACH_ORDER_KINDS: readonly CoachOrderKind[] = [
  'goto',
  'warden',
  'creature',
  'focus',
  'back',
  'group',
  'hold',
  'free',
];

// A goto is done once the bot stands this close to the point.
export const GOTO_DONE_RADIUS = 3;
// A focus outlives its target being out of sight for this long, so a
// target ducking into brush does not free the bot from the order.
export const FOCUS_UNSEEN_S = 4;

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// Reads an order off an untrusted message. Returns null for 'free' (the
// order to clear) and undefined for anything malformed. A hold with no
// point holds where the unit stands.
export function parseCoachOrder(
  raw: { kind?: unknown; x?: unknown; z?: unknown; targetId?: unknown },
  at: { x: number; z: number },
): CoachOrder | null | undefined {
  switch (raw.kind) {
    case 'free':
      return null;
    case 'goto':
      return finite(raw.x) && finite(raw.z) ? { kind: 'goto', x: raw.x, z: raw.z } : undefined;
    case 'warden':
    case 'creature':
    case 'back':
    case 'group':
      return { kind: raw.kind };
    case 'focus':
      return Number.isInteger(raw.targetId)
        ? { kind: 'focus', targetId: raw.targetId as number }
        : undefined;
    case 'hold':
      return finite(raw.x) && finite(raw.z)
        ? { kind: 'hold', x: raw.x, z: raw.z }
        : { kind: 'hold', x: at.x, z: at.z };
    default:
      return undefined;
  }
}

// Per tick: an order that is done clears itself. Deterministic, reads only
// the sim.
export function stepCoachOrder(sim: Sim, u: Unit): void {
  const order = u.coachOrder;
  if (!order) return;
  if (order.kind === 'goto') {
    if (hypot(u.pos.x - order.x, u.pos.z - order.z) <= GOTO_DONE_RADIUS) u.coachOrder = null;
    return;
  }
  if (order.kind === 'focus') {
    const target = sim.units.get(order.targetId);
    if (!target || target.dead) {
      u.coachOrder = null;
      return;
    }
    if (sim.isVisible(u.team, target.id)) u.coachOrderSeenAt = sim.time;
    else if (sim.time - u.coachOrderSeenAt > FOCUS_UNSEEN_S) u.coachOrder = null;
  }
}
