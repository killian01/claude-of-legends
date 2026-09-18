// The practice report, end to end and without a browser: built off a
// scoreboard (src/net/practice_report.ts), parsed and kept by the server
// (server/practice_reports.ts), and summed up by the script that reads
// the file (scripts/practice_report.ts).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatPracticeSummary,
  loadPracticeReports,
  summarizePractice,
} from '../scripts/practice_report';
import {
  PracticeReportStore,
  parsePracticeReport,
  readPracticeLines,
  type StoredPracticeReport,
} from '../server/practice_reports';
import {
  buildPracticeReport,
  PRACTICE_REPORT_ROUTE,
  type PracticeReport,
  practiceResult,
  sendPracticeReport,
} from '../src/net/practice_report';
import type { ScoreRow } from '../src/sim/types';

function row(
  unitId: number,
  team: 0 | 1,
  championId: string,
  over: Partial<ScoreRow> = {},
): ScoreRow {
  return {
    unitId,
    name: championId,
    championId,
    player: null,
    team,
    level: 8,
    kills: 2,
    deaths: 3,
    assists: 1,
    cs: 40,
    items: ['iron_blade'],
    ...over,
  };
}

const rows: ScoreRow[] = [
  row(1, 0, 'sylra', {
    level: 11,
    kills: 4,
    deaths: 2,
    assists: 5,
    cs: 90,
    items: ['iron_blade', 'spark_rod'],
  }),
  row(2, 0, 'torv'),
  row(3, 0, 'fenn'),
  row(4, 0, 'dain'),
  row(5, 0, 'vesk'),
  row(6, 1, 'korrath', { kills: 6, deaths: 1 }),
  row(7, 1, 'elowen'),
  row(8, 1, 'maera'),
  row(9, 1, 'rhoka'),
  row(10, 1, 'ashvyn'),
];

const base = {
  rows,
  selfId: 1,
  selfTeam: 0 as const,
  seconds: 15 * 60 + 20,
  forged: false,
  touch: false,
  signedIn: false,
};

describe('building the report', () => {
  it('reads the result off the winner and marks the one seat that was the person', () => {
    expect(practiceResult(0, 0)).toBe('won');
    expect(practiceResult(1, 0)).toBe('lost');
    expect(practiceResult(null, 0)).toBe('left');
    const r = buildPracticeReport({ ...base, winner: 1 });
    expect(r.v).toBe(1);
    expect(r.result).toBe('lost');
    expect(r.seconds).toBe(920);
    expect(r.rows).toHaveLength(10);
    expect(r.rows.filter((x) => x.self).map((x) => x.championId)).toEqual(['sylra']);
    expect(r.rows[0]).toEqual({
      championId: 'sylra',
      team: 0,
      self: true,
      level: 11,
      kills: 4,
      deaths: 2,
      assists: 5,
      cs: 90,
      items: ['iron_blade', 'spark_rod'],
    });
    // Nothing that names anyone rides along.
    expect(JSON.stringify(r)).not.toContain('player');
    expect(JSON.stringify(r)).not.toContain('name');
  });

  it('posts it with keepalive and swallows the answer', async () => {
    const post = vi.fn(() => Promise.reject(new Error('down')));
    const r = buildPracticeReport({ ...base, winner: 0 });
    sendPracticeReport(r, post as unknown as typeof fetch);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(PRACTICE_REPORT_ROUTE);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual(r);
    await Promise.resolve();
  });
});

