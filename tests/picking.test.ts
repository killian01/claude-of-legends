// Pointer picking gate: generous radius, enemies only, fog respected,
// champions win over structures, invulnerable structures unpickable. The
// screen-space picker adds pixel slop around projected bodies and lets a
// direct body hit beat a nearby unit's slop.

import { describe, expect, it } from 'vitest';
import { pickEnemyAt, pickEnemyOnScreen } from '../src/game/picking';
import { Sim } from '../src/sim/sim';

// A fixed top-down orthographic projector for tests: 10 px per world unit.
const project = (x: number, _y: number, z: number): { x: number; y: number } => ({
  x: x * 10,
  y: z * 10,
});

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

describe('pickEnemyOnScreen', () => {
  it('picks a visible enemy within pixel slop of its projected body', () => {
    const sim = new Sim(3);
    const enemy = sim.addChampion(1, { x: 75, z: 75 });
    sim.addChampion(0, { x: 72, z: 75 });
    sim.tick();
    // Body center projects to (750, 750), radius ~6 px; 13 px off-center is
    // inside radius + slop, 46 px is not.
    expect(pickEnemyOnScreen(sim, 0, 763, 750, project)?.id).toBe(enemy.id);
    expect(pickEnemyOnScreen(sim, 0, 796, 750, project)).toBeNull();
  });

  it('never picks an enemy hidden by the fog of war', () => {
    const sim = new Sim(3);
    sim.addChampion(1, { x: 75, z: 75 });
    sim.tick();
    expect(pickEnemyOnScreen(sim, 0, 750, 750, project)).toBeNull();
  });

  it('prefers a champion standing on a vulnerable structure', () => {
    const sim = new Sim(3);
    // Team 1's OUTER mid tower (vulnerable) stands at (93, 93): a direct
    // click on it still picks the champion beside it, structures lose to
    // champion candidates on screen.
    const champ = sim.addChampion(1, { x: 93.8, z: 93 });
    sim.addChampion(0, { x: 90, z: 93 });
    sim.tick();
    expect(pickEnemyOnScreen(sim, 0, 930, 930, project)?.id).toBe(champ.id);
  });

  it('a direct hit on a body beats another unit within slop', () => {
    const sim = new Sim(3);
    const near = sim.addChampion(1, { x: 75, z: 75 });
    sim.addChampion(1, { x: 76.8, z: 75 });
    sim.addChampion(0, { x: 72, z: 75 });
    sim.tick();
    // Click dead-center on the near champion: the farther one is within
    // slop range too, but a direct hit wins.
    expect(pickEnemyOnScreen(sim, 0, 750, 750, project)?.id).toBe(near.id);
  });
});
