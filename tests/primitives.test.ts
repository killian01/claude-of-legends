// Phase 5 primitives gate: stun, taunt, knockback, pull, pierce, ally waves,
// blind, stealth, and attack speed buffs, each through a real champion kit.

import { describe, expect, it } from 'vitest';
import { addStatus, effectiveMoveSpeed, isAirborne, isStunned } from '../src/sim/combat/status';
import { Sim } from '../src/sim/sim';
import type { Unit } from '../src/sim/unit';

function arena(
  aChamp: string,
  bChamp: string,
  aPos: { x: number; z: number },
  bPos: { x: number; z: number },
): { sim: Sim; a: Unit; b: Unit } {
  const sim = new Sim(13);
  const a = sim.addChampion(0, aPos, aChamp);
  a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
  const b = sim.addChampion(1, bPos, bChamp);
  b.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
  return { sim, a, b };
}

describe('combat primitives', () => {
  it('emberfall telegraphs before it lands, then its stun blocks movement and casting', () => {
    const { sim, a, b } = arena('dain', 'sylra', { x: 75, z: 75 }, { x: 76.8, z: 75 });
    a.level = 6;
    expect(sim.castAbility(a.id, 'R', { x: b.pos.x, z: b.pos.z })).toBe(true);
    sim.tick();
    // The comet is still falling: the telegraph window is real counterplay.
    expect(sim.zones.size).toBe(1);
    expect(isStunned(b, sim.time)).toBe(false);
    // The fuse is 1.3 s now (playtest round 2: bigger comet, longer fuse).
    for (let i = 0; i < 32 && !isStunned(b, sim.time); i++) sim.tick();
    expect(isStunned(b, sim.time)).toBe(true);
    expect(sim.castAbility(b.id, 'Q', { x: 75, z: 75 })).toBe(false);
    sim.orderMove(b.id, 90, 75);
    const before = { ...b.pos };
    sim.tick();
    expect(b.pos).toEqual(before);
  });

  it('taunt forces the victim to attack the taunter', () => {
    // Close enough that the fleeing victim is still inside the burst when
    // the windup resolves: running out during the roar is the counterplay.
    const { sim, a, b } = arena('torv', 'sylra', { x: 75, z: 75 }, { x: 76, z: 75 });
    sim.orderMove(b.id, 90, 75);
    expect(sim.castAbility(a.id, 'W', { x: 75, z: 75 })).toBe(true);
    for (let i = 0; i < 7; i++) sim.tick();
    expect(b.attackTargetId).toBe(a.id);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(a.hp).toBeLessThan(a.maxHp);
  });

  it('the great wave sweeps its victims aside, not airborne (kits-v2)', () => {
    const { sim, a, b } = arena('maera', 'sylra', { x: 75, z: 75 }, { x: 79, z: 75 });
    a.level = 6;
    const beforeZ = b.pos.z;
    expect(sim.castAbility(a.id, 'R', { x: 79, z: 75 })).toBe(true);
    // 0.5 s windup, then the wave travels; the hit shoves the target OFF
    // the wave's path (lateral), never into the air.
    let swept = false;
    for (let i = 0; i < 40 && !swept; i++) {
      sim.tick();
      if (Math.abs(b.pos.z - beforeZ) > 1.5) swept = true;
      expect(isAirborne(b, sim.time)).toBe(false);
    }
    expect(swept).toBe(true);
    // A sweep displaces, it does not stun: the victim can walk again.
    sim.orderMove(b.id, 95, b.pos.z);
    const before = { ...b.pos };
    sim.tick();
    expect(b.pos).not.toEqual(before);
  });

  it('a windup delays the cast and a stun during it cancels the spell', () => {
    const { sim, a } = arena('vesk', 'sylra', { x: 75, z: 75 }, { x: 83, z: 75 });
    a.level = 6;
    // Horizon Shot has a 0.6 s windup: paid at press, fired later.
    expect(sim.castAbility(a.id, 'R', { x: 83, z: 75 })).toBe(true);
    sim.tick();
    expect(sim.projectiles.size).toBe(0);
    for (let i = 0; i < 13; i++) sim.tick();
    expect(sim.projectiles.size).toBe(1);

    const { sim: sim2, a: a2 } = arena('vesk', 'sylra', { x: 75, z: 75 }, { x: 83, z: 75 });
    a2.level = 6;
    expect(sim2.castAbility(a2.id, 'R', { x: 83, z: 75 })).toBe(true);
    addStatus(a2, { kind: 'stun', until: sim2.time + 1 });
    for (let i = 0; i < 20; i++) sim2.tick();
    expect(sim2.projectiles.size).toBe(0);
    expect(a2.pendingSpell).toBeNull();
  });

  it('untargetable units take no damage and drop attackers', () => {
    const { sim, a, b } = arena('vesk', 'fenn', { x: 75, z: 75 }, { x: 79, z: 75 });
    addStatus(b, { kind: 'untargetable', until: sim.time + 2 });
    sim.orderAttack(a.id, b.id);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(b.hp).toBe(b.maxHp);
    expect(a.attackTargetId).toBeNull();
  });

  it('pull drags the victim toward the caster', () => {
    const { sim, a, b } = arena('korrath', 'sylra', { x: 75, z: 75 }, { x: 81, z: 75 });
    expect(sim.castAbility(a.id, 'E', { x: 81, z: 75 })).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(b.pos.x).toBeLessThan(78);
  });

  it('piercing skillshots hit everyone along the line', () => {
    const sim = new Sim(13);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'vesk');
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const b1 = sim.addChampion(1, { x: 78, z: 75 }, 'sylra');
    b1.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const b2 = sim.addChampion(1, { x: 82, z: 75 }, 'sylra');
    b2.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    expect(sim.castAbility(a.id, 'Q', { x: 82, z: 75 })).toBe(true);
    // Piercing Round shoulders the rifle first: no projectile until the
    // 0.3 s windup resolves.
    expect(sim.projectiles.size).toBe(0);
    for (let i = 0; i < 7; i++) sim.tick();
    expect(sim.projectiles.size).toBe(1);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(b1.hp).toBeLessThan(b1.maxHp);
    expect(b2.hp).toBeLessThan(b2.maxHp);
  });

  it('ally waves heal friends and damage foes on one cast', () => {
    const sim = new Sim(13);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'maera');
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const ally = sim.addChampion(0, { x: 78, z: 75 }, 'fenn');
    ally.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const enemy = sim.addChampion(1, { x: 81, z: 75 }, 'sylra');
    enemy.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    ally.hp = 300;
    expect(sim.castAbility(a.id, 'Q', { x: 81, z: 75 })).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(ally.hp).toBeGreaterThan(300);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('blind shrinks an observer sight radius', () => {
    const sim = new Sim(13);
    const watcher = sim.addChampion(0, { x: 70, z: 75 });
    watcher.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const enemy = sim.addChampion(1, { x: 78, z: 75 });
    enemy.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    sim.tick();
    expect(sim.isVisible(0, enemy.id)).toBe(true);
    addStatus(watcher, { kind: 'blind', until: 1000, factor: 0.4 });
    sim.tick();
    expect(sim.isVisible(0, enemy.id)).toBe(false);
  });

  it('stealth hides a champion and breaks on attacking', () => {
    const sim = new Sim(13);
    const watcher = sim.addChampion(0, { x: 72, z: 75 });
    watcher.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const fenn = sim.addChampion(1, { x: 75, z: 75 }, 'fenn');
    fenn.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    sim.tick();
    expect(sim.isVisible(0, fenn.id)).toBe(true);
    expect(sim.castAbility(fenn.id, 'E', { x: 75, z: 75 })).toBe(true);
    sim.tick();
    expect(sim.isVisible(0, fenn.id)).toBe(false);
    sim.orderAttack(fenn.id, watcher.id);
    for (let i = 0; i < 30; i++) sim.tick();
    expect(sim.isVisible(0, fenn.id)).toBe(true);
    expect(watcher.hp).toBeLessThan(watcher.maxHp);
  });

  it('attack speed buffs raise damage output', () => {
    const dps = (buffed: boolean): number => {
      const sim = new Sim(13);
      const a = sim.addChampion(0, { x: 75, z: 75 }, 'vesk');
      a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
      const b = sim.addChampion(1, { x: 79, z: 75 }, 'korrath');
      b.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
      if (buffed) addStatus(a, { kind: 'buff', until: 1000, msPct: 0, asPct: 1, armor: 0, mr: 0 });
      sim.orderAttack(a.id, b.id);
      for (let i = 0; i < 80; i++) sim.tick();
      return b.maxHp - b.hp;
    };
    expect(dps(true)).toBeGreaterThan(dps(false) * 1.5);
  });

  it('zephyr-style move speed buffs stack onto effective speed', () => {
    const sim = new Sim(13);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const base = effectiveMoveSpeed(a, sim.time);
    addStatus(a, { kind: 'buff', until: 1000, msPct: 0.35, asPct: 0, armor: 0, mr: 0 });
    expect(effectiveMoveSpeed(a, sim.time)).toBeCloseTo(base * 1.35, 5);
  });
});
