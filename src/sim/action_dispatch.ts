// The one place a Policy action becomes sim state. Every driver goes through
// it: in-sim scripted bots (bot_driver.ts) and remote policies holding a seat
// (remote_policy.ts). Both dispatch through the SAME public sim commands human
// input uses, so validation and the decision budget apply identically
// (ADR 0002, ADR 0003). One function is what stops the scripted path and the
// trained path from drifting apart, the way src/net/replay.ts keeps the live
// and replayed command paths pinned to each other.

import type { Action } from './policy';
import type { Sim } from './sim';
import type { Vec2 } from './types';

function finite(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b);
}

// The third coordinate of a point on the planet (ADR 0029): absent on the
// plane; present and not finite, the action is malformed.
function third(y: number | undefined): { ok: boolean; y: number | undefined } {
  if (y === undefined) return { ok: true, y: undefined };
  return { ok: Number.isFinite(y), y };
}

// The point an action names: the plane's {x, z}, the sphere's with y.
function at(x: number, z: number, y: number | undefined): Vec2 {
  return y === undefined ? { x, z } : { x, y, z };
}

// Dispatch one action for one seat. Returns false when the action was
// rejected outright (malformed coordinates, a target the team cannot see);
// a well-formed action that the sim then refuses on its own rules (no
// decision token, ability on cooldown) still returns true: it was spent.
export function dispatchAction(sim: Sim, unitId: number, action: Action): boolean {
  const u = sim.units.get(unitId);
  if (!u) return false;
  switch (action.kind) {
    case 'move': {
      const y = third(action.y);
      if (!finite(action.x, action.z) || !y.ok) return false;
      sim.orderMove(unitId, action.x, action.z, y.y);
      return true;
    }
    case 'attack':
      // Fog applies to acting, not only to seeing: a policy sees just what
      // its team sees (observe.ts), so ordering an attack on a unit outside
      // team vision is a leak whatever produced the id. The observation's
      // lastSeen block carries ids of champions that are NOT visible, which
      // is exactly the case this rejects.
      if (!Number.isInteger(action.targetId)) return false;
      if (!sim.isVisible(u.team, action.targetId)) return false;
      sim.orderAttack(unitId, action.targetId);
      return true;
    case 'cast': {
      const y = third(action.y);
      if (!finite(action.x, action.z) || !y.ok) return false;
      sim.castAbility(unitId, action.key, at(action.x, action.z, y.y));
      return true;
    }
    case 'sigil': {
      if (action.slot !== 0 && action.slot !== 1) return false;
      const y = third(action.y);
      if (!finite(action.x, action.z) || !y.ok) return false;
      sim.castSigil(unitId, action.slot, at(action.x, action.z, y.y));
      return true;
    }
    case 'buy':
      if (typeof action.itemId !== 'string') return false;
      sim.buyItem(unitId, action.itemId);
      return true;
    case 'level':
      sim.levelAbility(unitId, action.key);
      return true;
    case 'recall':
      sim.startRecall(unitId);
      return true;
    case 'sell':
      if (!Number.isInteger(action.slot) || action.slot < 0) return false;
      sim.sellItem(unitId, action.slot);
      return true;
    case 'stop':
      sim.orderStop(unitId);
      return true;
    case 'drop':
      if (!finite(action.x, action.z) || !Number.isFinite(action.y)) return false;
      sim.pickDrop(unitId, { x: action.x, y: action.y, z: action.z });
      return true;
    case 'graft':
      // Free like 'level' and 'drop': no decision token, and the mode
      // decides whether an offer is open.
      if (action.pick !== 0 && action.pick !== 1 && action.pick !== 2) return false;
      sim.pickGraft(unitId, action.pick);
      return true;
    default:
      return true;
  }
}
