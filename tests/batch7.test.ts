// Batch 7 gate: skill points, ability ranks, and champion passives.

import { describe, expect, it } from 'vitest';
import { armorBonus } from '../src/sim/combat/status';
import { CHAMPIONS } from '../src/sim/content/champions';
import { buildObservation } from '../src/sim/observe';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { effectiveRank, gainXp, xpForNext } from '../src/sim/stats';

const fakeCtx = (sim: Sim): CombatCtx =>
  ({
    time: sim.time,
    units: sim.units,
    dead: new Set(),
    killers: new Map(),
    events: [],
  }) as unknown as CombatCtx;

describe('skill points and ability ranks', () => {
  it('level ups grant one skill point each', () => {
    const sim = new Sim(7);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    expect(a.skillPoints).toBe(0);
    gainXp(a, xpForNext(1) + xpForNext(2));
    expect(a.level).toBe(3);
    expect(a.skillPoints).toBe(2);
  });

  it('basics cap at rank 5 and R gates at levels 6/11/16', () => {
    const sim = new Sim(7);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.skillPoints = 20;
    for (let i = 0; i < 4; i++) expect(sim.levelAbility(a.id, 'Q')).toBe(true);
    expect(effectiveRank(a, 'Q')).toBe(5);
    expect(sim.levelAbility(a.id, 'Q')).toBe(false);

    // R is locked before 6, free rank 1 at 6, point-gated at 11 and 16.
    expect(sim.levelAbility(a.id, 'R')).toBe(false);
    a.level = 6;
    expect(effectiveRank(a, 'R')).toBe(1);
    expect(sim.levelAbility(a.id, 'R')).toBe(false);
    a.level = 11;
    expect(sim.levelAbility(a.id, 'R')).toBe(true);
    expect(effectiveRank(a, 'R')).toBe(2);
    expect(sim.levelAbility(a.id, 'R')).toBe(false);
    a.level = 16;
    expect(sim.levelAbility(a.id, 'R')).toBe(true);
    expect(effectiveRank(a, 'R')).toBe(3);
    expect(sim.levelAbility(a.id, 'R')).toBe(false);
  });

  it('spending a point requires having one', () => {
    const sim = new Sim(7);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    expect(a.skillPoints).toBe(0);
    expect(sim.levelAbility(a.id, 'W')).toBe(false);
  });

  it('higher rank raises base damage and shortens the cooldown', () => {
    const sim = new Sim(7);
    const korrath = sim.addChampion(0, { x: 75, z: 75 }, 'korrath');
    const dummy = sim.addChampion(1, { x: 77, z: 75 });
    sim.tick();

    const before1 = dummy.hp;
    expect(sim.castAbility(korrath.id, 'Q', { x: dummy.pos.x, z: dummy.pos.z })).toBe(true);
    const d1 = before1 - dummy.hp;
    const cd1 = (korrath.cooldowns.Q ?? 0) - sim.time;
    expect(cd1).toBeCloseTo(4.5, 5);

    korrath.skillPoints = 1;
    expect(sim.levelAbility(korrath.id, 'Q')).toBe(true);
    korrath.cooldowns.Q = 0;
    dummy.hp = dummy.maxHp;
    for (let i = 0; i < 10; i++) sim.tick();

    const before2 = dummy.hp;
    expect(sim.castAbility(korrath.id, 'Q', { x: dummy.pos.x, z: dummy.pos.z })).toBe(true);
    const d2 = before2 - dummy.hp;
    const cd2 = (korrath.cooldowns.Q ?? 0) - sim.time;
    expect(d2).toBeGreaterThan(d1);
    expect(cd2).toBeCloseTo(4.5 * 0.94, 5);
  });

  it('the observation exposes ranks and skill points', () => {
    const sim = new Sim(7);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.skillPoints = 3;
    a.level = 6;
    const obs = buildObservation(sim, a.id)!;
    expect(obs.self.skillPoints).toBe(3);
    expect(obs.self.abilityRanks).toEqual({ Q: 1, W: 1, E: 1, R: 1 });
  });
});

