// Phase 5 primitives gate: stun, taunt, knockback, pull, pierce, ally waves,
// blind, stealth, and attack speed buffs, each through a real champion kit.

import { describe, expect, it } from 'vitest';
import { addStatus, effectiveMoveSpeed, isStunned } from '../src/sim/combat/status';
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
  const b = sim.addChampion(1, bPos, bChamp);
  return { sim, a, b };
}

describe('combat primitives', () => {
  it('stun blocks movement and casting', () => {
    const { sim, a, b } = arena('dain', 'sylra', { x: 75, z: 75 }, { x: 76.8, z: 75 });
    a.level = 6;
    expect(sim.castAbility(a.id, 'R', { x: b.pos.x, z: b.pos.z })).toBe(true);
    sim.tick();
    expect(isStunned(b, sim.time)).toBe(true);
    expect(sim.castAbility(b.id, 'Q', { x: 75, z: 75 })).toBe(false);
    sim.orderMove(b.id, 90, 75);
    const before = { ...b.pos };
    sim.tick();
    expect(b.pos).toEqual(before);
  });

  it('taunt forces the victim to attack the taunter', () => {
    const { sim, a, b } = arena('torv', 'sylra', { x: 75, z: 75 }, { x: 77, z: 75 });
    sim.orderMove(b.id, 90, 75);
    expect(sim.castAbility(a.id, 'W', { x: 75, z: 75 })).toBe(true);
    sim.tick();
    expect(b.attackTargetId).toBe(a.id);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(a.hp).toBeLessThan(a.maxHp);
  });

  it('knockback pushes enemies away from the wave', () => {
    const { sim, a, b } = arena('maera', 'sylra', { x: 75, z: 75 }, { x: 79, z: 75 });
    a.level = 6;
    expect(sim.castAbility(a.id, 'R', { x: 79, z: 75 })).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(b.pos.x).toBeGreaterThan(80);
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
    const b1 = sim.addChampion(1, { x: 78, z: 75 }, 'sylra');
    const b2 = sim.addChampion(1, { x: 82, z: 75 }, 'sylra');
    expect(sim.castAbility(a.id, 'Q', { x: 82, z: 75 })).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(b1.hp).toBeLessThan(b1.maxHp);
    expect(b2.hp).toBeLessThan(b2.maxHp);
  });

  it('ally waves heal friends and damage foes on one cast', () => {
    const sim = new Sim(13);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'maera');
    const ally = sim.addChampion(0, { x: 78, z: 75 }, 'fenn');
    const enemy = sim.addChampion(1, { x: 81, z: 75 }, 'sylra');
    ally.hp = 300;
    expect(sim.castAbility(a.id, 'Q', { x: 81, z: 75 })).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(ally.hp).toBeGreaterThan(300);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('blind shrinks an observer sight radius', () => {
    const sim = new Sim(13);
    const watcher = sim.addChampion(0, { x: 70, z: 75 });
    const enemy = sim.addChampion(1, { x: 78, z: 75 });
    sim.tick();
    expect(sim.isVisible(0, enemy.id)).toBe(true);
    addStatus(watcher, { kind: 'blind', until: 1000, factor: 0.4 });
    sim.tick();
    expect(sim.isVisible(0, enemy.id)).toBe(false);
  });

  it('stealth hides a champion and breaks on attacking', () => {
    const sim = new Sim(13);
    const watcher = sim.addChampion(0, { x: 72, z: 75 });
    const fenn = sim.addChampion(1, { x: 75, z: 75 }, 'fenn');
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
      const b = sim.addChampion(1, { x: 79, z: 75 }, 'korrath');
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
    const base = effectiveMoveSpeed(a, sim.time);
    addStatus(a, { kind: 'buff', until: 1000, msPct: 0.35, asPct: 0, armor: 0, mr: 0 });
    expect(effectiveMoveSpeed(a, sim.time)).toBeCloseTo(base * 1.35, 5);
  });
});
