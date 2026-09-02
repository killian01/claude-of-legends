// Starting a champion past level 1 (a Forge test drive opens at the
// ultimate's level, playtest: "level 6 right away to try R"): the xp
// curve is walked, so skill points and stat growth land exactly as a
// match grants them, and the ultimate is on the table at once.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { effectiveRank, gainXp, MAX_LEVEL, ULT_RANK_LEVELS, xpForNext } from '../src/sim/stats';

describe('Sim.setLevel', () => {
  it('lands where the same xp earned in a match would', () => {
    const a = new Sim(1);
    const ua = a.addChampion(0);
    const b = new Sim(1);
    const ub = b.addChampion(0);
    const freshMaxHp = ua.maxHp;
    a.setLevel(ua.id, 6);
    let total = 0;
    for (let level = 1; level < 6; level++) total += xpForNext(level);
    gainXp(ub, total);
    expect(ua.level).toBe(6);
    expect(ua.xp).toBe(0);
    expect(ua.maxHp).toBeGreaterThan(freshMaxHp);
    const shape = (u: typeof ua) => ({
      level: u.level,
      xp: u.xp,
      skillPoints: u.skillPoints,
      maxHp: u.maxHp,
      hp: u.hp,
    });
    expect(shape(ua)).toEqual(shape(ub));
  });

  it('puts the ultimate on the table at once, clamps at the cap, never goes down', () => {
    const sim = new Sim(2);
    const u = sim.addChampion(0);
    // R is rank 1 for free from the ultimate's level (stats.ts), so the
    // test drive can cast it at once; a point on it waits for the next gate.
    expect(effectiveRank(u, 'R')).toBe(0);
    expect(sim.levelAbility(u.id, 'R')).toBe(false);
    sim.setLevel(u.id, ULT_RANK_LEVELS[0]!);
    expect(effectiveRank(u, 'R')).toBe(1);
    expect(sim.levelAbility(u.id, 'R')).toBe(false);
    expect(sim.levelAbility(u.id, 'Q')).toBe(true);
    sim.setLevel(u.id, 99);
    expect(u.level).toBe(MAX_LEVEL);
    sim.setLevel(u.id, 3);
    expect(u.level).toBe(MAX_LEVEL);
  });

  it('leaves everything that is not a champion alone', () => {
    const sim = new Sim(3);
    const other = [...sim.units.values()].find((u) => u.kind !== 'champion');
    expect(other).toBeDefined();
    if (!other) return;
    const before = other.level;
    sim.setLevel(other.id, 6);
    expect(other.level).toBe(before);
    sim.setLevel(9999, 6);
  });
});
