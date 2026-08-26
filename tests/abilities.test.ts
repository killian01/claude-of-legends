// Sylra end to end: every effect primitive her kit is composed from, plus
// cooldown, mana, and determinism guarantees of the casting pipeline.

import { describe, expect, it } from 'vitest';
import { applyEffects, type EffectSpec } from '../src/sim/combat/effects';
import { isRooted, slowPct } from '../src/sim/combat/status';
import { CHAMPIONS } from '../src/sim/content/champions';
import { NavGrid } from '../src/sim/navgrid';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { TeamBuffs } from '../src/sim/team_buffs';
import type { Unit } from '../src/sim/unit';
import { createChampion } from '../src/sim/unit';

// Spaced beyond attack range so idle auto-defense stays out of the way.
function duel(): { sim: Sim; a: Unit; b: Unit } {
  const sim = new Sim(11);
  const a = sim.addChampion(0, { x: 75, z: 75 });
  const b = sim.addChampion(1, { x: 85, z: 75 });
  return { sim, a, b };
}

describe('Sylra', () => {
  it('Q hits with a projectile, damages, and applies a mark', () => {
    const { sim, a, b } = duel();
    expect(sim.castAbility(a.id, 'Q', { x: b.pos.x, z: b.pos.z })).toBe(true);
    expect(sim.projectiles.size).toBe(1);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(sim.projectiles.size).toBe(0);
    // Base 70 after the snowball pass shifted damage into the AP ratio.
    const expected = 70 * (100 / (100 + b.stats.mr));
    expect(b.maxHp - b.hp).toBeGreaterThan(expected - 2);
    expect(b.statuses.some((s) => s.kind === 'mark' && s.stacks === 1)).toBe(true);
  });

  it('Q despawns at max range when it misses', () => {
    const { sim, a, b } = duel();
    sim.castAbility(a.id, 'Q', { x: a.pos.x, z: a.pos.z + 5 });
    for (let i = 0; i < 30; i++) sim.tick();
    expect(sim.projectiles.size).toBe(0);
    expect(b.hp).toBe(b.maxHp);
  });

  it('W zone ticks damage and slows', () => {
    const { sim, a, b } = duel();
    sim.castAbility(a.id, 'W', { x: b.pos.x, z: b.pos.z });
    for (let i = 0; i < 21; i++) sim.tick();
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(slowPct(b, sim.time)).toBeCloseTo(0.25, 5);
    expect(b.statuses.some((s) => s.kind === 'mark')).toBe(true);
  });

  it('E shields self and absorbs the next hit', () => {
    const { sim, a, b } = duel();
    sim.castAbility(b.id, 'E', { x: b.pos.x, z: b.pos.z });
    expect(b.statuses.some((s) => s.kind === 'shield' && s.remaining === 70)).toBe(true);
    sim.castAbility(a.id, 'Q', { x: b.pos.x, z: b.pos.z });
    for (let i = 0; i < 10; i++) sim.tick();
    // 70 magic vs 30 mr is about 54: fully absorbed by the 70 shield.
    expect(b.hp).toBe(b.maxHp);
  });

  it('E prefers a nearby ally at the aim point', () => {
    const { sim, a } = duel();
    const ally = sim.addChampion(0, { x: 77, z: 75 });
    sim.castAbility(a.id, 'E', { x: ally.pos.x, z: ally.pos.z });
    expect(ally.statuses.some((s) => s.kind === 'shield')).toBe(true);
    expect(a.statuses.some((s) => s.kind === 'shield')).toBe(false);
  });

  it('R detonates after its delay, damages and roots', () => {
    const { sim, a, b } = duel();
    a.level = 6;
    expect(sim.castAbility(a.id, 'R', { x: b.pos.x, z: b.pos.z })).toBe(true);
    for (let i = 0; i < 20; i++) sim.tick();
    // 1 second in: not yet detonated.
    expect(b.hp).toBe(b.maxHp);
    for (let i = 0; i < 10; i++) sim.tick();
    // Base 158 after the snowball pass shifted damage into the AP ratio.
    const expected = 158 * (100 / (100 + b.stats.mr));
    expect(b.maxHp - b.hp).toBeGreaterThan(expected - 3);
    expect(isRooted(b, sim.time)).toBe(true);
    // Rooted units cannot move.
    sim.orderMove(b.id, 90, 75);
    const before = { ...b.pos };
    sim.tick();
    expect(b.pos).toEqual(before);
  });

  it('the third mark triggers the passive root', () => {
    const rng = new Rng(1);
    const b = createChampion(2, 1, { x: 0, z: 0 }, CHAMPIONS.sylra!);
    const ctx: CombatCtx = {
      time: 0,
      rng,
      nav: new NavGrid(10, [], 0),
      units: new Map([[b.id, b]]),
      projectiles: new Map(),
      zones: new Map(),
      events: [],
      dead: new Set(),
      killers: new Map(),
      teamBuffs: new TeamBuffs(),
      allocId: () => 100,
    };
    const mark: EffectSpec = {
      kind: 'mark',
      duration: 4,
      stacksToTrigger: 3,
      onTrigger: [{ kind: 'root', duration: 1.1 }],
    };
    applyEffects(ctx, 1, { ad: 0, ap: 0 }, b, [mark]);
    applyEffects(ctx, 1, { ad: 0, ap: 0 }, b, [mark]);
    expect(isRooted(b, 0)).toBe(false);
    applyEffects(ctx, 1, { ad: 0, ap: 0 }, b, [mark]);
    expect(isRooted(b, 0)).toBe(true);
    expect(b.statuses.some((s) => s.kind === 'mark')).toBe(false);
  });

  it('locks R before champion level 6', () => {
    const { sim, a } = duel();
    expect(sim.castAbility(a.id, 'R', { x: 81, z: 75 })).toBe(false);
    a.level = 6;
    expect(sim.castAbility(a.id, 'R', { x: 81, z: 75 })).toBe(true);
  });

  it('enforces cooldown and mana', () => {
    const { sim, a } = duel();
    expect(sim.castAbility(a.id, 'Q', { x: 81, z: 75 })).toBe(true);
    expect(sim.castAbility(a.id, 'Q', { x: 81, z: 75 })).toBe(false);
    a.mana = 10;
    expect(sim.castAbility(a.id, 'W', { x: 81, z: 75 })).toBe(false);
  });

  it('a full fight plays out deterministically', () => {
    const run = () => {
      const sim = new Sim(5);
      const a = sim.addChampion(0, { x: 75, z: 75 });
      const b = sim.addChampion(1, { x: 81, z: 75 });
      sim.castAbility(a.id, 'W', { x: 81, z: 75 });
      sim.castAbility(a.id, 'Q', { x: 81, z: 75 });
      sim.orderAttack(a.id, b.id);
      sim.orderMove(b.id, 60, 75);
      const trace: number[] = [];
      for (let i = 0; i < 200; i++) {
        sim.tick();
        trace.push(a.pos.x, a.pos.z, b.pos.x, b.pos.z, b.hp, a.mana);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
