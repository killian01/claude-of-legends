// A bot's Record added up per kind (server/record_tally.ts): the sparring
// it did against house bots, the series against its own previous version
// and the rated matches it played never share a number.

import { describe, expect, it } from 'vitest';
import { talliesOf } from '../server/record_tally';
import type { RecordKind, RecordRow } from '../src/net/record';

const row = (
  kind: RecordKind,
  winner: 0 | 1 | null,
  kda: [number, number, number] = [0, 0, 0],
  team: 0 | 1 = 0,
): RecordRow => ({
  id: 1,
  kind,
  at: 1000,
  seed: 1,
  team,
  winner,
  ticks: 100,
  version: 1,
  edited: false,
  botUnitId: 3,
  line: {
    unitId: 3,
    name: 'Vesk',
    player: null,
    championId: 'vesk',
    team,
    level: 10,
    kills: kda[0],
    deaths: kda[1],
    assists: kda[2],
    cs: 0,
    items: [],
  },
  replayId: null,
});

describe('a Record read per kind', () => {
  it('keeps every kind apart and sums the rated ones', () => {
    const t = talliesOf([
      row('arena', 0, [5, 1, 2]),
      row('arena', 1, [1, 4, 0]),
      row('live', 0, [3, 2, 6]),
      row('sparring', 0, [9, 0, 1]),
      row('sparring', 1, [0, 7, 0]),
      row('series', 0, [2, 2, 2]),
    ]);
    expect(t.arena).toEqual({ games: 2, wins: 1, losses: 1, kills: 6, deaths: 5, assists: 2 });
    expect(t.live).toEqual({ games: 1, wins: 1, losses: 0, kills: 3, deaths: 2, assists: 6 });
    expect(t.sparring).toEqual({ games: 2, wins: 1, losses: 1, kills: 9, deaths: 7, assists: 1 });
    expect(t.series).toEqual({ games: 1, wins: 1, losses: 0, kills: 2, deaths: 2, assists: 2 });
    // Rated is the Arena and the live seats, and nothing else.
    expect(t.rated).toEqual({ games: 3, wins: 2, losses: 1, kills: 9, deaths: 7, assists: 8 });
  });

  it('counts a match nobody won as a game and as neither result', () => {
    const t = talliesOf([row('arena', null, [1, 1, 1]), row('arena', 0, [2, 0, 0])]);
    expect(t.rated).toMatchObject({ games: 2, wins: 1, losses: 0, kills: 3 });
  });

  it('reads the result from the seat the bot held, not from team zero', () => {
    const t = talliesOf([row('arena', 1, [0, 0, 0], 1), row('arena', 0, [0, 0, 0], 1)]);
    expect(t.rated).toMatchObject({ games: 2, wins: 1, losses: 1 });
  });

  it('survives a row whose line never arrived, and an empty Record', () => {
    const missing = { ...row('sparring', 0, [4, 4, 4]), line: null };
    const t = talliesOf([missing]);
    expect(t.sparring).toEqual({ games: 1, wins: 1, losses: 0, kills: 0, deaths: 0, assists: 0 });
    const none = talliesOf([]);
    for (const key of ['rated', 'arena', 'live', 'sparring', 'series'] as const) {
      expect(none[key]).toEqual({ games: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0 });
    }
  });
});
