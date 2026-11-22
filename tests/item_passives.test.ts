// Item passives gate: the signature passives (Heartbeat, Deathmark, Gale,
// Firstbolt) work through the shared passive dispatch, and the Laner
// spends its sigils (Riftstep escape, Sear kill-secure) now that they are
// worth pressing.

import { describe, expect, it } from 'vitest';
import { BOTS, DEFAULT_BOT_ID } from '../src/sim/content/bots';
import { ITEM_PASSIVES } from '../src/sim/content/item_passives';
import { ITEMS } from '../src/sim/content/items';
import type { Observation, ObsSelf, ObsUnit } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';

const ctxOf = (sim: Sim): CombatCtx => (sim as unknown as { ctx(): CombatCtx }).ctx();

const laner = BOTS[DEFAULT_BOT_ID]!.policy;

describe('item passives', () => {
  it('Heartbeat (worldheart) regenerates out of combat, not in combat', () => {
    const sim = new Sim(5);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'elowen');
    a.items.push('worldheart');
    a.hp = a.maxHp * 0.5;
    // Out of combat since spawn: the heartbeat pumps ~2% max hp per second.
    for (let i = 0; i < 40; i++) sim.tick();
    const calmGain = a.hp - a.maxHp * 0.5;
    expect(calmGain).toBeGreaterThan(a.maxHp * 0.02 * 2 * 0.7);

    // Fresh damage silences it for 5 s: only base regen trickles.
    a.hp = a.maxHp * 0.5;
    a.lastDamagedAt = sim.time;
    for (let i = 0; i < 20; i++) sim.tick();
    const combatGain = a.hp - a.maxHp * 0.5;
    expect(combatGain).toBeLessThan(a.maxHp * 0.01);
  });

  it('Deathmark (doombrand) amplifies hits on targets below 30 percent', () => {
    const sim = new Sim(5);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'vesk');
    const b = sim.addChampion(1, { x: 80, z: 75 }, 'elowen');
    // The passive reads the item list; stats stay untouched on purpose so
    // the damage ratio isolates the multiplier.
    a.items.push('doombrand');
    sim.orderAttack(a.id, b.id);
    const hits: number[] = [];
    for (let i = 0; i < 200 && hits.length < 1; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.sourceId === a.id) hits.push(ev.amount);
      }
    }
    expect(hits.length).toBe(1);
    b.hp = b.maxHp * 0.2;
    const low: number[] = [];
    for (let i = 0; i < 200 && low.length < 1; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.sourceId === a.id) low.push(ev.amount);
      }
    }
    expect(low.length).toBe(1);
    expect(low[0]! / hits[0]!).toBeCloseTo(1.12, 2);
  });

  it('Firstbolt (tempest_core) amplifies ability damage on targets above 70 percent', () => {
    const sim = new Sim(5);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'sylra');
    const b = sim.addChampion(1, { x: 80, z: 75 }, 'vesk');
    const ctx = ctxOf(sim);
    const passive = ITEM_PASSIVES.tempest_core!;
    expect(passive.name).toBe('Firstbolt');
    b.hp = b.maxHp;
    expect(passive.modifyDamage!(ctx, a, b, 100, 'magic', 'ability')).toBeCloseTo(112, 6);
    // Attacks and other damage are left alone, full health or not.
    expect(passive.modifyDamage!(ctx, a, b, 100, 'magic', 'attack')).toBe(100);
    expect(passive.modifyDamage!(ctx, a, b, 100, 'magic', 'other')).toBe(100);
    // At 70 percent and under, the bolt has passed.
    b.hp = b.maxHp * 0.7;
    expect(passive.modifyDamage!(ctx, a, b, 100, 'magic', 'ability')).toBe(100);
    b.hp = b.maxHp * 0.71;
    expect(passive.modifyDamage!(ctx, a, b, 100, 'magic', 'ability')).toBeCloseTo(112, 6);
  });

  it('Firstbolt reaches a real Mist Lance, and only while the target is above 70 percent', () => {
    // Elowen's first lance at rank 1, with and without the item in her bag
    // (stats untouched, so the ratio isolates the passive).
    const lance = (withItem: boolean, hpShare: number): number => {
      const sim = new Sim(13);
      const elowen = sim.addChampion(0, { x: 75, z: 75 }, 'elowen');
      elowen.abilityRanks = { Q: 1, W: 0, E: 0, R: 0 };
      if (withItem) elowen.items.push('tempest_core');
      const dummy = sim.addChampion(1, { x: 80, z: 75 }, 'torv');
      dummy.hp = dummy.maxHp * hpShare;
      sim.tick();
      expect(sim.castAbility(elowen.id, 'Q', { x: dummy.pos.x, z: dummy.pos.z })).toBe(true);
      for (let i = 0; i < 40; i++) {
        for (const ev of sim.tick()) {
          if (ev.type === 'damage' && ev.sourceId === elowen.id && ev.targetId === dummy.id) {
            return ev.amount;
          }
        }
      }
      return 0;
    };
    expect(lance(false, 1)).toBeGreaterThan(0);
    expect(lance(true, 1) / lance(false, 1)).toBeCloseTo(1.12, 4);
    expect(lance(true, 0.5)).toBeCloseTo(lance(false, 0.5), 6);
  });

  it('Tempest Core gives 160 ability power to carry Firstbolt', () => {
    expect(ITEMS.tempest_core!.stats).toEqual({ ap: 160 });
    expect(ITEM_PASSIVES.tempest_core!.name).toBe('Firstbolt');
  });

  it('Gale (skyshear) grants move speed on champion hits', () => {
    const sim = new Sim(5);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'vesk');
    const b = sim.addChampion(1, { x: 80, z: 75 }, 'elowen');
    a.items.push('skyshear');
    sim.orderAttack(a.id, b.id);
    let landed = false;
    for (let i = 0; i < 200 && !landed; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.sourceId === a.id) landed = true;
      }
    }
    expect(landed).toBe(true);
    expect(a.statuses.some((s) => s.kind === 'buff' && s.msPct > 0)).toBe(true);
  });
});

