// The match log is appended to forever and read whole at every boot, so
// today's readers meet every line an older server wrote. These write the
// record in each shape it has had to a file, read it back the way the
// server does, and run it through every reader of the log: the career,
// the laurel backfill, the ladders' way stats and the night coach.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backfillLaurels, FIRST_WIN_BONUS, MATCH_LAURELS, WIN_LAURELS } from '../server/laurels';
import { botMatchesSince } from '../server/night_coach';
import { buildProfile } from '../server/profile';
import type { MatchRecord } from '../server/records';
import { readJsonl } from '../server/store';
import { wayStatsOf } from '../server/way_stats';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 7, 27, 12);

const seat = (id: Record<string, number | null>, team: 0 | 1, championId: string) => ({
  ...id,
  name: 'Seat',
  championId,
  team,
  level: 9,
  kills: 3,
  deaths: 2,
  assists: 4,
  cs: 50,
});

// One line per shape the record has had, oldest first, as written.
const LINES: unknown[] = [
  // The first match log: the seat named its owner playerId, no rating.
  {
    at: T0,
    durationS: 900,
    winner: 0,
    players: [seat({ playerId: 7 }, 0, 'fenn'), seat({ playerId: null }, 1, 'fenn')],
  },
  // Ratings: rated and the movement, still under playerId.
  {
    at: T0 + 1000,
    durationS: 900,
    winner: 0,
    rated: true,
    players: [
      { ...seat({ playerId: 7 }, 0, 'fenn'), ratingDelta: 12 },
      { ...seat({ playerId: 8 }, 1, 'fenn'), ratingDelta: -12 },
    ],
  },
  // accountId, rated, and nothing after: no queue, replay, way or build.
  {
    at: T0 + 2 * DAY,
    durationS: 900,
    winner: 0,
    rated: true,
    players: [
      { ...seat({ accountId: 7 }, 0, 'fenn'), ratingDelta: 10 },
      { ...seat({ accountId: 8 }, 1, 'fenn'), ratingDelta: -10 },
    ],
  },
  // The same day, unrated, an old line with no movement.
  {
    at: T0 + 2 * DAY + 1000,
    durationS: 600,
    winner: 1,
    rated: false,
    players: [seat({ accountId: 7 }, 0, 'fenn'), seat({ accountId: null }, 1, 'fenn')],
  },
  // Today's shape: a replay, a bot seat in the Arena, a build.
  {
    at: T0 + 3 * DAY,
    durationS: 700,
    winner: 1,
    rated: true,
    queue: 'arena',
    replayId: 41,
    players: [
      { ...seat({ accountId: 7 }, 0, 'fenn'), ratingDelta: -8, way: 'bot', items: ['a'] },
      { ...seat({ accountId: 9 }, 1, 'fenn'), ratingDelta: 8, way: 'bot', items: ['b'] },
    ],
  },
];

function readLog(): MatchRecord[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'loc-matchlog-'));
  dirs.push(dir);
  const file = path.join(dir, 'matches.jsonl');
  // A torn last line, as a crash mid-append leaves it.
  writeFileSync(file, `${LINES.map((l) => JSON.stringify(l)).join('\n')}\n{"at":17`);
  return readJsonl<MatchRecord>(file);
}

describe('a match log written by older servers', () => {
  it('reads every whole line and drops only the torn one', () => {
    expect(readLog()).toHaveLength(LINES.length);
  });

  it('builds the career from the lines that name an account', () => {
    const p = buildProfile(readLog(), 7);
    // The two accountId lines by hand; the playerId lines name nobody
    // (the field was renamed once, before accounts), the Arena seat is a bot's.
    expect(p.games).toBe(2);
    expect(p.wins).toBe(1);
    expect(p.kills).toBe(6);
    expect(p.perChampion).toEqual([expect.objectContaining({ championId: 'fenn', games: 2 })]);
    expect(p.recent.map((r) => r.ratingDelta)).toEqual([undefined, 10]);
    expect(p.recent.every((r) => r.replayId === undefined)).toBe(true);
  });

  it('backfills laurels once per hand seat, a missing rated as unrated', () => {
    const b = backfillLaurels(readLog(), 7);
    expect(b.laurels).toBe(WIN_LAURELS + FIRST_WIN_BONUS + MATCH_LAURELS);
    expect(b.lastWinDay).toBe(Math.floor((T0 + 2 * DAY) / DAY));
    // A seat of the oldest shape earns nobody anything and throws nothing.
    expect(backfillLaurels(readLog(), 8).laurels).toBe(MATCH_LAURELS);
  });

  it('counts the ladders only where a rating moved, on its own way', () => {
    const log = readLog();
    const hand = wayStatsOf(log, 'hand');
    expect([...hand.keys()].sort()).toEqual([7, 8]);
    expect(hand.get(7)).toMatchObject({ games: 1, wins: 1, losses: 0, form: ['W'] });
    expect(hand.get(8)).toMatchObject({ games: 1, wins: 0, losses: 1 });
    const arena = wayStatsOf(log, 'arena');
    expect([...arena.keys()].sort()).toEqual([7, 9]);
    expect(wayStatsOf(log, 'forge').size).toBe(0);
  });

  it('hands the night coach only the Arena lines', () => {
    const m = botMatchesSince(readLog(), 7, 0);
    expect(m).toEqual([{ at: T0 + 3 * DAY, win: false, delta: -8, replayId: 41, matchId: 41 }]);
  });
});
