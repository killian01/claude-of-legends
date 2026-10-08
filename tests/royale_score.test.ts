// Scores and places (src/sim/royale/score.ts): the leader by takedowns,
// fewer deaths then the lower id; the
// places of One life, champions falling on one tick ordered by the health
// they had on the tick before; and the light a Respawn return comes back
// in while the Dusk closes (returnCap).

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import { RoyaleMatch } from '../server/royale_match';
import { DUSK_PHASES } from '../src/sim/content/dusk';
import { insideCap } from '../src/sim/royale/dusk';
import {
  compareStanding,
  leaderOf,
  oneLifeRanking,
  placeFallen,
  respawnRanking,
  returnCap,
} from '../src/sim/royale/score';
import { DROP_S, type DuskCap } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { loadPlanet } from './royale_planet';

describe('Respawn scores', () => {
  it('names the leader by takedowns, then fewer deaths, then the lower id', () => {
    expect(leaderOf([])).toBeNull();
    expect(leaderOf([{ id: 1, score: 0, deaths: 0 }])).toBeNull();
    const rows = [
      { id: 7, score: 3, deaths: 2 },
      { id: 4, score: 3, deaths: 1 },
      { id: 2, score: 3, deaths: 1 },
      { id: 9, score: 1, deaths: 0 },
    ];
    expect(leaderOf(rows)).toBe(2);
    expect(respawnRanking(rows)).toEqual([2, 4, 7, 9]);
    expect(compareStanding(rows[0]!, rows[3]!)).toBeLessThan(0);
  });
});

describe('One life places', () => {
  it('places the fallen of one tick by their health the tick before', () => {
    expect(
      placeFallen(
        [
          { id: 3, hpBefore: 50 },
          { id: 8, hpBefore: 20 },
          { id: 5, hpBefore: 50 },
        ],
        10,
      ),
    ).toEqual([
      { id: 8, place: 10 },
      { id: 5, place: 9 },
      { id: 3, place: 8 },
    ]);
    // The last two falling together: the healthier one wins.
    expect(
      placeFallen(
        [
          { id: 1, hpBefore: 30 },
          { id: 2, hpBefore: 31 },
        ],
        2,
      ),
    ).toEqual([
      { id: 1, place: 2 },
      { id: 2, place: 1 },
    ]);
  });

  it('ranks the winner first, then the last out to the first', () => {
    expect(oneLifeRanking(4, [9, 2, 7])).toEqual([4, 7, 2, 9]);
    expect(oneLifeRanking(7, [9, 2, 7])).toEqual([7, 2, 9]);
    expect(oneLifeRanking(null, [1, 2])).toEqual([2, 1]);
  });
});

describe('the light a return comes back in', () => {
  const now: DuskCap = { center: { x: 80, y: 0, z: 0 }, radius: 120 };
  const next: DuskCap = { center: { x: 79, y: 5, z: 0 }, radius: 100 };

  it('is the cap the Dusk closes to while it closes, the light now while it holds', () => {
    expect(returnCap({ now, next, shrinking: true })).toBe(next);
    expect(returnCap({ now, next, shrinking: false })).toBe(now);
    expect(returnCap({ now, next: null, shrinking: true })).toBe(now);
  });

  it('brings a Respawn return inside the cap the light closes to, for a bot as for a person', () => {
    const person = {
      clientId: 1,
      owner: 1,
      name: 'p1',
      guest: true,
      pick: { championId: 'dain', sigils: ['riftstep', 'mend'] as [string, string], skin: 0 },
    };
    const match = new RoyaleMatch(1, 11, 'respawn', [person], royaleFactory(loadPlanet), 12);
    const sim = match.sim as unknown as Sim;
    const mode = sim.royaleMode!;
    // A closing phase: the light now still far wider than the one it closes to.
    while (sim.time < DROP_S + DUSK_PHASES[0]!.closeFrom + 30) match.tick();
    const self = sim.units.get(match.players.get(1)!.unitId)!;
    const bot = [...sim.units.values()].find(
      (u) => u.kind === 'champion' && !u.dead && sim.policies.has(u.id),
    )!;
    for (const u of [self, bot]) {
      u.dead = true;
      u.hp = 0;
      u.respawnAt = sim.time;
    }
    match.tick();
    const d = mode.state.dusk;
    expect(d.shrinking).toBe(true);
    expect(d.now.radius).toBeGreaterThan(d.next!.radius + 20);
    for (const u of [self, bot]) {
      expect(u.dead).toBe(false);
      expect(insideCap(d.next!, u.pos as { x: number; y: number; z: number })).toBe(true);
    }
  });
});
