// The kits-v2 bot brain: abilities fire at their TRUE range (the old bot
// refused to poke past a hardcoded 7), the ultimate is held behind its hint
// gates, the kit's own escape key is spent on the retreat, and the banked
// recast is pressed to come home (ADR 0005).

import { describe, expect, it } from 'vitest';
import { LANER } from '../src/sim/content/bots/laner';
import { buildObservation } from '../src/sim/observe';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { Unit } from '../src/sim/unit';

function ready(u: Unit): void {
  u.skillPoints = 0;
  u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  u.level = 6;
}

function act(sim: Sim, unitId: number): ReturnType<typeof LANER.policy> {
  // Team visibility only refreshes on tick; without one, units added after
  // construction are still fogged out of the observation.
  sim.tick();
  const obs = buildObservation(sim, unitId);
  if (!obs) throw new Error('no observation');
  return LANER.policy(obs, new Rng(3));
}

describe('bots v2', () => {
  it('Vesk pokes at his actual Q range, far beyond the old hardcoded 7', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'vesk');
    ready(a);
    sim.addChampion(1, { x: 86, z: 75 }, 'sylra');
    const action = act(sim, a.id);
    expect(action.kind).toBe('cast');
    if (action.kind === 'cast') expect(action.key).toBe('Q');
  });

  it('holds the ultimate until its gate opens', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'dain');
    ready(a);
    const b = sim.addChampion(1, { x: 79, z: 75 }, 'sylra');
    ready(b);
    // One healthy enemy: the R gate (2 clustered, or under 45 percent) is
    // shut, so the engage key goes out instead.
    const held = act(sim, a.id);
    expect(held.kind).toBe('cast');
    if (held.kind === 'cast') expect(held.key).not.toBe('R');
    // The same enemy about to die opens the execute gate.
    b.hp = b.maxHp * 0.2;
    const spent = act(sim, a.id);
    expect(spent.kind).toBe('cast');
    if (spent.kind === 'cast') expect(spent.key).toBe('R');
  });

  it('spends the kit escape key toward home when fleeing a chaser', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'fenn');
    ready(a);
    sim.addChampion(1, { x: 78, z: 75 }, 'sylra');
    a.hp = a.maxHp * 0.2;
    const action = act(sim, a.id);
    expect(action.kind).toBe('cast');
    if (action.kind === 'cast') expect(action.key).toBe('E');
  });

  it('presses the armed recast home once badly hurt', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'fenn');
    ready(a);
    a.recastArmed = { key: 'R', until: sim.time + 4, origin: { x: 70, z: 75 } };
    a.hp = a.maxHp * 0.3;
    const action = act(sim, a.id);
    expect(action.kind).toBe('cast');
    if (action.kind === 'cast') expect(action.key).toBe('R');
  });
});
