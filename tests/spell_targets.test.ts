// Structures gate: a tower or a Sanctum falls to attacks and to minions,
// never to a spell. Every ability delivery has to obey it, so this covers a
// targeted spell, a burst, a skillshot in flight and a ground zone.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Unit } from '../src/sim/unit';

// Team 1's outer mid tower, the one that stands unprotected at match start.
function outerMidTower(sim: Sim): Unit {
  return [...sim.units.values()].find(
    (u) => u.kind === 'tower' && u.team === 1 && Math.hypot(u.pos.x - 93, u.pos.z - 93) < 2,
  )!;
}

function sanctumOf(sim: Sim, team: number): Unit {
  return [...sim.units.values()].find((u) => u.kind === 'sanctum' && u.team === team)!;
}

describe('spells and structures', () => {
  it('a targeted spell never locks onto a tower', () => {
    const sim = new Sim(31);
    const tower = outerMidTower(sim);
    // Fenn's Q is a targeted strike; stand next to the tower with nothing
    // else in reach and aim straight at it.
    const a = sim.addChampion(0, { x: tower.pos.x - 2.5, z: tower.pos.z }, 'fenn');
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    // Disarmed: idle defense would otherwise auto-attack the tower, which
    // is exactly the damage this test must not confuse for a spell.
    a.stats.attackRange = 0.1;
    const before = tower.hp;
    sim.castAbility(a.id, 'Q', { x: tower.pos.x, z: tower.pos.z });
    for (let i = 0; i < 20; i++) sim.tick();
    expect(tower.hp).toBe(before);
  });

  it('a skillshot flies over a tower instead of being eaten by it', () => {
    const sim = new Sim(31);
    const tower = outerMidTower(sim);
    const a = sim.addChampion(0, { x: tower.pos.x - 8, z: tower.pos.z }, 'sylra');
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    // An enemy standing just past the tower, on the same line.
    const b = sim.addChampion(1, { x: tower.pos.x + 3, z: tower.pos.z }, 'sylra');
    const towerBefore = tower.hp;
    expect(sim.castAbility(a.id, 'Q', { x: b.pos.x, z: b.pos.z })).toBe(true);
    for (let i = 0; i < 30; i++) sim.tick();
    expect(tower.hp).toBe(towerBefore);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('a ground zone leaves a tower and a Sanctum alone', () => {
    const sim = new Sim(31);
    const tower = outerMidTower(sim);
    const sanctum = sanctumOf(sim, 1);
    const a = sim.addChampion(0, { x: tower.pos.x - 3, z: tower.pos.z }, 'sylra');
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    a.stats.attackRange = 0.1;
    const towerBefore = tower.hp;
    const sanctumBefore = sanctum.hp;
    expect(sim.castAbility(a.id, 'W', { x: tower.pos.x, z: tower.pos.z })).toBe(true);
    for (let i = 0; i < 80; i++) sim.tick();
    expect(tower.hp).toBe(towerBefore);
    expect(sanctum.hp).toBe(sanctumBefore);
  });

  it('but an auto-attack still brings a tower down', () => {
    const sim = new Sim(31);
    const tower = outerMidTower(sim);
    const a = sim.addChampion(0, { x: tower.pos.x - 2, z: tower.pos.z }, 'korrath');
    const before = tower.hp;
    sim.orderAttack(a.id, tower.id);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(tower.hp).toBeLessThan(before);
  });
});
