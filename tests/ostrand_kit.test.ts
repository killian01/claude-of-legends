// Ostrand's last two kit pieces (docs/design/ostrand.md, slice 5):
// Gauntlet Throw's recast, a charge at the Sworn that reads as ready only
// while one stands in reach, and the Oathfield's guard, a fifth less damage
// from champions outside the ring while he stands inside it.

import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { dist } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { Sim } from '../src/sim/sim';
import { isSwornBy } from '../src/sim/sworn';
import type { TeamId, Vec2 } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

const C: Vec2 = { x: 75, z: 75 };

function arena(): { sim: Sim; o: Unit } {
  const sim = new Sim(41);
  const o = sim.addChampion(0 as TeamId, C, 'ostrand');
  o.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  o.level = 6;
  o.mana = o.maxMana;
  return { sim, o };
}

function enemy(sim: Sim, at: Vec2): Unit {
  const u = sim.addChampion(1 as TeamId, at, 'torv');
  u.level = 6;
  return u;
}

function ticks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

type Ctx = Parameters<typeof dealDamage>[0];
const ctxOf = (sim: Sim): Ctx => (sim as unknown as { ctx(): Ctx }).ctx();

describe("Gauntlet Throw's charge", () => {
  it('flies him to the Sworn when pressed again within the window', () => {
    const { sim, o } = arena();
    const a = enemy(sim, { x: 82, z: 75 });
    expect(sim.castAbility(o.id, 'E', { x: 82, z: 75 })).toBe(true);
    ticks(sim, 8);
    expect(isSwornBy(a, o.id, sim.time)).toBe(true);
    expect(buildObservation(sim, o.id)?.self.abilityReady.E).toBe(true);
    expect(sim.castAbility(o.id, 'E', { x: 82, z: 75 })).toBe(true);
    expect(o.recastArmed).toBeNull();
    ticks(sim, 10);
    expect(dist(o.pos, a.pos)).toBeLessThan(o.radius + a.radius + 0.3);
  });

  it('is not ready and refused when the gauntlet struck nobody', () => {
    const { sim, o } = arena();
    expect(sim.castAbility(o.id, 'E', { x: 70, z: 75 })).toBe(true);
    ticks(sim, 8);
    expect(o.recastArmed?.key).toBe('E');
    expect(buildObservation(sim, o.id)?.self.abilityReady.E).toBe(false);
    const at = { ...o.pos };
    expect(sim.castAbility(o.id, 'E', { x: 70, z: 75 })).toBe(false);
    ticks(sim, 4);
    expect(o.pos).toEqual(at);
  });
});

describe("the Oathfield's guard", () => {
  it('takes a fifth off damage from champions outside the ring, none from inside', () => {
    const { sim, o } = arena();
    const inside = enemy(sim, { x: 78, z: 75 });
    const outside = enemy(sim, { x: 88, z: 75 });
    const ctx = ctxOf(sim);
    expect(sim.castAbility(o.id, 'R', C)).toBe(true);
    let hp = o.hp;
    dealDamage(ctx, outside.id, o, 100, 'true');
    expect(hp - o.hp).toBeCloseTo(80);
    hp = o.hp;
    dealDamage(ctx, inside.id, o, 100, 'true');
    expect(hp - o.hp).toBeCloseTo(100);
    // Only its raiser is guarded: the Sworn inside takes the full blow.
    const before = inside.hp;
    dealDamage(ctx, outside.id, inside, 100, 'true');
    expect(before - inside.hp).toBeCloseTo(100);
  });

  it('ends when the ring falls', () => {
    const { sim, o } = arena();
    enemy(sim, { x: 78, z: 75 });
    const outside = enemy(sim, { x: 88, z: 75 });
    expect(sim.castAbility(o.id, 'R', C)).toBe(true);
    ticks(sim, 4 * 20 + 2);
    const hp = o.hp;
    dealDamage(ctxOf(sim), outside.id, o, 100, 'true');
    expect(hp - o.hp).toBeCloseTo(100);
  });
});
