// The Record over the wire (CONTEXT.md, Record and Match sheet): what the
// server keeps per match a bot played and what the Academy reads back. The
// server side (server/bot_records.ts) writes and validates; the client
// (src/ui/record_view.ts) only draws. Types only, shared by both.

import type { PlayReport } from '../sim/playbook/report';
import type { ScoreRow, TeamId } from '../sim/types';

export type RecordKind = 'sparring' | 'series' | 'arena' | 'live';

export interface RecordEntry {
  id: number;
  botId: string;
  kind: RecordKind;
  at: number;
  seed: number;
  // The series this entry belongs to and its place in it (series only).
  seriesId?: string;
  seriesIndex?: number;
  seriesOf?: number;
  // Who was across the table, in the series' words ("v4 against v3").
  versus?: string;
  // The bot's side.
  team: TeamId;
  winner: TeamId | null;
  ticks: number;
  // The playbook version that played; `edited` when it was the unsaved
  // working copy on top of that version.
  version: number;
  edited: boolean;
  botUnitId: number;
  // All ten seats at the end, names filled.
  score: ScoreRow[];
  report: PlayReport;
  // The replay's id in the store, null when it could not be saved.
  replayId: number | null;
  // Arena and live only, when the match was rated.
  ratingDelta?: number;
}

export type NewRecordEntry = Omit<RecordEntry, 'id' | 'botId'>;

// A row of the Record's list: the entry without its scoreboard and its
// report, the bot's own line and unit kept (the unit names the seat a
// replay follows, src/game/replay_seat.ts).
export interface RecordRow {
  id: number;
  kind: RecordKind;
  at: number;
  seed: number;
  seriesId?: string;
  seriesIndex?: number;
  seriesOf?: number;
  versus?: string;
  team: TeamId;
  winner: TeamId | null;
  ticks: number;
  version: number;
  edited: boolean;
  botUnitId: number;
  line: ScoreRow | null;
  replayId: number | null;
  ratingDelta?: number;
}

// What a run of a bot's Record adds up to. Kills, deaths and assists are
// totals; the client divides by `games` to read a K/D/A per match, which
// is the only honest way to show it (src/ui/kda_text.ts). A match that
// ended with no winner counts as a game and as neither result, so wins
// and losses do not always sum to games.
export interface Tally {
  games: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
}

// The Record read one kind at a time (CONTEXT.md: Record, Sparring), so a
// bot's rated play is never blended with the sparring it did to get there.
// `rated` is the Arena and the live seats together: the number a reader
// of a bot actually wants.
export interface RecordTallies {
  rated: Tally;
  arena: Tally;
  live: Tally;
  sparring: Tally;
  series: Tally;
}
