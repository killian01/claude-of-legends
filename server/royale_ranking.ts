// The battle royale's ranking (ADR 0031) and the result each person is
// told at the end. One life ranks the last standing first, then the
// fallen, the last to fall first; a place is known the moment a champion
// is out. Respawn ranks by takedowns scored (the score leader's counts
// double, src/sim/royale/types.ts), fewer deaths first on a tie, and the
// places are known when the last light goes out; a drop-in is also ranked
// on what every seat scored since they landed (windowStanding). Pure over
// the mode's state.

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

// Respawn's standing as the HUD's top line tells it (src/ui/royale_text.ts
// countLine): the seat's rank in the ranking, and the gap in takedowns to
// the seat above it, or for the first its lead over the second. Null for a
// seat not in the ranking.
export function rankAndGap(
  state: RankState,
  seats: readonly RankedSeat[],
  unitId: number,
): { rank: number; gap: number } | null {
  return rankAndGapIn(royaleRanking(state, seats), state, unitId);
}

// The same, over a ranking already made (one per tick for every viewer).
export function rankAndGapIn(
  ranking: readonly number[],
  state: Pick<RoyaleState, 'scores'>,
  unitId: number,
): { rank: number; gap: number } | null {
  const i = ranking.indexOf(unitId);
  if (i < 0) return null;
  const score = (id: number | undefined): number =>
    id === undefined ? 0 : (state.scores.get(id) ?? 0);
  const own = score(unitId);
  const gap = i === 0 ? own - score(ranking[1]) : score(ranking[i - 1]) - own;
  return { rank: i + 1, gap: Math.max(0, gap) };
}

// Respawn's standing since a drop-in landed (server/royale_match.ts
// RoyalePlayer.window): each seat's takedowns scored since then, its score
// less the one it held at the landing (`base`, a seat it does not hold
// counting from zero, never below zero), ranked the way a table of ties
// reads, one more than the seats with more. The gap is to the next better
// score, or for the first its lead over the next; aboveId is the seat
// holding that next better score, the lowest id on a tie, and null for the
// first. Out of every seat of the match (`of`).
export interface WindowStanding {
  rank: number;
  of: number;
  score: number;
  gap: number;
  aboveId: number | null;
}

export function windowStanding(
  scores: ReadonlyMap<number, number>,
  base: ReadonlyMap<number, number>,
  seatIds: readonly number[],
  unitId: number,
): WindowStanding {
  const since = (id: number): number => Math.max(0, (scores.get(id) ?? 0) - (base.get(id) ?? 0));
  const own = since(unitId);
  let more = 0;
  let next: number | null = null;
  let aboveId: number | null = null;
  let runnerUp = 0;
  for (const id of seatIds) {
    if (id === unitId) continue;
    const s = since(id);
    if (s > own) {
      more += 1;
      if (next === null || s < next || (s === next && aboveId !== null && id < aboveId)) {
        next = s;
        aboveId = id;
      }
    } else if (s > runnerUp) {
      runnerUp = s;
    }
  }
  return {
    rank: 1 + more,
    of: seatIds.length,
    score: own,
    gap: next !== null ? next - own : own - runnerUp,
    aboveId,
  };
}

// How close the near miss of the end card is: the seat just above, when
// it was no more than this many takedowns ahead.
export const NEAR_MISS_BY = 2;

// The places of every seat at the end, from the ranking.
export function finalPlaces(ranking: readonly number[]): Map<number, number> {
  return new Map(ranking.map((id, i) => [id, i + 1]));
}

// How many of the top a result shows.
export const RESULT_TOP = 10;

// The result told at the end. Respawn adds, for a drop-in (`windowBase`,
// every seat's score when they landed), the standing since then; and for
// every seat the near miss: the seat just above, in that window, else in
// the whole match, when it was within NEAR_MISS_BY takedowns. The place is
// the whole match's either way. One life's result has neither.
export function royaleResult(
  state: RankState,
  seats: readonly RankedSeat[],
  unitId: number,
  windowBase: ReadonlyMap<number, number> | null = null,
): RoyaleResult {
  const ranking = royaleRanking(state, seats);
  const byId = new Map(seats.map((s) => [s.unitId, s]));
  const known = placeOf(state, seats.length, unitId);
  const place = known ?? ranking.indexOf(unitId) + 1;
  const winner = state.winnerId !== null ? (byId.get(state.winnerId)?.name ?? null) : null;
  const score = (id: number): number => state.scores.get(id) ?? 0;
  const result: RoyaleResult = {
    t: 'royale_result',
    v: state.variant,
    place: place > 0 ? place : seats.length,
    of: seats.length,
    score: score(unitId),
    winner,
    top: ranking.slice(0, RESULT_TOP).flatMap((id) => {
      const s = byId.get(id);
      return s ? [{ name: s.name, championId: s.championId, score: score(id), bot: s.bot }] : [];
    }),
  };
  if (state.variant !== 'respawn') return result;
  let above: { id: number; by: number } | null = null;
  if (windowBase) {
    const ids = seats.map((s) => s.unitId);
    const w = windowStanding(state.scores, windowBase, ids, unitId);
    result.window = { rank: w.rank, of: w.of, score: w.score };
    if (w.aboveId !== null) above = { id: w.aboveId, by: w.gap };
  } else {
    const id = ranking[ranking.indexOf(unitId) - 1];
    if (id !== undefined) above = { id, by: score(id) - score(unitId) };
  }
  // A tie is no takedown short: the near miss counts from one.
  const name = above ? byId.get(above.id)?.name : undefined;
  if (above && name !== undefined && above.by >= 1 && above.by <= NEAR_MISS_BY) {
    result.gap = { name, by: above.by };
  }
  return result;
}
