// Roster gate: the ten champions exist, are well formed, and every ability
// of every kit executes end to end against a live target.

import { describe, expect, it } from 'vitest';
import { CHAMPION_LIST, CHAMPIONS } from '../src/sim/content/champions';
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
      const b = sim.addChampion(1, { x: 77, z: 75 }, 'sylra');
      a.level = 6;
      a.mana = 999;
      for (const key of KEYS) {
        expect(sim.castAbility(a.id, key, { x: b.pos.x, z: b.pos.z }), `${def.id} ${key}`).toBe(
          true,
        );
      }
      for (let i = 0; i < 60; i++) sim.tick();
      expect(b.maxHp - b.hp, `${def.id} dealt no damage`).toBeGreaterThan(0);
    }
  });

  it('sylra remains the default champion', () => {
    expect(CHAMPIONS.sylra).toBeDefined();
    const sim = new Sim(4);
    const u = sim.addChampion(0);
    expect(u.championId).toBe('sylra');
  });
});
