// Combat core gate: mitigation, shields, death, regen, and auto-attacks.

import { describe, expect, it } from 'vitest';
import { mitigationMultiplier } from '../src/sim/combat/damage';
import { Sim } from '../src/sim/sim';
import type { Unit } from '../src/sim/unit';

// Open mid-lane ground, far from towers and jungle walls, and OUTSIDE
// attack range so idle auto-defense does not start a fight on its own.
function duel(): { sim: Sim; a: Unit; b: Unit } {
  const sim = new Sim(11);
  const a = sim.addChampion(0, { x: 75, z: 75 });
  const b = sim.addChampion(1, { x: 84, z: 75 });
  return { sim, a, b };
}

describe('damage pipeline', () => {
  it('mitigates physical by armor and magic by resist', () => {
    const { b } = duel();
    expect(mitigationMultiplier(b, 'physical')).toBeCloseTo(100 / (100 + b.stats.armor), 5);
    expect(mitigationMultiplier(b, 'magic')).toBeCloseTo(100 / (100 + b.stats.mr), 5);
    expect(mitigationMultiplier(b, 'true')).toBe(1);
  });

  it('regenerates hp and mana over time', () => {
    const { sim, a } = duel();
    a.hp = 100;
    a.mana = 100;
    for (let i = 0; i < 20; i++) sim.tick();
    expect(a.hp).toBeCloseTo(100 + a.stats.hpRegen, 1);
    expect(a.mana).toBeCloseTo(100 + a.stats.manaRegen, 1);
  });
});

describe('auto-attacks', () => {
  it('attacks a target in range on the attack speed cadence', () => {
    const { sim, a, b } = duel();
    sim.orderAttack(a.id, b.id);
    for (let i = 0; i < 100; i++) sim.tick();
    // 5 seconds at 0.65 attacks/s: at least 3 bolts have landed.
    const perHit = a.stats.ad * (100 / (100 + b.stats.armor));
    const regenBack = 5 * b.stats.hpRegen;
    expect(b.maxHp - b.hp).toBeGreaterThan(3 * perHit - regenBack - 1);
  });

  it('chases a target that is out of range', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 70, z: 70 });
    const b = sim.addChampion(1, { x: 90, z: 90 });
    sim.orderAttack(a.id, b.id);
    const before = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    for (let i = 0; i < 40; i++) sim.tick();
    const after = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    expect(after).toBeLessThan(before);
  });

  it('places a zone at the exact aim point when within cast range', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'elowen');
    expect(sim.castAbility(a.id, 'W', { x: 78, z: 72 })).toBe(true);
    const zone = [...sim.zones.values()].at(-1)!;
    expect(zone.pos.x).toBeCloseTo(78, 5);
    expect(zone.pos.z).toBeCloseTo(72, 5);
  });

  it('clamps a zone to max range along the aim direction when aimed beyond', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'elowen');
    // Elowen's Veil has cast range 8; aiming 20 away lands at 8.
    expect(sim.castAbility(a.id, 'W', { x: 95, z: 75 })).toBe(true);
    const zone = [...sim.zones.values()].at(-1)!;
    expect(zone.pos.x).toBeCloseTo(83, 5);
    expect(zone.pos.z).toBeCloseTo(75, 5);
  });

  it('a tower switches onto an enemy that damaged an allied champion in range', () => {
    const sim = new Sim(11);
    // Team 1's vulnerable OUTER mid tower stands at (93, 93).
    const tower = [...sim.units.values()].find(
      (u) => u.kind === 'tower' && u.team === 1 && Math.hypot(u.pos.x - 93, u.pos.z - 93) < 2,
    )!;
    const bystander = sim.addChampion(0, { x: 91.5, z: 93 });
    const attacker = sim.addChampion(0, { x: 96.5, z: 93 });
    const victim = sim.addChampion(1, { x: 94.5, z: 93 });
    sim.tick();
    // Locked onto the nearest enemy champion first.
    expect(tower.attackTargetId).toBe(bystander.id);
    // The dive: the farther enemy hits the tower's allied champion.
    victim.lastHitByChampion = attacker.id;
    victim.lastHitAt = sim.time;
    sim.tick();
    expect(tower.attackTargetId).toBe(attacker.id);
  });

  it('kills, emits a death event, and marks the champion dead', () => {
    const { sim, a, b } = duel();
    b.hp = 30;
    sim.orderAttack(a.id, b.id);
    let death = false;
    for (let i = 0; i < 60; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'death' && ev.unitId === b.id) death = true;
      }
      if (death) break;
    }
    expect(death).toBe(true);
    sim.tick();
    // Champions stay in the sim while dead; only non-champions are removed.
    expect(sim.units.has(b.id)).toBe(true);
    expect(b.dead).toBe(true);
    // The attacker drops its order instead of hitting a corpse.
    sim.tick();
    expect(a.attackTargetId).toBeNull();
  });
});
