// Pointer picking gate: generous radius, enemies only, fog respected,
// champions win over structures, invulnerable structures unpickable.

import { describe, expect, it } from 'vitest';
import { pickEnemyAt } from '../src/game/picking';
import { Sim } from '../src/sim/sim';

describe('pickEnemyAt', () => {
  it('picks a visible enemy champion within the slop radius', () => {
    const sim = new Sim(3);
    const enemy = sim.addChampion(1, { x: 75, z: 75 });
    sim.addChampion(0, { x: 72, z: 75 });
    sim.tick();
    expect(pickEnemyAt(sim, { x: 76.2, z: 75 }, 0)?.id).toBe(enemy.id);
  });

  it('never picks an enemy hidden by the fog of war', () => {
    const sim = new Sim(3);
    const enemy = sim.addChampion(1, { x: 75, z: 75 });
    sim.tick();
    expect(pickEnemyAt(sim, { x: enemy.pos.x, z: enemy.pos.z }, 0)).toBeNull();
  });

  it('ignores clicks too far away and allies anywhere', () => {
    const sim = new Sim(3);
    sim.addChampion(1, { x: 75, z: 75 });
    const ally = sim.addChampion(0, { x: 72, z: 75 });
    sim.tick();
    expect(pickEnemyAt(sim, { x: 80, z: 75 }, 0)).toBeNull();
    expect(pickEnemyAt(sim, { x: ally.pos.x, z: ally.pos.z }, 0)).toBeNull();
  });

  it('picks vulnerable enemy towers, prefers a champion standing on one', () => {
    const sim = new Sim(3);
    // Team 1's OUTER mid tower (vulnerable) stands at (93, 93).
    const towerPick = pickEnemyAt(sim, { x: 93, z: 93 }, 0);
    expect(towerPick?.kind).toBe('tower');
    const champ = sim.addChampion(1, { x: 93.8, z: 93 });
    sim.addChampion(0, { x: 90, z: 93 });
    sim.tick();
    expect(pickEnemyAt(sim, { x: 93, z: 93 }, 0)?.id).toBe(champ.id);
  });

  it('never picks an invulnerable structure', () => {
    const sim = new Sim(3);
    // Team 1's INNER mid tower at (114, 114) is protected by the outer one.
    expect(pickEnemyAt(sim, { x: 114, z: 114 }, 0)).toBeNull();
  });
});