function syntheticObs(partial: Partial<Observation>, self: Partial<ObsSelf> = {}): Observation {
  const base: ObsSelf = {
    id: 1,
    team: 0,
    x: 75,
    z: 75,
    hp: 600,
    maxHp: 600,
    hpFrac: 1,
    mana: 300,
    maxMana: 300,
    level: 3,
    gold: 0,
    dead: false,
    abilityReady: { Q: false, W: false, E: false, R: false },
    abilityRanks: { Q: 1, W: 1, E: 1, R: 0 },
    skillPoints: 0,
    sigils: ['riftstep', 'mend'],
    sigilReady: [true, true],
    items: [],
    championId: 'korrath',
    lane: 'mid',
  };
  return {
    tick: 100,
    time: 5,
    winner: null,
    self: { ...base, ...self },
    units: [],
    objectiveSpawnAt: null,
    projectiles: [],
    zones: [],
    ...partial,
  };
}

function enemyChampion(x: number, z: number, hpFrac = 1): ObsUnit {
  return { id: 9, kind: 'champion', friendly: false, x, z, hpFrac, radius: 0.68 };
}

describe('the Laner spends its sigils', () => {
  it('Riftsteps toward home when low with a chaser on top', () => {
    const obs = syntheticObs(
      { units: [enemyChampion(78, 75)] },
      { hp: 120, hpFrac: 0.2, sigils: ['riftstep', 'mend'], sigilReady: [true, true] },
    );
    const action = laner(obs, new Rng(3));
    expect(action).toMatchObject({ kind: 'sigil', slot: 0 });
  });

  it('falls back to Mend when low with nobody chasing', () => {
    const obs = syntheticObs(
      {},
      { hp: 120, hpFrac: 0.2, sigils: ['riftstep', 'mend'], sigilReady: [true, true] },
    );
    const action = laner(obs, new Rng(3));
    expect(action).toMatchObject({ kind: 'sigil', slot: 1 });
  });

  it('Sears a kill-range enemy in cast range', () => {
    const obs = syntheticObs(
      { units: [enemyChampion(80, 75, 0.2)] },
      { sigils: ['sear', 'zephyr'], sigilReady: [true, true] },
    );
    const action = laner(obs, new Rng(3));
    expect(action).toMatchObject({ kind: 'sigil', slot: 0, x: 80, z: 75 });
  });
});
