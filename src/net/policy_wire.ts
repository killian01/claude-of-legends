// Parsing the frozen action space off an untrusted stream. A remote policy
// is a stranger's process: everything it sends is unvalidated JSON until it
// clears this file. Nothing here interprets the game, it only decides
// whether a value IS an Action (policy.ts, contract v0); the sim then
// applies its own rules through action_dispatch.ts.

import type { Action } from '../sim/policy';
import type { AbilityKey } from '../sim/types';
import { isFiniteVec } from './protocol';

const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

function isAbilityKey(v: unknown): v is AbilityKey {
  return typeof v === 'string' && (ABILITY_KEYS as readonly string[]).includes(v);
}

// Returns null for anything that is not a well-formed action. Callers treat
// null as "this seat said nothing this slot", never as a reason to guess.
export function parseAction(raw: unknown): Action | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  switch (a.kind) {
    case 'noop':
      return { kind: 'noop' };
    case 'move':
      return isFiniteVec(a.x, a.z) ? { kind: 'move', x: a.x as number, z: a.z as number } : null;
    case 'attack':
      return typeof a.targetId === 'number' && Number.isInteger(a.targetId)
        ? { kind: 'attack', targetId: a.targetId }
        : null;
    case 'cast':
      return isAbilityKey(a.key) && isFiniteVec(a.x, a.z)
        ? { kind: 'cast', key: a.key, x: a.x as number, z: a.z as number }
        : null;
    case 'sigil':
      return (a.slot === 0 || a.slot === 1) && isFiniteVec(a.x, a.z)
        ? { kind: 'sigil', slot: a.slot, x: a.x as number, z: a.z as number }
        : null;
    case 'buy':
      return typeof a.itemId === 'string' ? { kind: 'buy', itemId: a.itemId } : null;
    case 'level':
      return isAbilityKey(a.key) ? { kind: 'level', key: a.key } : null;
    case 'recall':
      return { kind: 'recall' };
    default:
      return null;
  }
}
