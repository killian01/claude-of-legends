// Drives attached Policies inside the tick (the vale_cup pattern from
// world-of-claudecraft): bots are sim entities, not connections. Decisions
// run one per decision slot (4 Hz, matching the decision budget refill),
// staggered by unit id, and are dispatched through action_dispatch.ts, the
// same path a remote policy uses (ADR 0002, ADR 0003).

import { dispatchAction } from './action_dispatch';
import { buildObservation } from './observe';
import type { Policy } from './policy';
import type { Sim } from './sim';

export const POLICY_PERIOD_TICKS = 5;

// One slot every POLICY_PERIOD_TICKS, offset by unit id so the ten seats do
// not all decide on the same tick. Remote policies read the same schedule,
// so an in-sim bot and a trained one act on the identical cadence.
export function isDecisionSlot(tickCount: number, unitId: number): boolean {
  return (tickCount + unitId) % POLICY_PERIOD_TICKS === 0;
}

export function runBotDecisions(sim: Sim, policies: ReadonlyMap<number, Policy>): void {
  for (const [unitId, policy] of policies) {
    if (!isDecisionSlot(sim.tickCount, unitId)) continue;
    const u = sim.units.get(unitId);
    if (!u || u.dead) continue;
    const obs = buildObservation(sim, unitId);
    if (!obs) continue;
    dispatchAction(sim, unitId, policy(obs, sim.rng));
  }
}
