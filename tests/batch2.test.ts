// Batch 2 gate: recall and attack-move behave per the game definition.

import { describe, expect, it } from 'vitest';
import { isRecalling } from '../src/sim/combat/status';
import { Sim } from '../src/sim/sim';

describe('recall', () => {
  it('channels 8 seconds then teleports home', () => {
    const sim = new Sim(17);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    sim.startRecall(a.id);
    expect(isRecalling(a, sim.time)).toBe(true);
    for (let i = 0; i < 155; i++) sim.tick(); // 7.75 s
    expect(isRecalling(a, sim.time)).toBe(true);
    expect(a.pos.x).toBe(75);
    for (let i = 0; i < 10; i++) sim.tick();
    const fountain = sim.map.fountains[0]!;
    expect(Math.hypot(a.pos.x - fountain.x, a.pos.z - fountain.z)).toBeLessThan(1);
  });

  it('is cancelled by damage and by any order', () => {
    const sim = new Sim(17);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    sim.startRecall(a.id);
    sim.orderMove(a.id, 80, 75);
    expect(isRecalling(a, sim.time)).toBe(false);

    sim.startRecall(a.id);
    const b = sim.addChampion(1, { x: 79, z: 75 });
    sim.tick();
    sim.orderAttack(b.id, a.id);
    for (let i = 0; i < 40 && isRecalling(a, sim.time); i++) sim.tick();
    expect(isRecalling(a, sim.time)).toBe(false);
    // Still at mid, not teleported.
    expect(Math.hypot(a.pos.x - 75, a.pos.z - 75)).toBeLessThan(3);
  });
});

describe('attack-move', () => {
  it('walks to the point and engages enemies met on the way', () => {
    const sim = new Sim(17);
    const a = sim.addChampion(0, { x: 70, z: 75 });
    const b = sim.addChampion(1, { x: 78, z: 75 });
    sim.tick(); // vision
    sim.orderAttackMove(a.id, 100, 75);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(a.attackTargetId).toBe(b.id);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('continues to the destination when nothing is in the way', () => {
    const sim = new Sim(17);
    const a = sim.addChampion(0, { x: 70, z: 75 });
    sim.orderAttackMove(a.id, 80, 75);
    for (let i = 0; i < 100; i++) sim.tick();
    expect(Math.hypot(a.pos.x - 80, a.pos.z - 75)).toBeLessThan(1.5);
    expect(a.attackMoveTarget).toBeNull();
  });
});
