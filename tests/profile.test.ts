// Match records and the career stats derived from them.

import { describe, expect, it } from 'vitest';
import { buildProfile, RECENT_CAP } from '../server/profile';
import { buildMatchRecord, type MatchRecord } from '../server/records';
import type { ScoreRow } from '../src/sim/types';

const row = (over: Partial<ScoreRow>): ScoreRow => ({
  unitId: 1,
  name: 'x',
  championId: 'sylra',
  team: 0,
  level: 10,
  kills: 0,
  deaths: 0,
  assists: 0,
  cs: 0,
  ...over,
});

describe('match records', () => {
  it('tags human seats with their player id and bots with null', () => {
    const rows = [
      row({ unitId: 1, name: 'bob', championId: 'fenn', kills: 5, assists: 2, cs: 41 }),
      row({ unitId: 2, name: 'Korrath (bot)', championId: 'korrath', team: 1 }),
    ];
    const rec = buildMatchRecord(rows, new Map([[1, 7]]), 0, 903.6, 1000);
    expect(rec).toMatchObject({ at: 1000, durationS: 904, winner: 0, rated: false });
    expect(rec.players[0]).toMatchObject({ playerId: 7, championId: 'fenn', kills: 5, cs: 41 });
    expect(rec.players[0]!.ratingDelta).toBeUndefined();
    expect(rec.players[1]).toMatchObject({ playerId: null, team: 1 });
  });

  it('embeds rating deltas on rated human seats only', () => {
    const rows = [
      row({ unitId: 1, name: 'bob', kills: 1 }),
      row({ unitId: 2, name: 'ana', team: 1 }),
      row({ unitId: 3, name: 'Vesk (bot)', team: 1 }),
    ];
    const rec = buildMatchRecord(
      rows,
      new Map([
        [1, 7],
        [2, 8],
      ]),
      0,
      600,
      1000,
      {
        rated: true,
        deltas: new Map([
          [7, 3],
          [8, -3],
        ]),
      },
    );
    expect(rec.rated).toBe(true);
    expect(rec.players[0]).toMatchObject({ playerId: 7, ratingDelta: 3 });
    expect(rec.players[1]).toMatchObject({ playerId: 8, ratingDelta: -3 });
    expect(rec.players[2]!.ratingDelta).toBeUndefined();
  });
});

const rec = (at: number, winner: 0 | 1, mine: Partial<MatchRecord['players'][0]>): MatchRecord => ({
  at,
  durationS: 600,
  winner,
  rated: false,
  players: [
    {
      playerId: 7,
      name: 'bob',
      championId: 'fenn',
      team: 0,
      level: 10,
      kills: 1,
      deaths: 2,
      assists: 3,
      cs: 10,
      ...mine,
    },
    {
      playerId: null,
      name: 'Sylra (bot)',
      championId: 'sylra',
      team: 1,
      level: 10,
      kills: 0,
      deaths: 0,
      assists: 0,
      cs: 0,
    },
  ],
});

describe('career profile', () => {
  it('aggregates games, winrate, and per-champion lines', () => {
    const records = [
      rec(100, 0, { championId: 'fenn', kills: 5 }),
      rec(200, 1, { championId: 'fenn' }),
      rec(300, 0, { championId: 'vesk', kills: 2 }),
    ];
    const p = buildProfile(records, 7);
    expect(p.games).toBe(3);
    expect(p.wins).toBe(2);
    expect(p.kills).toBe(8);
    expect(p.perChampion[0]).toMatchObject({ championId: 'fenn', games: 2, wins: 1, kills: 6 });
    expect(p.perChampion[1]).toMatchObject({ championId: 'vesk', games: 1, wins: 1 });
    // Recent is newest first.
    expect(p.recent.map((r) => r.at)).toEqual([300, 200, 100]);
    expect(p.recent[0]).toMatchObject({ win: true, championId: 'vesk' });
  });

  it('carries rating deltas through to recent matches', () => {
    const p = buildProfile([rec(100, 0, { ratingDelta: 12 })], 7);
    expect(p.recent[0]!.ratingDelta).toBe(12);
    const q = buildProfile([rec(100, 0, {})], 7);
    expect(q.recent[0]!.ratingDelta).toBeUndefined();
  });

  it('ignores matches the player was not in and caps the recent list', () => {
    const records: MatchRecord[] = [];
    for (let i = 0; i < RECENT_CAP + 5; i++) records.push(rec(i, 0, {}));
    records.push({ ...rec(999, 0, {}), players: [] });
    const p = buildProfile(records, 7);
    expect(p.games).toBe(RECENT_CAP + 5);
    expect(p.recent).toHaveLength(RECENT_CAP);
    const q = buildProfile(records, 999);
    expect(q.games).toBe(0);
    expect(q.recent).toEqual([]);
  });
});
