// Roster gate: the ten champions exist, are well formed, and every ability
// of every kit executes end to end against a live target.

import { describe, expect, it } from 'vitest';
import { CHAMPION_LIST, CHAMPIONS } from '../src/sim/content/champions';
import { GAME_MAP } from '../src/sim/content/map';
import { Sim } from '../src/sim/sim';
import type { AbilityKey } from '../src/sim/types';

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

describe('the roster', () => {
  it('has exactly ten champions with unique ids and full kits', () => {
    expect(CHAMPION_LIST).toHaveLength(10);
    expect(new Set(CHAMPION_LIST.map((c) => c.id)).size).toBe(10);
    for (const c of CHAMPION_LIST) {
      expect(c.name.length).toBeGreaterThan(0);
      for (const key of KEYS) {
        const a = c.abilities[key];
        expect(a.name.length, `${c.id} ${key}`).toBeGreaterThan(0);
        expect(a.cooldown).toBeGreaterThan(0);
        expect(a.manaCost).toBeGreaterThanOrEqual(0);
      }
      expect(c.base.hp).toBeGreaterThan(0);
      expect(c.base.moveSpeed).toBeGreaterThan(0);
      expect(c.growth.hp).toBeGreaterThan(0);
    }
  });

  it('every ability of every champion casts and the kit deals damage', () => {
    for (const def of CHAMPION_LIST) {
      const sim = new Sim(4);
      const a = sim.addChampion(0, { x: 75, z: 75 }, def.id);
      a.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
      const b = sim.addChampion(1, { x: 77, z: 75 }, 'sylra');
      // A teammate in reach: ally-seeking spells (Dain's guard jump) need
      // someone to go to, the same way targeted spells need an enemy.
      sim.addChampion(0, { x: 76, z: 73 }, 'korrath');
      a.level = 6;
      a.mana = 999;
      for (const key of KEYS) {
        expect(sim.castAbility(a.id, key, { x: b.pos.x, z: b.pos.z }), `${def.id} ${key}`).toBe(
          true,
        );
        // Let the decision budget refill between casts (ADR 0003).
        for (let i = 0; i < 10; i++) sim.tick();
      }
      for (let i = 0; i < 60; i++) sim.tick();
      expect(b.maxHp - b.hp, `${def.id} dealt no damage`).toBeGreaterThan(0);
    }
  });

  it('horizon shot stays a map-crossing skillshot', () => {
    const r = CHAMPIONS.vesk!.abilities.R;
    expect(r.spec.kind).toBe('skillshot');
    if (r.spec.kind === 'skillshot') {
      expect(r.spec.range).toBeGreaterThanOrEqual(GAME_MAP.size * 0.8);
      expect(r.castRange).toBeGreaterThanOrEqual(GAME_MAP.size * 0.8);
    }
  });

  it('emberfall detonates late enough to dodge and stuns only its epicenter', () => {
    const r = CHAMPIONS.dain!.abilities.R;
    expect(r.spec.kind).toBe('zone');
    if (r.spec.kind === 'zone') {
      expect(r.spec.detonateDelay ?? 0).toBeGreaterThanOrEqual(0.8);
      // kits-v2: the stun lives behind the epicenter conditional, so the
      // rim is escapable damage, not guaranteed hard CC.
      const center = r.spec.onDetonate?.find((e) => e.kind === 'conditional');
      expect(center?.kind).toBe('conditional');
      if (center?.kind === 'conditional') {
        expect(center.when.kind).toBe('withinCenter');
        expect(center.effects.some((e) => e.kind === 'stun')).toBe(true);
        expect(center.otherwise?.some((e) => e.kind === 'stun')).toBe(false);
      }
    }
  });

  it('sylra remains the default champion', () => {
    expect(CHAMPIONS.sylra).toBeDefined();
    const sim = new Sim(4);
    const u = sim.addChampion(0);
    expect(u.championId).toBe('sylra');
  });
});
