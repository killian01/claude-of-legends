// Sim.isPointVisible for many points at one moment (vision.ts pointSight,
// what the camp sightings ask every tick for every team): the same answer
// for every team and every point as asking the sim one point at a time, on
// the planet's fifty teams through a battle royale and on the 5v5's two.

import { describe, expect, it } from 'vitest';
import { buildRoyaleSim, type ReplayPick } from '../src/net/replay';
import { royaleHouseChampions } from '../src/sim/royale/fill';
import { Sim } from '../src/sim/sim';
import type { Vec2 } from '../src/sim/types';
import { pointSight } from '../src/sim/vision';
import { loadPlanet } from './royale_planet';

// Every place worth asking about: each unit, flying projectile and zone.
function places(sim: Sim): Vec2[] {
  const out: Vec2[] = [];
  for (const u of sim.units.values()) out.push(u.pos);
  for (const p of sim.projectiles.values()) out.push(p.pos);
  for (const z of sim.zones.values()) out.push(z.pos);
  return out;
}

function compare(sim: Sim): { seen: number; unseen: number; wrong: number } {
  const sight = pointSight(sim.map, sim.units, sim.time);
  let seen = 0;
  let unseen = 0;
  let wrong = 0;
  for (let team = 0; team < sim.teamCount; team++) {
    for (const p of places(sim)) {
      const want = sim.isPointVisible(team, p.x, p.z, p.y);
      if (sight(team, p.x, p.z, p.y) !== want) wrong += 1;
      if (want) seen += 1;
      else unseen += 1;
    }
  }
  return { seen, unseen, wrong };
}

describe('a moment of point sight', () => {
  it('answers as the sim does, every team and place, through a battle royale', () => {
    const seed = 3;
    const picks: ReplayPick[] = royaleHouseChampions(seed, 50).map((championId, i) => ({
      name: `house${i}`,
      team: i,
      championId,
      sigils: ['riftstep', 'mend'],
      bot: 'royale',
    }));
    const { sim } = buildRoyaleSim(loadPlanet(), seed, picks, 'respawn');
    let seen = 0;
    let unseen = 0;
    for (let t = 1; t <= 2400; t++) {
      sim.tick();
      if (t % 200 !== 0) continue;
      const r = compare(sim);
      expect(r.wrong).toBe(0);
      seen += r.seen;
      unseen += r.unseen;
    }
    expect(seen).toBeGreaterThan(0);
    expect(unseen).toBeGreaterThan(seen);
  });

  it('answers as the sim does on the 5v5', () => {
    const sim = new Sim(11);
    for (let k = 0; k < 2; k++) {
      sim.addChampion(0);
      sim.addChampion(1);
    }
    let seen = 0;
    let unseen = 0;
    for (let t = 1; t <= 1200; t++) {
      sim.tick();
      if (t % 100 !== 0) continue;
      const r = compare(sim);
      expect(r.wrong).toBe(0);
      seen += r.seen;
      unseen += r.unseen;
    }
    expect(seen).toBeGreaterThan(0);
    expect(unseen).toBeGreaterThan(0);
  });
});
