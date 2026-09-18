// The practice reports (src/net/practice_report.ts), as the server keeps
// them: one line per report in practice.jsonl under the data directory,
// with the time it arrived and nothing else added. The parse is strict
// and bounded, because the route takes no session: a browser that never
// played a match can post to it, so a line is only ever what a match's
// scoreboard could be, and anything else is dropped before the disk.

import { readFileSync } from 'node:fs';
import type { PracticeReport, PracticeResult, PracticeRow } from '../src/net/practice_report';
import { PRACTICE_REPORT_VERSION } from '../src/net/practice_report';
import { appendJsonl } from './store';

export const PRACTICE_ROWS_MAX = 10;
export const PRACTICE_ITEMS_MAX = 6;
export const PRACTICE_ID_MAX = 48;
// Longer than any match the sim ends on its own.
export const PRACTICE_SECONDS_MAX = 4 * 3600;

const RESULTS: readonly PracticeResult[] = ['won', 'lost', 'left'];
const ID = /^[A-Za-z0-9_-]{1,48}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function count(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
}

function parseRow(raw: unknown): PracticeRow | null {
  if (!isRecord(raw)) return null;
  const championId =
    typeof raw.championId === 'string' && ID.test(raw.championId) ? raw.championId : null;
  const team = raw.team === 0 || raw.team === 1 ? raw.team : null;
  const level = count(raw.level, 30);
  const kills = count(raw.kills, 500);
  const deaths = count(raw.deaths, 500);
  const assists = count(raw.assists, 500);
  const cs = count(raw.cs, 5000);
  if (
    championId === null ||
    team === null ||
    typeof raw.self !== 'boolean' ||
    level === null ||
    kills === null ||
    deaths === null ||
    assists === null ||
    cs === null ||
    !Array.isArray(raw.items) ||
    raw.items.length > PRACTICE_ITEMS_MAX ||
    !raw.items.every((i) => typeof i === 'string' && ID.test(i))
  ) {
    return null;
  }
  return {
    championId,
    team,
    self: raw.self,
    level,
    kills,
    deaths,
    assists,
    cs,
    items: raw.items as string[],
  };
}

// Null for anything that is not a report a match could have written: the
// caller answers 400 and stores nothing.
export function parsePracticeReport(raw: unknown): PracticeReport | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== PRACTICE_REPORT_VERSION) return null;
  const result = RESULTS.find((r) => r === raw.result);
  if (!result) return null;
  const seconds = count(raw.seconds, PRACTICE_SECONDS_MAX);
  if (seconds === null) return null;
  if (typeof raw.forged !== 'boolean' || typeof raw.touch !== 'boolean') return null;
  if (typeof raw.signedIn !== 'boolean') return null;
  if (!Array.isArray(raw.rows) || raw.rows.length === 0 || raw.rows.length > PRACTICE_ROWS_MAX) {
    return null;
  }
  const rows: PracticeRow[] = [];
  for (const r of raw.rows) {
    const row = parseRow(r);
    if (!row) return null;
    rows.push(row);
  }
  // One seat was the person's, exactly: a report says whose numbers are
  // whose or it says nothing.
  if (rows.filter((r) => r.self).length !== 1) return null;
  return {
    v: PRACTICE_REPORT_VERSION,
    result,
    seconds,
    forged: raw.forged,
    touch: raw.touch,
    signedIn: raw.signedIn,
    rows,
  };
}

export interface StoredPracticeReport extends PracticeReport {
  at: number;
}

export class PracticeReportStore {
  constructor(private readonly file: string) {}

  append(report: PracticeReport, at: number): void {
    const stored: StoredPracticeReport = { at, ...report };
    appendJsonl(this.file, stored);
  }

  // Every report on disk, oldest first; a torn last line (a crash mid
  // write) is skipped rather than fatal.
  readAll(): StoredPracticeReport[] {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return [];
    }
    return readPracticeLines(text);
  }
}

export function readPracticeLines(text: string): StoredPracticeReport[] {
  const out: StoredPracticeReport[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const report = parsePracticeReport(raw);
      if (report && typeof raw.at === 'number') out.push({ at: raw.at, ...report });
    } catch {
      // A torn line.
    }
  }
  return out;
}
