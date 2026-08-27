// Mastery: cosmetic ranks from games played, stamped onto profile lines.

import { describe, expect, it } from 'vitest';
import { MASTERY_THRESHOLDS, masteryRank, masteryTitle } from '../server/mastery';
import { buildProfile } from '../server/profile';
import type { MatchRecord } from '../server/records';

describe('champion mastery', () => {
  it('ranks up exactly at each threshold', () => {
    expect(masteryRank(0)).toBe(0);
    MASTERY_THRESHOLDS.forEach((need, i) => {
      expect(masteryRank(need - 1)).toBe(i);
      expect(masteryRank(need)).toBe(i + 1);
    });
    expect(masteryRank(999)).toBe(MASTERY_THRESHOLDS.length);
  });

  it('titles every rank and clamps junk', () => {
    expect(masteryTitle(0)).toBe('Unranked');
    expect(masteryTitle(1)).toBe('Novice');
    expect(masteryTitle(6)).toBe('Legend');
    expect(masteryTitle(-3)).toBe('Unranked');
    expect(masteryTitle(99)).toBe('Legend');
  });

  it('is stamped on profile champion lines from games played', () => {
    const records: MatchRecord[] = [];
    for (let i = 0; i < 3; i++) {
      records.push({
        at: i,
        durationS: 600,
        winner: 0,
        rated: false,
        players: [
          {
            playerId: 7,
            name: 'bob',
            championId: 'fenn',
            team: 0,
            level: 10,
            kills: 0,
            deaths: 0,
            assists: 0,
            cs: 0,
          },
        ],
      });
    }
    const p = buildProfile(records, 7);
    expect(p.perChampion[0]).toMatchObject({
      championId: 'fenn',
      mastery: 2,
      masteryTitle: 'Adept',
    });
  });
});
