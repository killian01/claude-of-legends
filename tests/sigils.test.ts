// Sigils gate: the four launch sigils exist and work through castSigil.

import { describe, expect, it } from 'vitest';
import { healFactor } from '../src/sim/combat/status';
import { SIGIL_LIST } from '../src/sim/content/sigils';
import { Sim } from '../src/sim/sim';

describe('sigils', () => {
  it('ships four sigils and defaults champions to riftstep and mend', () => {
    expect(SIGIL_LIST).toHaveLength(4);
    const sim = new Sim(9);
    const a = sim.addChampion(0);
    expect(a.sigils).toEqual(['riftstep', 'mend']);
  });

  it('riftstep blinks instantly and goes on cooldown', () => {
    const sim = new Sim(9);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    expect(sim.castSigil(a.id, 0, { x: 82, z: 75 })).toBe(true);
    expect(a.pos.x).toBeGreaterThan(78);
    expect(sim.castSigil(a.id, 0, { x: 85, z: 75 })).toBe(false);
  });

  it('mend heals, and grievous wounds cut the heal', () => {
    const sim = new Sim(9);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.hp = 200;
    expect(sim.castSigil(a.id, 1, { x: 75, z: 75 })).toBe(true);
    expect(a.hp).toBeCloseTo(420, 0);

    // Far from `a` so the searched ally is b itself.
    const b = sim.addChampion(0, { x: 95, z: 75 });
    const enemy = sim.addChampion(1, { x: 97, z: 75 });
    enemy.sigils = ['sear', 'mend'];
    b.hp = 200;
    expect(sim.castSigil(enemy.id, 0, { x: 95, z: 75 })).toBe(true);
    expect(healFactor(b, sim.time)).toBeCloseTo(0.6, 5);
    b.sigils = ['mend', 'mend'];
    expect(sim.castSigil(b.id, 0, { x: 95, z: 75 })).toBe(true);
    expect(b.hp).toBeCloseTo(200 + 220 * 0.6, 0);
  });

  it('sear ticks damage over time', () => {
    const sim = new Sim(9);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    const enemy = sim.addChampion(1, { x: 79, z: 75 });
    a.sigils = ['sear', 'mend'];
    expect(sim.castSigil(a.id, 0, { x: 79, z: 75 })).toBe(true);
    for (let i = 0; i < 30; i++) sim.tick();
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('zephyr grants a burst of move speed', () => {
    const sim = new Sim(9);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.sigils = ['zephyr', 'mend'];
    expect(sim.castSigil(a.id, 0, { x: 75, z: 75 })).toBe(true);
    expect(a.statuses.some((s) => s.kind === 'buff' && s.msPct > 0)).toBe(true);
  });
});
