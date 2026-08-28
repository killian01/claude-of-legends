// The kits-v2 champion signatures, end to end through the Sim: each of the
// redesigned mechanics proves out at the champion level, not just at the
// primitive level (tests/primitives_v2.test.ts covers those).

import { describe, expect, it } from 'vitest';
import { addStatus, isRooted, isStunned, slowPct } from '../src/sim/combat/status';
import { Sim } from '../src/sim/sim';
import type { TeamId, Vec2 } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

function arena(
  aChampion: string,
  bChampion: string,
  aPos: Vec2,
  bPos: Vec2,
): { sim: Sim; a: Unit; b: Unit } {
  const sim = new Sim(21);
  const a = sim.addChampion(0 as TeamId, aPos, aChampion);
  a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
  const b = sim.addChampion(1 as TeamId, bPos, bChampion);
  b.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
  return { sim, a, b };
}

describe('Korrath v2', () => {
  it('W raises a real wall that blocks ground, then expires', () => {
    const { sim, a } = arena('korrath', 'sylra', { x: 75, z: 75 }, { x: 95, z: 75 });
    expect(sim.castAbility(a.id, 'W', { x: 80, z: 75 })).toBe(true);
    expect(sim.walls.size).toBe(1);
    expect(sim.nav.isWalkableAt(80, 75)).toBe(false);
    // Raised to 4 s by the playtest feel pass; gone shortly after.
    for (let i = 0; i < 90; i++) sim.tick();
    expect(sim.walls.size).toBe(0);
    expect(sim.nav.isWalkableAt(80, 75)).toBe(true);
  });

  it('E stuns a target gripped against his own rampart', () => {
    const { sim, a, b } = arena('korrath', 'sylra', { x: 75, z: 75 }, { x: 81, z: 75 });
    // Wall right behind the victim, then the grip: crushed against stone.
    expect(sim.castAbility(a.id, 'W', { x: 82, z: 75 })).toBe(true);
    expect(sim.castAbility(a.id, 'E', { x: 81, z: 75 })).toBe(true);
    let stunned = false;
    for (let i = 0; i < 20 && !stunned; i++) {
      sim.tick();
      if (isStunned(b, sim.time)) stunned = true;
    }
    expect(stunned).toBe(true);
    // And the grip still dragged the victim toward Korrath.
    expect(b.pos.x).toBeLessThan(81);
  });
});

describe('Dain v2', () => {
  it('Q refunds half its cooldown when the punch passes through a champion', () => {
    const { sim, a, b } = arena('dain', 'sylra', { x: 75, z: 75 }, { x: 77, z: 75 });
    expect(sim.castAbility(a.id, 'Q', { x: 78.5, z: 75 })).toBe(true);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(b.hp).toBeLessThan(b.maxHp);
    // Full cooldown is 4 s; the refund leaves clearly less than half.
    expect((a.cooldowns.Q ?? 0) - sim.time).toBeLessThan(2.5);
  });
});

describe('Sylra v2', () => {
  it('Q chains to a second nearby enemy and marks both', () => {
    const { sim, a, b } = arena('sylra', 'sylra', { x: 75, z: 75 }, { x: 81, z: 75 });
    const c = sim.addChampion(1, { x: 83, z: 76 }, 'sylra');
    expect(sim.castAbility(a.id, 'Q', { x: 81, z: 75 })).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(c.hp).toBeLessThan(c.maxHp);
    expect(b.statuses.some((s) => s.kind === 'mark')).toBe(true);
    expect(c.statuses.some((s) => s.kind === 'mark')).toBe(true);
  });
});

describe('Fenn v2', () => {
  it('R strikes champions along its line, then the recast returns him home', () => {
    const { sim, a, b } = arena('fenn', 'sylra', { x: 75, z: 75 }, { x: 78, z: 75 });
    a.level = 6;
    const origin = { ...a.pos };
    expect(sim.castAbility(a.id, 'R', { x: 80, z: 75 })).toBe(true);
    // Windup 0.35 s, then the traveling strike passes through the victim.
    for (let i = 0; i < 20; i++) sim.tick();
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(a.pos.x).toBeGreaterThan(origin.x + 3);
    // The banked way home, budgeted like any cast.
    expect(sim.castAbility(a.id, 'R', { x: 0, z: 0 })).toBe(true);
    expect(a.pos.x).toBeCloseTo(origin.x, 1);
    expect(a.pos.z).toBeCloseTo(origin.z, 1);
  });
});

