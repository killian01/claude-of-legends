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

describe('kill credit', () => {
  it('an executing tower credits the last champion to damage the victim', () => {
    const sim = new Sim(11);
    const attacker = sim.addChampion(1, { x: 75, z: 75 });
    // The victim stands in reach of team 1's outer mid tower at 1 hp; the
    // attacker softened it moments ago from afar.
    const victim = sim.addChampion(0, { x: 94.5, z: 93 });
    victim.hp = 1;
    victim.lastHitByChampion = attacker.id;
    victim.lastHitAt = sim.time;
    const goldBefore = attacker.gold;
    for (let i = 0; i < 100 && !victim.dead; i++) sim.tick();
    expect(victim.dead).toBe(true);
    expect(attacker.kills).toBe(1);
    expect(attacker.killStreak).toBe(1);
    expect(attacker.gold - goldBefore).toBe(300);
  });
});

describe('bounties snowball', () => {
  it('pays more for a higher-level victim on a kill streak, then resets it', () => {
    const sim = new Sim(11);
    const killer = sim.addChampion(0, { x: 75, z: 75 });
    const victim = sim.addChampion(1, { x: 77, z: 75 });
    victim.level = 5;
    victim.killStreak = 3;
    victim.hp = 10;
    const before = killer.gold;
    sim.orderAttack(killer.id, victim.id);
    for (let i = 0; i < 60 && !victim.dead; i++) sim.tick();
    expect(victim.dead).toBe(true);
    // 300 base + 25 x 4 levels + 60 x 3 shutdown = 580.
    expect(killer.gold - before).toBe(580);
    expect(killer.killStreak).toBe(1);
    expect(victim.killStreak).toBe(0);
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
