// A bot's own Record read as one bot way (server/bot_way_stats.ts): the
// rated games only, the form newest first, and nothing from the other way
// or from the sparring behind it.

import { describe, expect, it } from 'vitest';
import { botWayStats, kindOfWay } from '../server/bot_way_stats';
import { FORM_CAP } from '../server/way_stats';
import type { RecordKind, RecordRow } from '../src/net/record';

const row = (
  kind: RecordKind,
  at: number,
  winner: 0 | 1 | null,
  rated = true,
  team: 0 | 1 = 0,
): RecordRow => ({
  id: at,
  kind,
  at,
  seed: 1,
  team,
  winner,
  ticks: 100,
  version: 1,
  edited: false,
  botUnitId: 3,
  line: null,
  replayId: null,
  ...(rated ? { ratingDelta: winner === team ? 3 : -3 } : {}),
});

describe('a bot read on one way', () => {
  it('names the Record kind each way is recorded as', () => {
    expect(kindOfWay('arena')).toBe('arena');
    expect(kindOfWay('bot')).toBe('live');
    expect(kindOfWay('hand')).toBeNull();
    expect(kindOfWay('forge')).toBeNull();
  });

  it('counts the rated matches of its way, newest first', () => {
    const rows = [
      row('arena', 100, 0),
      row('arena', 300, 1),
      row('arena', 200, 0),
      // Another way, unrated play, and sparring: none of it counts here.
      row('live', 400, 0),
      row('arena', 500, 0, false),
      row('sparring', 600, 0),
    ];
    const t = botWayStats(rows, 'arena', 'vesk');
    expect(t).toMatchObject({ games: 3, wins: 2, losses: 1, lastAt: 300 });
    expect(t.form).toEqual(['L', 'W', 'W']);
    // A bot plays one champion, so its favorite is never in doubt.
    expect([...t.champions]).toEqual([['vesk', 3]]);
    expect(botWayStats(rows, 'bot', 'vesk')).toMatchObject({ games: 1, wins: 1, lastAt: 400 });
  });

  it('reads the result from the side the bot held', () => {
    const t = botWayStats(
      [row('arena', 10, 1, true, 1), row('arena', 20, 0, true, 1)],
      'arena',
      'fenn',
    );
    expect(t).toMatchObject({ games: 2, wins: 1, losses: 1 });
  });

  it('caps the form and answers empty for a way the bot never plays', () => {
    const many = Array.from({ length: FORM_CAP + 4 }, (_, i) => row('arena', 100 + i, 0));
    expect(botWayStats(many, 'arena', 'vesk').form).toHaveLength(FORM_CAP);
    const none = botWayStats(many, 'hand', 'vesk');
    expect(none).toMatchObject({ games: 0, wins: 0, losses: 0, lastAt: 0 });
    expect([...none.champions]).toEqual([]);
  });
});
