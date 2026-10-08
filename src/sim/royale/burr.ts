// The Burr (CONTEXT.md): Respawn's score to settle. Whoever takes a champion
// down carries that champion's Burr for BURR_S, seen by nobody but the
// champion it was taken from (its observation's burr, the snapshot's bu
// block): taking the carrier down while it lasts counts BURR_SCORE_FACTOR
// times on the score and pays BURR_PIECES more. A later takedown of the
// owner moves it to the new taker; paying it spends it; a drop-in's Arrival
// starts the seat clean, owing nothing and owed nothing (the person never
// fell, and took nobody down). One life keeps its rules: no Burr there. The
// mode drives the rules from onDeath (burrTakedown), stepAfterDeaths
// (stepBurrs) and beginArrival (clearBurrs).

import type { ObsBurr, ObsRoyale } from '../policy';
import type { Sim } from '../sim';
import type { Unit } from '../unit';
import type { RoyaleMode } from './mode';
import type { BurrState, RoyaleState } from './types';

// How long a Burr lasts after the takedown that hung it, the five seconds
// of the death included.
export const BURR_S = 60;
// What a takedown on the carrier counts on the score, times its own (a
// Lodestar's two count four), and the pieces it pays beyond the takedown's.
export const BURR_SCORE_FACTOR = 2;
export const BURR_PIECES = 1;

const EPS = 1e-9;

// What a takedown's Burr adds (pure): the factor on its score and the
// pieces beyond its own; nothing when it settles none.
export interface BurrPay {
  factor: number;
  pieces: number;
}

export const NO_BURR: BurrPay = { factor: 1, pieces: 0 };

// The owner's Burr while it lasts at `time`, or null.
export function liveBurr(
  burrs: ReadonlyMap<number, BurrState>,
  ownerId: number,
  time: number,
): BurrState | null {
  const b = burrs.get(ownerId);
  return b && time <= b.until + EPS ? b : null;
}

// Whether a takedown of `victimId` by `takerId` at `time` settles the
// taker's Burr: the victim carries it and it still lasts.
export function settlesBurr(
  burrs: ReadonlyMap<number, BurrState>,
  takerId: number,
  victimId: number,
  time: number,
): boolean {
  return liveBurr(burrs, takerId, time)?.carrierId === victimId;
}

// A takedown on the Burr's rules (pure over the state): the taker's Burr on
// the victim paid and spent, and the victim's Burr hung on the taker for
// BURR_S. Respawn only, in play.
export function burrOnTakedown(
  state: RoyaleState,
  victimId: number,
  takerId: number,
  time: number,
): BurrPay {
  if (state.variant !== 'respawn' || state.stage !== 'play') return NO_BURR;
  const paid = settlesBurr(state.burrs, takerId, victimId, time);
  if (paid) state.burrs.delete(takerId);
  state.burrs.set(victimId, { carrierId: takerId, until: time + BURR_S });
  return paid ? { factor: BURR_SCORE_FACTOR, pieces: BURR_PIECES } : NO_BURR;
}

// The mode's takedown (onDeath): what the taker's Burr adds to it.
export function burrTakedown(mode: RoyaleMode, sim: Sim, victim: Unit, taker: Unit): BurrPay {
  return burrOnTakedown(mode.state, victim.id, taker.id, sim.time);
}

// After the deaths: the Burrs run out, and one whose carrier left the
// match goes.
export function stepBurrs(mode: RoyaleMode, sim: Sim): void {
  const burrs = mode.state.burrs;
  if (burrs.size === 0) return;
  for (const [owner, b] of [...burrs]) {
    if (sim.time > b.until + EPS || !sim.units.has(b.carrierId)) burrs.delete(owner);
  }
}

// A seat that starts clean (a drop-in's Arrival): its own Burr gone, and
// every Burr it carries.
export function clearBurrs(state: RoyaleState, unitId: number): void {
  state.burrs.delete(unitId);
  for (const [owner, b] of [...state.burrs]) {
    if (b.carrierId === unitId) state.burrs.delete(owner);
  }
}

// The seat's own Burr as its observation reads it (ObsRoyale.burr): the
// carrier, its level, until when, and where it stands while it stands;
// nothing while none lasts.
export function observeBurr(mode: RoyaleMode, sim: Sim, u: Unit): Pick<ObsRoyale, 'burr'> {
  const b = liveBurr(mode.state.burrs, u.id, sim.time);
  if (!b) return {};
  const carrier = sim.units.get(b.carrierId);
  const out: ObsBurr = { id: b.carrierId, level: carrier?.level ?? 1, until: b.until };
  if (carrier && !carrier.dead && carrier.pos.y !== undefined) {
    out.at = { x: carrier.pos.x, y: carrier.pos.y, z: carrier.pos.z };
  }
  return { burr: out };
}
