// One finished match, one JSONL line: the record built from the final
// scoreboard the moment a winner is decided. Pure builder, so the shape
// of what history and (later) ratings consume is pinned by tests. Seats
// held by a connected human at the end carry that player's id; bot fill
// and seats abandoned mid-match record accountId null (a walk-out earns
// no history line, deliberately).

import type { ScoreRow, TeamId } from '../src/sim/types';

export interface MatchPlayerRecord {
  accountId: number | null;
  name: string;
  championId: string;
  team: TeamId;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  // Signed Elo movement, present only on rated owned seats.
  ratingDelta?: number;
  // The seat was the account's own bot (ADR 0013); absent for hand seats.
  way?: 'bot';
}

export interface MatchRecord {
  // Wall-clock ms when the match ended.
  at: number;
  durationS: number;
  winner: TeamId;
  // Rated: at least one human on each side (server/rating.ts policy).
  rated: boolean;
  // Which ladder the deltas belong to: absent for the classic queue,
  // 'forge' when they moved the Forge queue's own rating (ADR 0011),
  // 'arena' for a server-run Arena match (ADR 0013).
  queue?: 'forge' | 'arena';
  // Saved replay id (the match id), absent when no replay was kept.
  replayId?: number;
  players: MatchPlayerRecord[];
}

export function buildMatchRecord(
  rows: readonly ScoreRow[],
  accountIdByUnit: ReadonlyMap<number, number>,
  winner: TeamId,
  durationS: number,
  at: number,
  rating?: {
    rated: boolean;
    deltas: ReadonlyMap<number, number>;
    queue?: 'forge' | 'arena';
    // Bot seats by unit id.
    ways?: ReadonlyMap<number, 'bot'>;
  },
  replayId?: number,
): MatchRecord {
  return {
    at,
    durationS: Math.round(durationS),
    winner,
    rated: rating?.rated ?? false,
    ...(rating?.queue !== undefined ? { queue: rating.queue } : {}),
    ...(replayId !== undefined ? { replayId } : {}),
    players: rows.map((r) => {
      const accountId = accountIdByUnit.get(r.unitId) ?? null;
      const delta = accountId !== null ? rating?.deltas.get(accountId) : undefined;
      return {
        accountId,
        // The person, when there is one; the champion otherwise.
        name: r.player ?? r.name,
        championId: r.championId,
        team: r.team,
        level: r.level,
        kills: r.kills,
        deaths: r.deaths,
        assists: r.assists ?? 0,
        cs: r.cs ?? 0,
        ...(delta !== undefined ? { ratingDelta: delta } : {}),
        ...(rating?.ways?.get(r.unitId) === 'bot' ? { way: 'bot' as const } : {}),
      };
    }),
  };
}
