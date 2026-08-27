// Elowen's internal combo (the flattest kit in the audit): Mist Lance
// applies a mist mark, and the second mark on a target bursts and slows.
// Marks are keyed PER SOURCE so Elowen's two-stack trigger can never eat
// Sylra's three-stack thorns on a shared focus target.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Unit } from '../src/sim/unit';

// Ticks until a Q bolt from `caster` lands (damage event on `target`).
function tickUntilHit(sim: Sim, casterId: number, target: Unit, horizon = 40): boolean {
  for (let i = 0; i < horizon; i++) {
    for (const ev of sim.tick()) {
      if (ev.type === 'damage' && ev.sourceId === casterId && ev.targetId === target.id) {
        return true;
      }
    }
  }
  return false;
}

const markCount = (u: Unit): number => u.statuses.filter((s) => s.kind === 'mark').length;

describe('mist marks', () => {
  it('two Mist Lances trigger the burst and slow, clearing the marks', () => {
    const sim = new Sim(13);
    const elowen = sim.addChampion(0, { x: 75, z: 75 }, 'elowen');
    elowen.abilityRanks = { Q: 1, W: 0, E: 0, R: 0 };
    const dummy = sim.addChampion(1, { x: 80, z: 75 }, 'torv');
    sim.tick();

    expect(sim.castAbility(elowen.id, 'Q', { x: dummy.pos.x, z: dummy.pos.z })).toBe(true);
    expect(tickUntilHit(sim, elowen.id, dummy)).toBe(true);
    expect(markCount(dummy)).toBe(1);
    expect(dummy.statuses.some((s) => s.kind === 'slow')).toBe(false);

    // Wait out the cooldown (4.5 s); the 5.5 s mark survives the gap.
    for (let i = 0; i < 92; i++) sim.tick();
    dummy.pos = { x: 80, z: 75 };
    expect(sim.castAbility(elowen.id, 'Q', { x: dummy.pos.x, z: dummy.pos.z })).toBe(true);
    expect(tickUntilHit(sim, elowen.id, dummy)).toBe(true);
    expect(dummy.statuses.some((s) => s.kind === 'slow')).toBe(true);
    expect(markCount(dummy)).toBe(0);
  });

  it('marks from different casters never pool', () => {
    const sim = new Sim(13);
    const sylra = sim.addChampion(0, { x: 75, z: 78 }, 'sylra');
    sylra.abilityRanks = { Q: 1, W: 0, E: 0, R: 0 };
    const elowen = sim.addChampion(0, { x: 75, z: 72 }, 'elowen');
    elowen.abilityRanks = { Q: 1, W: 0, E: 0, R: 0 };
    const dummy = sim.addChampion(1, { x: 80, z: 75 }, 'torv');
    sim.tick();

    expect(sim.castAbility(sylra.id, 'Q', { x: dummy.pos.x, z: dummy.pos.z })).toBe(true);
    expect(tickUntilHit(sim, sylra.id, dummy)).toBe(true);
    dummy.pos = { x: 80, z: 75 };
    expect(sim.castAbility(elowen.id, 'Q', { x: dummy.pos.x, z: dummy.pos.z })).toBe(true);
    expect(tickUntilHit(sim, elowen.id, dummy)).toBe(true);

    // One mark per caster, no cross-caster trigger: no root (Sylra needs
    // three of HERS), no slow (Elowen needs two of HERS).
    expect(markCount(dummy)).toBe(2);
    expect(dummy.statuses.some((s) => s.kind === 'root')).toBe(false);
    expect(dummy.statuses.some((s) => s.kind === 'slow')).toBe(false);
  });
});
