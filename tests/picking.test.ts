// Pointer picking gate: generous radius, enemies only, champions win over
// structures.

import { describe, expect, it } from 'vitest';
import { pickEnemyAt } from '../src/game/picking';
import { Sim } from '../src/sim/sim';

describe('pickEnemyAt', () => {
  it('picks an enemy champion within the slop radius', () => {
    const sim = new Sim(3);
    const enemy = sim.addChampion(1, { x: 75, z: 75 });
    expect(pickEnemyAt(sim, { x: 76.2, z: 75 }, 0)?.id).toBe(enemy.id);
  });

  it('ignores clicks too far away and allies anywhere', () => {
    const sim = new Sim(3);
    sim.addChampion(1, { x: 75, z: 75 });
    const ally = sim.addChampion(0, { x: 80, z: 80 });
    expect(pickEnemyAt(sim, { x: 80, z: 75 }, 0)).toBeNull();
    expect(pickEnemyAt(sim, { x: ally.pos.x, z: ally.pos.z }, 0)).toBeNull();
  });

  it('picks enemy towers, and prefers a champion standing on one', () => {
    const sim = new Sim(3);
    // Team 1's mirrored inner mid tower stands at (114, 114).
    const towerPick = pickEnemyAt(sim, { x: 114, z: 114 }, 0);
    expect(towerPick?.kind).toBe('tower');
    const champ = sim.addChampion(1, { x: 114.8, z: 114 });
    expect(pickEnemyAt(sim, { x: 114, z: 114 }, 0)?.id).toBe(champ.id);
  });
});
