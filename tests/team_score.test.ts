// The top-of-screen team kill totals. The sum is the whole contract: a
// takedown counted for the wrong side, or an assist counted as a kill,
// would show the match as closer or further apart than it is.

import { describe, expect, it } from 'vitest';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { Sim } from '../src/sim/sim';
import type { ScoreRow } from '../src/sim/types';
import { teamKills } from '../src/ui/team_score';

const row = (team: 0 | 1, kills: number, assists = 0): ScoreRow => ({
  unitId: 1,
  name: 'X',
  championId: 'x',
  player: null,
  team,
  level: 1,
  kills,
  deaths: 0,
  assists,
  cs: 0,
  items: [],
});

describe('the team kill score', () => {
  it('starts at nothing to nothing', () => {
    expect(teamKills([])).toEqual([0, 0]);
  });

  it('sums each side and counts kills only, never assists', () => {
    expect(teamKills([row(0, 3, 9), row(0, 2), row(1, 4), row(1, 0, 5), row(1, 1)])).toEqual([
      5, 5,
    ]);
  });

  it('matches the scoreboard the sim reports in a real match', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 }, CHAMPION_LIST[0]!.id);
    const b = sim.addChampion(1, { x: 78, z: 75 }, CHAMPION_LIST[1]!.id);
    b.hp = 1;
    sim.orderAttack(a.id, b.id);
    for (let i = 0; i < 100 && !b.dead; i++) sim.tick();
    expect(b.dead).toBe(true);
    const rows = sim.scoreboard();
    expect(teamKills(rows)).toEqual([1, 0]);
    // And it stays the sum of the rows, whatever the roster size.
    const byHand = rows.reduce<[number, number]>(
      (acc, r) => {
        acc[r.team] += r.kills;
        return acc;
      },
      [0, 0],
    );
    expect(teamKills(rows)).toEqual(byHand);
  });
});
