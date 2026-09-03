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
// report, the bot's own line kept.
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
  line: ScoreRow | null;
  replayId: number | null;
  ratingDelta?: number;
}

export interface RecordTally {
  wins: number;
  losses: number;
}