describe('the server side', () => {
  const good = buildPracticeReport({ ...base, winner: 0 });

  it('takes a report a match could have written, and nothing else', () => {
    expect(parsePracticeReport(good)).toEqual(good);
    expect(parsePracticeReport(null)).toBeNull();
    expect(parsePracticeReport({ ...good, v: 2 })).toBeNull();
    expect(parsePracticeReport({ ...good, result: 'drew' })).toBeNull();
    expect(parsePracticeReport({ ...good, seconds: -1 })).toBeNull();
    expect(parsePracticeReport({ ...good, seconds: 1e9 })).toBeNull();
    expect(parsePracticeReport({ ...good, touch: 'yes' })).toBeNull();
    expect(parsePracticeReport({ ...good, rows: [] })).toBeNull();
    expect(parsePracticeReport({ ...good, rows: [...good.rows, ...good.rows] })).toBeNull();
    // Two seats claiming to be the person, or none: no report.
    const twoSelves = good.rows.map((x, i) => ({ ...x, self: i < 2 }));
    expect(parsePracticeReport({ ...good, rows: twoSelves })).toBeNull();
    const noSelf = good.rows.map((x) => ({ ...x, self: false }));
    expect(parsePracticeReport({ ...good, rows: noSelf })).toBeNull();
    // A row that is not a scoreboard row.
    const bad = [...good.rows];
    bad[3] = { ...bad[3]!, championId: 'not a champion id!' };
    expect(parsePracticeReport({ ...good, rows: bad })).toBeNull();
    const hugeKills = [...good.rows];
    hugeKills[0] = { ...hugeKills[0]!, kills: 10_000 };
    expect(parsePracticeReport({ ...good, rows: hugeKills })).toBeNull();
    const manyItems = [...good.rows];
    manyItems[0] = { ...manyItems[0]!, items: Array(7).fill('iron_blade') };
    expect(parsePracticeReport({ ...good, rows: manyItems })).toBeNull();
  });

  it('keeps nothing a report did not say', () => {
    const parsed = parsePracticeReport({ ...good, name: 'somebody', ip: '1.2.3.4' });
    expect(parsed).toEqual(good);
    expect(Object.keys(parsed as object)).not.toContain('name');
  });

  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('appends one line per report and reads them back, skipping a torn line', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'practice-'));
    const file = path.join(dir, 'data', 'practice.jsonl');
    const store = new PracticeReportStore(file);
    store.append(good, 1000);
    store.append({ ...good, result: 'left', seconds: 90 }, 2000);
    const text = readFileSync(file, 'utf8');
    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
    writeFileSync(file, `${text}{"at": 3000, "v": 1, "res`);
    const all = store.readAll();
    expect(all.map((r) => [r.at, r.result])).toEqual([
      [1000, 'won'],
      [2000, 'left'],
    ]);
    expect(new PracticeReportStore(path.join(dir, 'missing.jsonl')).readAll()).toEqual([]);
    expect(readPracticeLines('')).toEqual([]);
    // The reader is the script's too, with the day window.
    expect(loadPracticeReports(path.join(dir, 'data'))).toHaveLength(2);
    expect(loadPracticeReports(path.join(dir, 'data'), 30)).toHaveLength(0);
    expect(loadPracticeReports(path.join(dir, 'nowhere'))).toEqual([]);
  });
});

describe('what the reports say', () => {
  const stored = (over: Partial<PracticeReport> & { at?: number }): StoredPracticeReport => ({
    at: over.at ?? 0,
    ...buildPracticeReport({ ...base, winner: 0 }),
    ...over,
  });
  const reports: StoredPracticeReport[] = [
    stored({ result: 'won', seconds: 20 * 60 }),
    stored({ result: 'lost', seconds: 16 * 60, touch: true }),
    stored({
      result: 'left',
      seconds: 3 * 60,
      signedIn: true,
      rows: rows.map((x) => ({
        ...x,
        self: x.unitId === 1,
        deaths: x.unitId === 1 ? 4 : 0,
        level: 3,
      })),
    }),
    stored({
      result: 'won',
      seconds: 10 * 60,
      forged: true,
      rows: rows.map((x) => ({
        ...x,
        self: x.unitId === 1,
        championId: x.unitId === 1 ? 'forged_abc' : x.championId,
      })),
    }),
  ];

  it('tallies results, minutes, device, account and the champion played', () => {
    const s = summarizePractice(reports);
    expect(s.all).toEqual({ n: 4, won: 2, lost: 1, left: 1 });
    expect(s.minutes).toEqual({ all: 16, finished: 16, left: 3 });
    expect(s.touch.n).toBe(1);
    expect(s.mouse.n).toBe(3);
    expect(s.visitor.n).toBe(3);
    expect(s.account).toEqual({ n: 1, won: 0, lost: 0, left: 1 });
    expect(s.champions.map((c) => c.championId)).toEqual(['sylra', 'forged']);
    const sylra = s.champions[0]!;
    expect(sylra.n).toBe(3);
    expect(sylra.won).toBe(1);
    expect(sylra.left).toBe(1);
    expect(sylra.kills).toBe(4);
    expect(sylra.deaths).toBe(round1((2 + 2 + 4) / 3));
    expect(sylra.minutes).toBe(16);
  });

  it('puts the person beside the bots per ten minutes, and names where people leave', () => {
    const s = summarizePractice(reports);
    // The person: 4 + 4 + 4 + 4 kills over 49 minutes.
    expect(s.rates.self.kills).toBe(round1((16 / 49) * 10));
    // Ally bots: four seats, 2 kills each per match, over 4 x 49 minutes.
    expect(s.rates.allies.kills).toBe(round1((32 / 196) * 10));
    // Enemy bots: 13 deaths a match but the one left early (none), over
    // five seats and 49 minutes.
    expect(s.rates.enemies.deaths).toBe(round1((39 / 245) * 10));
    const gone = s.leaving.find((l) => l.n > 0);
    expect(gone?.bucket).toBe('2 to 5 min');
    expect(gone?.deaths).toBe(4);
    expect(gone?.level).toBe(3);
    expect(s.killers[0]).toEqual({ championId: 'korrath', n: 4, kills: 6 });
  });

  it('prints one page', () => {
    const text = formatPracticeSummary(summarizePractice(reports));
    expect(text).toContain('Practice matches: 4 played, won 50%, lost 25%, left 25%');
    expect(text).toContain('sylra');
    expect(text).toContain('forged');
    expect(text).toContain('the enemy bots:');
    expect(text).toContain('2 to 5 min');
    expect(text).toContain('korrath');
    expect(text).not.toContain('undefined');
  });
});

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
