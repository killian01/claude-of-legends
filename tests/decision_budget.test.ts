// Decision budget gate (ADR 0003): identical throttling for every
// controller, movement exempt, refill over sim time.

import { describe, expect, it } from 'vitest';
import { DECISION_CAP } from '../src/sim/decision_budget';
import { Sim } from '../src/sim/sim';

describe('decision budget', () => {
  it('caps ability casts at the bucket size, then refills over time', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const b = sim.addChampion(1, { x: 79, z: 75 });
    expect(DECISION_CAP).toBe(2);
    // Two casts burst through, the third is budget-rejected even though the
    // ability itself is ready.
    expect(sim.castAbility(a.id, 'Q', { x: b.pos.x, z: b.pos.z })).toBe(true);
    expect(sim.castAbility(a.id, 'W', { x: b.pos.x, z: b.pos.z })).toBe(true);
    expect(sim.castAbility(a.id, 'E', { x: a.pos.x, z: a.pos.z })).toBe(false);
    // A quarter second of sim time refills one token.
    for (let i = 0; i < 6; i++) sim.tick();
    expect(sim.castAbility(a.id, 'E', { x: a.pos.x, z: a.pos.z })).toBe(true);
  });

  it('sigils draw from the same bucket', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const b = sim.addChampion(1, { x: 79, z: 75 });
    expect(sim.castAbility(a.id, 'Q', { x: b.pos.x, z: b.pos.z })).toBe(true);
    expect(sim.castAbility(a.id, 'W', { x: b.pos.x, z: b.pos.z })).toBe(true);
    expect(sim.castSigil(a.id, 0, { x: 80, z: 75 })).toBe(false);
    for (let i = 0; i < 6; i++) sim.tick();
    expect(sim.castSigil(a.id, 0, { x: 80, z: 75 })).toBe(true);
  });

  it('never throttles movement or attack intentions', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const b = sim.addChampion(1, { x: 79, z: 75 });
    sim.castAbility(a.id, 'Q', { x: 79, z: 75 });
    sim.castAbility(a.id, 'W', { x: 79, z: 75 });
    // Bucket empty; intentions still flow.
    for (let i = 0; i < 10; i++) sim.orderMove(a.id, 70 + i, 75);
    expect(a.path.length).toBeGreaterThan(0);
    sim.orderAttack(a.id, b.id);
    expect(a.attackTargetId).toBe(b.id);
  });

  it('a failed cast does not burn a token', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    // R is level-locked: rejected before the budget, so Q and W still burst.
    expect(sim.castAbility(a.id, 'R', { x: 80, z: 75 })).toBe(false);
    expect(sim.castAbility(a.id, 'Q', { x: 80, z: 75 })).toBe(true);
    expect(sim.castAbility(a.id, 'W', { x: 80, z: 75 })).toBe(true);
  });
});
