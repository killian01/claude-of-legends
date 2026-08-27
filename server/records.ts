// One finished match, one JSONL line: the record built from the final
// scoreboard the moment a winner is decided. Pure builder, so the shape
// of what history and (later) ratings consume is pinned by tests. Seats
// held by a connected human at the end carry that player's id; bot fill
// and seats abandoned mid-match record playerId null (a walk-out earns
// no history line, deliberately).

import type { ScoreRow, TeamId } from '../src/sim/types';

export interface MatchPlayerRecord {
  playerId: number | null;
  name: string;
  championId: string;
  team: TeamId;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  // Signed Elo movement, present only on rated human seats.
  ratingDelta?: number;
}

export interface MatchRecord {
  // Wall-clock ms when the match ended.
  at: number;
  durationS: number;
  winner: TeamId;
  // Rated: at least one human on each side (server/rating.ts policy).
  rated: boolean;
  players: MatchPlayerRecord[];
}

export function buildMatchRecord(
  rows: readonly ScoreRow[],
  playerIdByUnit: ReadonlyMap<number, number>,
  winner: TeamId,
  durationS: number,
  at: number,
  rating?: { rated: boolean; deltas: ReadonlyMap<number, number> },
): MatchRecord {
  return {
    at,
    durationS: Math.round(durationS),
    winner,
    rated: rating?.rated ?? false,
    players: rows.map((r) => {
      const playerId = playerIdByUnit.get(r.unitId) ?? null;
      const delta = playerId !== null ? rating?.deltas.get(playerId) : undefined;
      return {
        playerId,
        name: r.name,
        championId: r.championId,
        team: r.team,
        level: r.level,
        kills: r.kills,
        deaths: r.deaths,
        assists: r.assists ?? 0,
        cs: r.cs ?? 0,
        ...(delta !== undefined ? { ratingDelta: delta } : {}),
      };
    }),
  };
}
