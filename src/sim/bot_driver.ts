// Drives attached Policies inside the tick (the vale_cup pattern from
// world-of-claudecraft): bots are sim entities, not connections. Decisions
// run every POLICY_PERIOD_TICKS ticks (4 Hz, matching the decision budget
// refill), staggered by unit id, and are dispatched through the SAME public
// sim commands human input uses, so validation and the decision budget apply
// identically (ADR 0002, ADR 0003).

import { buildObservation } from './observe';
import type { Policy } from './policy';
import type { Sim } from './sim';

export const POLICY_PERIOD_TICKS = 5;

export function runBotDecisions(sim: Sim, policies: ReadonlyMap<number, Policy>): void {
  for (const [unitId, policy] of policies) {
    if ((sim.tickCount + unitId) % POLICY_PERIOD_TICKS !== 0) continue;
    const u = sim.units.get(unitId);
    if (!u || u.dead) continue;
    const obs = buildObservation(sim, unitId);
    if (!obs) continue;
    const action = policy(obs, sim.rng);
    switch (action.kind) {
      case 'move':
        sim.orderMove(unitId, action.x, action.z);
        break;
      case 'attack':
        sim.orderAttack(unitId, action.targetId);
        break;
      case 'cast':
        sim.castAbility(unitId, action.key, { x: action.x, z: action.z });
        break;
      case 'sigil':
        sim.castSigil(unitId, action.slot, { x: action.x, z: action.z });
        break;
      case 'buy':
        sim.buyItem(unitId, action.itemId);
        break;
      default:
        break;
    }
  }
}
