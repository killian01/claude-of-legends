// Seats driven by a Policy that runs outside the sim process (ADR 0002
// phase 2). The sim never runs a model and never opens a socket: it ships an
// observation on the seat's decision slot and accepts one action back, which
// lands on the NEXT slot. That one slot of pipeline is what being remote
// costs, and it is identical in the headless environment and on the live
// server, so a policy trained against one behaves the same on the other.
//
// Everything here is deterministic and I/O free: the transport lives in
// headless/ and server/, never in src/sim/.

import { dispatchAction } from './action_dispatch';
import { isDecisionSlot } from './bot_driver';
import { buildObservation } from './observe';
import type { Action, Observation } from './policy';
import type { Sim } from './sim';

export interface RemoteSeat {
  unitId: number;
  // Queued since the seat's last slot; the latest one wins, exactly like a
  // movement intention. Consumed on the slot, so flooding buys nothing.
  pending: Action | null;
  // Built on the seat's last slot, waiting for the holder to drain it.
  // Overwritten if the holder is too slow: a stale observation is worse
  // than a skipped one.
  observation: Observation | null;
  // Slots that produced an observation, and actions actually dispatched.
  // The honest per-seat counters a trainer needs to spot a stalled loop.
  slots: number;
  dispatched: number;
}

export function createRemoteSeat(unitId: number): RemoteSeat {
  return { unitId, pending: null, observation: null, slots: 0, dispatched: 0 };
}

// Called from inside the tick at the exact point runBotDecisions runs, so an
// in-sim bot and a remote policy act at the same moment of the same tick.
// Order within the slot: the queued action is dispatched FIRST, then the new
// observation is built, so what a remote receives already reflects its own
// previous action, the way a client's snapshot does.
export function runRemoteDecisions(sim: Sim, seats: ReadonlyMap<number, RemoteSeat>): void {
  for (const seat of seats.values()) {
    if (!isDecisionSlot(sim.tickCount, seat.unitId)) continue;
    const u = sim.units.get(seat.unitId);
    if (!u || u.dead) {
      // A dead seat decides nothing, exactly like an attached policy, and
      // its queue is dropped rather than replayed on respawn.
      seat.pending = null;
      seat.observation = null;
      continue;
    }
    if (seat.pending) {
      if (dispatchAction(sim, seat.unitId, seat.pending)) seat.dispatched++;
      seat.pending = null;
    }
    seat.observation = buildObservation(sim, seat.unitId);
    if (seat.observation) seat.slots++;
  }
}
