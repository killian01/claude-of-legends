// A person's orders in a battle royale (ADR 0031), validated and handed to
// the sim like the 5v5's (src/net/replay.ts applySimCommand), with the
// point's y passed along on the planet's sphere (ADR 0029). The mode has no
// shop, no recall and no ranks to spend (loot is the build, spells rank
// themselves), so those verbs are nobody's here; nor is a coach's order.

import { type ClientMsg, wirePoint } from '../src/net/protocol';
import type { AbilityKey } from '../src/sim/types';
import type { RoyaleSim } from './royale_sim';

const ABILITY_KEYS: ReadonlySet<string> = new Set(['Q', 'W', 'E', 'R']);

// The verbs a seat may send in a battle royale.
export const ROYALE_VERBS: ReadonlySet<string> = new Set([
  'move',
  'attack',
  'attack_move',
  'stop',
  'cast',
  'sigil',
]);

export function applyRoyaleCommand(
  sim: RoyaleSim,
  team: number,
  unitId: number,
  msg: ClientMsg,
): void {
  switch (msg.t) {
    case 'move': {
      const p = wirePoint(msg.x, msg.z, msg.y);
      if (p) sim.orderMove(unitId, p.x, p.z, p.y);
      break;
    }
    case 'attack_move': {
      const p = wirePoint(msg.x, msg.z, msg.y);
      if (p) sim.orderAttackMove(unitId, p.x, p.z, p.y);
      break;
    }
    case 'attack':
      if (typeof msg.targetId === 'number' && sim.isVisible(team, msg.targetId)) {
        sim.orderAttack(unitId, msg.targetId);
      }
      break;
    case 'stop':
      sim.orderStop(unitId);
      break;
    case 'cast': {
      const p = wirePoint(msg.x, msg.z, msg.y);
      if (typeof msg.key === 'string' && ABILITY_KEYS.has(msg.key) && p) {
        sim.castAbility(unitId, msg.key as AbilityKey, p);
      }
      break;
    }
    case 'sigil': {
      const p = wirePoint(msg.x, msg.z, msg.y);
      if ((msg.slot === 0 || msg.slot === 1) && p) sim.castSigil(unitId, msg.slot, p);
      break;
    }
    default:
      break;
  }
}
