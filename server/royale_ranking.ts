// The battle royale's ranking (ADR 0031) and the result each person is
// told at the end. One life ranks the last standing first, then the
// fallen, the last to fall first; a place is known the moment a champion
// is out. Respawn ranks by takedowns scored (the score leader's counts
// double, src/sim/royale/types.ts), fewer deaths first on a tie, and the
// places are known when the last light goes out. Pure over the mode's
// state.

import type { RoyaleResult } from '../src/net/royale_wire';
import type { RoyaleState } from '../src/sim/royale/types';

// The seats as the ranking reads them, in seat order.
export interface RankedSeat {
  unitId: number;
  name: string;
  championId: string;
  bot: boolean;
  deaths: number;
}

type RankState = Pick<RoyaleState, 'variant' | 'stage' | 'scores' | 'eliminated' | 'winnerId'>;

// Every seat's unit id, best first.
export function royaleRanking(state: RankState, seats: readonly RankedSeat[]): number[] {
  const score = (id: number): number => state.scores.get(id) ?? 0;
  const deaths = new Map(seats.map((s) => [s.unitId, s.deaths]));
  const byScore = (a: number, b: number): number =>
    score(b) - score(a) || (deaths.get(a) ?? 0) - (deaths.get(b) ?? 0) || a - b;
  const winner = state.winnerId;
  if (state.variant === 'respawn') {
    const rest = seats
      .map((s) => s.unitId)
      .filter((id) => id !== winner)
      .sort(byScore);
    return winner !== null && deaths.has(winner) ? [winner, ...rest] : rest;
  }
  const out = new Set(state.eliminated);
  const standing = seats
    .map((s) => s.unitId)
    .filter((id) => id !== winner && !out.has(id))
    .sort(byScore);
  const fallen = [...state.eliminated].reverse().filter((id) => id !== winner);
  return [...(winner !== null && deaths.has(winner) ? [winner] : []), ...standing, ...fallen];
}

// A seat's place once it is known, else null: One life, when the champion
// is out or has won; Respawn, at the end.
export function placeOf(state: RankState, seatCount: number, unitId: number): number | null {
  if (state.variant === 'one_life') {
    if (state.winnerId === unitId) return 1;
    const k = state.eliminated.indexOf(unitId);
    if (k >= 0) return seatCount - k;
    return null;
  }
  return null;
}

// The places of every seat at the end, from the ranking.
export function finalPlaces(ranking: readonly number[]): Map<number, number> {
  return new Map(ranking.map((id, i) => [id, i + 1]));
}

// How many of the top a result shows.
export const RESULT_TOP = 10;

export function royaleResult(
  state: RankState,
  seats: readonly RankedSeat[],
  unitId: number,
): RoyaleResult {
  const ranking = royaleRanking(state, seats);
  const byId = new Map(seats.map((s) => [s.unitId, s]));
  const known = placeOf(state, seats.length, unitId);
  const place = known ?? ranking.indexOf(unitId) + 1;
  const winner = state.winnerId !== null ? (byId.get(state.winnerId)?.name ?? null) : null;
  return {
    t: 'royale_result',
    v: state.variant,
    place: place > 0 ? place : seats.length,
    of: seats.length,
    score: state.scores.get(unitId) ?? 0,
    winner,
    top: ranking.slice(0, RESULT_TOP).flatMap((id) => {
      const s = byId.get(id);
      return s
        ? [{ name: s.name, championId: s.championId, score: state.scores.get(id) ?? 0, bot: s.bot }]
        : [];
    }),
  };
}