describe('Vesk v2', () => {
  it('R only slows up close but stuns at long range', () => {
    const near = arena('vesk', 'sylra', { x: 40, z: 75 }, { x: 55, z: 75 });
    near.a.level = 6;
    expect(near.sim.castAbility(near.a.id, 'R', { x: 55, z: 75 })).toBe(true);
    for (let i = 0; i < 40; i++) near.sim.tick();
    expect(near.b.hp).toBeLessThan(near.b.maxHp);
    expect(slowPct(near.b, near.sim.time)).toBeGreaterThan(0);

    const far = arena('vesk', 'sylra', { x: 40, z: 75 }, { x: 85, z: 75 });
    far.a.level = 6;
    expect(far.sim.castAbility(far.a.id, 'R', { x: 85, z: 75 })).toBe(true);
    let stunned = false;
    for (let i = 0; i < 60 && !stunned; i++) {
      far.sim.tick();
      if (isStunned(far.b, far.sim.time)) stunned = true;
    }
    expect(stunned).toBe(true);
  });

  it('E vault leaves a caltrop patch at the launch point', () => {
    const { sim, a } = arena('vesk', 'sylra', { x: 75, z: 75 }, { x: 95, z: 75 });
    expect(sim.castAbility(a.id, 'E', { x: 72, z: 75 })).toBe(true);
    const patch = [...sim.zones.values()].find((z) => z.sourceId === a.id);
    expect(patch).toBeDefined();
    expect(patch?.pos.x).toBeCloseTo(75, 1);
  });
});

describe('Ashvyn v2', () => {
  it('E roots at long range and only slows point blank', () => {
    const far = arena('ashvyn', 'sylra', { x: 75, z: 75 }, { x: 82, z: 75 });
    expect(far.sim.castAbility(far.a.id, 'E', { x: 82, z: 75 })).toBe(true);
    let rooted = false;
    for (let i = 0; i < 20 && !rooted; i++) {
      far.sim.tick();
      if (isRooted(far.b, far.sim.time)) rooted = true;
    }
    expect(rooted).toBe(true);

    const near = arena('ashvyn', 'sylra', { x: 75, z: 75 }, { x: 77, z: 75 });
    expect(near.sim.castAbility(near.a.id, 'E', { x: 77, z: 75 })).toBe(true);
    for (let i = 0; i < 6; i++) near.sim.tick();
    expect(slowPct(near.b, near.sim.time)).toBeGreaterThan(0);
    expect(isRooted(near.b, near.sim.time)).toBe(false);
  });
});

describe('Maera v2', () => {
  it('W heals a critical ally twice as fast as a healthy one', () => {
    const { sim, a } = arena('maera', 'sylra', { x: 75, z: 75 }, { x: 110, z: 75 });
    const healthy = sim.addChampion(0, { x: 77, z: 75 }, 'sylra');
    const critical = sim.addChampion(0, { x: 76, z: 76 }, 'sylra');
    healthy.hp = healthy.maxHp * 0.7;
    critical.hp = critical.maxHp * 0.2;
    const h0 = healthy.hp;
    const c0 = critical.hp;
    expect(sim.castAbility(a.id, 'W', { x: 76.5, z: 75.5 })).toBe(true);
    for (let i = 0; i < 21; i++) sim.tick();
    const healthyGain = healthy.hp - h0;
    const criticalGain = critical.hp - c0;
    expect(criticalGain).toBeGreaterThan(healthyGain * 1.5);
  });
});

describe('Torv v2', () => {
  it('E roots an already-slowed target instead of slowing again', () => {
    const { sim, a, b } = arena('torv', 'sylra', { x: 75, z: 75 }, { x: 77, z: 75 });
    addStatus(b, { kind: 'slow', until: sim.time + 3, pct: 0.3 });
    expect(sim.castAbility(a.id, 'E', { x: 77, z: 75 })).toBe(true);
    let rooted = false;
    for (let i = 0; i < 15 && !rooted; i++) {
      sim.tick();
      if (isRooted(b, sim.time) && !isStunned(b, sim.time)) rooted = true;
    }
    expect(rooted).toBe(true);
  });

  it('R leaves the fissure as impassable ground for a beat', () => {
    const { sim, a } = arena('torv', 'sylra', { x: 75, z: 75 }, { x: 110, z: 75 });
    a.level = 6;
    expect(sim.castAbility(a.id, 'R', { x: 84, z: 75 })).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(sim.walls.size).toBe(1);
    expect(sim.nav.isWalkableAt(80, 75)).toBe(false);
    for (let i = 0; i < 50; i++) sim.tick();
    expect(sim.walls.size).toBe(0);
  });
});

describe('Rhoka v2', () => {
  it('Q refunds most of its cooldown against bleeding prey', () => {
    const { sim, a, b } = arena('rhoka', 'sylra', { x: 75, z: 75 }, { x: 78, z: 75 });
    addStatus(b, {
      kind: 'dot',
      until: sim.time + 2.5,
      perSecond: 4,
      sourceId: a.id,
      dtype: 'physical',
    });
    expect(sim.castAbility(a.id, 'Q', { x: 78, z: 75 })).toBe(true);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(b.hp).toBeLessThan(b.maxHp);
    // Full cooldown is 5.5 s; the 60 percent refund leaves ~2.2 s.
    expect((a.cooldowns.Q ?? 0) - sim.time).toBeLessThan(2.5);
  });
});