describe('champion passives', () => {
  it('Korrath Shieldskin shields after 4 calm seconds', () => {
    const sim = new Sim(7);
    const korrath = sim.addChampion(0, { x: 75, z: 75 }, 'korrath');
    for (let i = 0; i < 90; i++) sim.tick();
    expect(korrath.statuses.some((s) => s.kind === 'shield')).toBe(true);
  });

  it('Dain Heat empowers the next ability at 4 stacks, then resets', () => {
    const sim = new Sim(7);
    const dain = sim.addChampion(0, { x: 75, z: 75 }, 'dain');
    const target = sim.addChampion(1, { x: 77, z: 75 });
    const passive = CHAMPIONS.dain!.passive;
    dain.passiveStacks = 4;
    expect(passive.modifyDamage!(fakeCtx(sim), dain, target, 100, 'physical', 'ability')).toBe(125);
    expect(dain.passiveStacks).toBe(0);
    expect(passive.modifyDamage!(fakeCtx(sim), dain, target, 100, 'physical', 'ability')).toBe(100);
    // Attacks never consume Heat; they build it.
    dain.passiveStacks = 4;
    expect(passive.modifyDamage!(fakeCtx(sim), dain, target, 100, 'physical', 'attack')).toBe(100);
    expect(dain.passiveStacks).toBe(4);
  });

  it('Fenn Opportunist only boosts low-health targets', () => {
    const sim = new Sim(7);
    const fenn = sim.addChampion(0, { x: 75, z: 75 }, 'fenn');
    const target = sim.addChampion(1, { x: 77, z: 75 });
    const passive = CHAMPIONS.fenn!.passive;
    target.hp = target.maxHp * 0.8;
    expect(passive.modifyDamage!(fakeCtx(sim), fenn, target, 100, 'physical', 'attack')).toBe(100);
    target.hp = target.maxHp * 0.2;
    expect(
      passive.modifyDamage!(fakeCtx(sim), fenn, target, 100, 'physical', 'attack'),
    ).toBeCloseTo(115, 5);
  });

  it('Vesk Deadstill boosts attacks against slowed targets only', () => {
    const sim = new Sim(7);
    const vesk = sim.addChampion(0, { x: 75, z: 75 }, 'vesk');
    const target = sim.addChampion(1, { x: 80, z: 75 });
    const passive = CHAMPIONS.vesk!.passive;
    expect(passive.modifyDamage!(fakeCtx(sim), vesk, target, 100, 'physical', 'attack')).toBe(100);
    target.statuses.push({ kind: 'slow', until: sim.time + 5, pct: 0.3 });
    expect(
      passive.modifyDamage!(fakeCtx(sim), vesk, target, 100, 'physical', 'attack'),
    ).toBeCloseTo(115, 5);
    // Abilities are not attacks.
    expect(passive.modifyDamage!(fakeCtx(sim), vesk, target, 100, 'physical', 'ability')).toBe(100);
  });

  it('Ashvyn Twinshot echoes every third attack', () => {
    const sim = new Sim(7);
    const ashvyn = sim.addChampion(0, { x: 75, z: 75 }, 'ashvyn');
    const target = sim.addChampion(1, { x: 77, z: 75 });
    const passive = CHAMPIONS.ashvyn!.passive;
    const ctx = fakeCtx(sim);
    const before = target.hp;
    passive.onAttackHit!(ctx, ashvyn, target);
    passive.onAttackHit!(ctx, ashvyn, target);
    expect(target.hp).toBe(before);
    passive.onAttackHit!(ctx, ashvyn, target);
    expect(target.hp).toBeLessThan(before);
    expect(ashvyn.passiveStacks).toBe(0);
  });

  it('Rhoka Rend bleeds auto-attacked champions', () => {
    const sim = new Sim(7);
    const rhoka = sim.addChampion(0, { x: 75, z: 75 }, 'rhoka');
    const target = sim.addChampion(1, { x: 76.5, z: 75 });
    sim.tick();
    sim.orderAttack(rhoka.id, target.id);
    for (let i = 0; i < 30 && !target.statuses.some((s) => s.kind === 'dot'); i++) sim.tick();
    const dot = target.statuses.find((s) => s.kind === 'dot');
    expect(dot).toBeDefined();
    if (dot?.kind === 'dot') expect(dot.sourceId).toBe(rhoka.id);
  });

  it('Elowen Mistborne grants move speed on ability damage without stacking', () => {
    const sim = new Sim(7);
    const elowen = sim.addChampion(0, { x: 75, z: 75 }, 'elowen');
    const target = sim.addChampion(1, { x: 80, z: 75 });
    const passive = CHAMPIONS.elowen!.passive;
    const ctx = fakeCtx(sim);
    expect(passive.modifyDamage!(ctx, elowen, target, 50, 'magic', 'ability')).toBe(50);
    passive.modifyDamage!(ctx, elowen, target, 50, 'magic', 'ability');
    const buffs = elowen.statuses.filter((s) => s.kind === 'buff');
    expect(buffs).toHaveLength(1);
    if (buffs[0]?.kind === 'buff') expect(buffs[0].msPct).toBeCloseTo(0.08, 5);
  });

  it('Torv Bulwark Aura gives nearby allies armor, refreshed not stacked', () => {
    const sim = new Sim(7);
    sim.addChampion(0, { x: 75, z: 75 }, 'torv');
    const ally = sim.addChampion(0, { x: 78, z: 75 });
    const far = sim.addChampion(0, { x: 100, z: 75 });
    for (let i = 0; i < 40; i++) sim.tick();
    expect(armorBonus(ally, sim.time)).toBe(8);
    expect(armorBonus(far, sim.time)).toBe(0);
  });

  it('Maera Spring Tide splashes heals onto the nearest other ally', () => {
    const sim = new Sim(7);
    const maera = sim.addChampion(0, { x: 75, z: 75 }, 'maera');
    const wounded = sim.addChampion(0, { x: 77, z: 75 });
    const nearby = sim.addChampion(0, { x: 79, z: 75 });
    sim.tick();
    wounded.hp = 100;
    nearby.hp = 100;
    // Mend rides the default sigil loadout in slot 1.
    expect(sim.castSigil(maera.id, 1, { x: wounded.pos.x, z: wounded.pos.z })).toBe(true);
    expect(wounded.hp).toBeCloseTo(320, 0);
    expect(nearby.hp).toBeCloseTo(100 + 220 * 0.35, 0);
  });
});
