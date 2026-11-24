// Ysmer, the Turnlamp, played by the house bots (docs/design/ysmer.md,
// slice 2): a bot seated on her plays her kit behind the release switch,
// spends In My Stead on a hurt ally under threat before anything else, else
// on a hurt enemy in a duel it leads, and keeps it otherwise.

import { describe, expect, it } from 'vitest';
import { LANER } from '../src/sim/content/bots/laner';
import { buildObservation } from '../src/sim/observe';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { TeamId, Vec2 } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

const C: Vec2 = { x: 75, z: 75 };

function ready(u: Unit): void {
  u.skillPoints = 0;
  u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  u.level = 6;
  u.mana = u.maxMana;
}

function act(sim: Sim, unitId: number): ReturnType<typeof LANER.policy> {
  sim.tick();
  const obs = buildObservation(sim, unitId);
  if (!obs) throw new Error('no observation');
  return LANER.policy(obs, new Rng(3));
}

function seat(sim: Sim, team: number, at: Vec2, id: string): Unit {
  const u = sim.addChampion(team as TeamId, at, id);
  ready(u);
  return u;
}

describe('a Ysmer bot', () => {
  it('trades places with a hurt ally an enemy is on, before any other cast', () => {
    const sim = new Sim(43);
    const y = seat(sim, 0, C, 'ysmer');
    const ally = seat(sim, 0, { x: 83, z: 75 }, 'vesk');
    seat(sim, 1, { x: 86, z: 75 }, 'torv');
    ally.hp = ally.maxHp * 0.2;
    const action = act(sim, y.id);
    expect(action.kind === 'cast' && action.key).toBe('R');
    if (action.kind !== 'cast') return;
    expect(Math.abs(action.x - ally.pos.x) + Math.abs(action.z - ally.pos.z)).toBeLessThan(0.5);
  });

  it('brings a hurt enemy into her place in a duel she leads', () => {
    const sim = new Sim(43);
    const y = seat(sim, 0, C, 'ysmer');
    const e = seat(sim, 1, { x: 82, z: 75 }, 'vesk');
    e.hp = e.maxHp * 0.4;
    const action = act(sim, y.id);
    expect(action.kind === 'cast' && action.key).toBe('R');
  });

  it('keeps the ultimate in a fight with a healthy enemy and no ally in trouble', () => {
    const sim = new Sim(43);
    const y = seat(sim, 0, C, 'ysmer');
    seat(sim, 1, { x: 77, z: 75 }, 'torv');
    for (let i = 0; i < 20; i++) {
      const action = act(sim, y.id);
      if (action.kind === 'cast') expect(action.key).not.toBe('R');
    }
  });
});
