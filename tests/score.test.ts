// Scorekeeping gate: kill and death counting, assists inside the damage
// window (killer excluded, stale damage forgotten), and creep score on
// minion last hits.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

describe('assists', () => {
  it('credits enemy champions who damaged the victim, killer excluded', () => {
    const sim = new Sim(11);
    const helper = sim.addChampion(0, { x: 75, z: 75 });
    const killer = sim.addChampion(0, { x: 78, z: 78 });
    const victim = sim.addChampion(1, { x: 76, z: 76 });
    // The helper lands damage, steps away, then the killer finishes.
    sim.orderAttack(helper.id, victim.id);
    for (let i = 0; i < 60 && victim.hp >= victim.maxHp; i++) sim.tick();
    expect(victim.hp).toBeLessThan(victim.maxHp);
    sim.orderMove(helper.id, 60, 60);
    victim.hp = 20;
    sim.orderAttack(killer.id, victim.id);
    for (let i = 0; i < 100 && !victim.dead; i++) sim.tick();
    expect(victim.dead).toBe(true);
    expect(killer.kills).toBe(1);
    expect(killer.assists).toBe(0);
    expect(helper.assists).toBe(1);
    expect(victim.deaths).toBe(1);
  });

  it('forgets damage older than the assist window', () => {
    const sim = new Sim(11);
    const helper = sim.addChampion(0, { x: 75, z: 75 });
    const killer = sim.addChampion(0, { x: 30, z: 30 });
    const victim = sim.addChampion(1, { x: 76, z: 76 });
    sim.orderAttack(helper.id, victim.id);
    for (let i = 0; i < 60 && victim.hp >= victim.maxHp; i++) sim.tick();
    // The helper leaves entirely so no later idle-defense hit refreshes it.
    sim.orderMove(helper.id, 20, 20);
    helper.pos = { x: 20, z: 20 };
    // Let the assist window lapse, then the kill happens without the helper.
    for (let i = 0; i < 11 * 20; i++) sim.tick();
    killer.pos = { x: victim.pos.x + 1.5, z: victim.pos.z };
    victim.hp = 20;
    sim.orderAttack(killer.id, victim.id);
    for (let i = 0; i < 100 && !victim.dead; i++) sim.tick();
    expect(victim.dead).toBe(true);
    expect(killer.kills).toBe(1);
    expect(helper.assists).toBe(0);
  });
});

describe('creep score', () => {
  it('counts minions last-hit by a champion', () => {
    const sim = new Sim(11);
    const champ = sim.addChampion(0, { x: 40, z: 40 });
    // Run past the first wave spawn, then feed the champion a dying minion.
    for (let i = 0; i < 11 * 20; i++) sim.tick();
    const minion = [...sim.units.values()].find((u) => u.kind === 'minion' && u.team === 1);
    expect(minion).toBeDefined();
    minion!.pos = { x: 42, z: 40 };
    minion!.hp = 1;
    sim.orderAttack(champ.id, minion!.id);
    for (let i = 0; i < 60 && sim.units.has(minion!.id); i++) sim.tick();
    expect(sim.units.has(minion!.id)).toBe(false);
    expect(champ.cs).toBe(1);
  });
});
