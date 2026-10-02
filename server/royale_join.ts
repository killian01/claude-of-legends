// Entering a battle royale (ADR 0031, ADR 0025's drop in): a person joins
// the liveliest running match of the variant they asked for while it still
// takes people, in a bot's seat, and a new match starts for them when none
// does. Respawn takes people until JOIN_UNTIL_END_S before the end; One
// life only during the drop and the calm, before anyone can have fallen
// for good. Pure: the service hands in what it knows of its matches.

import {
  CALM_S,
  JOIN_UNTIL_END_S,
  type RoyaleStage,
  type RoyaleVariant,
} from '../src/sim/royale/types';

export interface RoyaleCandidate {
  matchId: number;
  variant: RoyaleVariant;
  stage: RoyaleStage;
  // Sim time now, when everyone lands, and when the last light goes out.
  time: number;
  dropEndsAt: number;
  endsAt: number;
  // People connected and playing in it.
  people: number;
  // Bot seats a newcomer may take.
  openSeats: number;
  // Ended, or left by everyone and held for a rejoin only.
  closing: boolean;
}

// Whether the match still takes a newcomer.
export function takesPeople(c: RoyaleCandidate): boolean {
  if (c.closing || c.openSeats <= 0 || c.stage === 'over') return false;
  if (c.variant === 'respawn') return c.time < c.endsAt - JOIN_UNTIL_END_S;
  return c.stage === 'drop' || c.time < c.dropEndsAt + CALM_S;
}

// The match to join, or null to start one: the most people, then the
// youngest, then the lowest id.
export function chooseRoyaleMatch(
  candidates: readonly RoyaleCandidate[],
  variant: RoyaleVariant,
): number | null {
  let best: RoyaleCandidate | null = null;
  for (const c of candidates) {
    if (c.variant !== variant || !takesPeople(c)) continue;
    if (
      !best ||
      c.people > best.people ||
      (c.people === best.people &&
        (c.time < best.time || (c.time === best.time && c.matchId < best.matchId)))
    ) {
      best = c;
    }
  }
  return best ? best.matchId : null;
}

// A bot seat as the choice reads it.
export interface BotSeatCandidate {
  unitId: number;
  championId: string;
  // Down for now (Respawn brings it back), or out for good (One life).
  dead: boolean;
  out: boolean;
}

// The seat a newcomer takes: never one out for good; a bot playing the
// champion they picked first, then one standing, then the lowest unit id,
// so the choice depends on nothing but the match.
export function chooseBotSeat(
  seats: readonly BotSeatCandidate[],
  championId: string,
): number | null {
  let best: BotSeatCandidate | null = null;
  const rank = (s: BotSeatCandidate): number =>
    (s.championId === championId ? 0 : 2) + (s.dead ? 1 : 0);
  for (const s of seats) {
    if (s.out) continue;
    if (!best || rank(s) < rank(best) || (rank(s) === rank(best) && s.unitId < best.unitId)) {
      best = s;
    }
  }
  return best ? best.unitId : null;
}
