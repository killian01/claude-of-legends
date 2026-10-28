// Ostrand, the Pledgeblade, played by the house bots (docs/design/ostrand.md,
// slice 3): a bot seated on him plays his kit even behind the release
// switch, raises the Oathfield only on an enemy in reach in a duel it is
// ahead in, and the ring falls the moment he does, for every side alike.

import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { LANER } from '../src/sim/content/bots/laner';
import { championDef } from '../src/sim/content/champions';
import { dist } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { TeamId, Vec2 } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

type Ctx = Parameters<typeof dealDamage>[0];
const ctxOf = (sim: Sim): Ctx => (sim as unknown as { ctx(): Ctx }).ctx();

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

function duel(): { sim: Sim; o: Unit; e: Unit } {
  const sim = new Sim(41);
  const o = sim.addChampion(0 as TeamId, C, 'ostrand');
  ready(o);
  const e = sim.addChampion(1 as TeamId, { x: 78, z: 75 }, 'torv');
  ready(e);
  return { sim, o, e };
}

describe('an Ostrand bot', () => {
  it('reads his kit while he is still behind the switch', () => {
    expect(championDef('ostrand')?.abilities.R.name).toBe('Oathfield');
    expect(championDef('torv')?.id).toBe('torv');
    expect(championDef('nobody')).toBeUndefined();
  });

  it('raises the Oathfield on an enemy in reach when it is the healthier', () => {
    const { sim, o, e } = duel();
    e.hp = e.maxHp * 0.8;
    const action = act(sim, o.id);
    expect(action.kind === 'cast' && action.key).toBe('R');
  });

  it('holds the ring in a duel it is behind in, and fights with the rest', () => {
    const { sim, o, e } = duel();
    o.hp = o.maxHp * 0.5;
    e.hp = e.maxHp * 0.9;
    const action = act(sim, o.id);
    expect(action.kind === 'cast' && action.key).not.toBe('R');
  });
});

describe('the Oathfield', () => {
  it('falls the moment Ostrand dies, and the ground opens again', () => {
    const { sim, o } = duel();
    const walker = sim.addChampion(1 as TeamId, { x: 75, z: 64 }, 'vesk');
    expect(sim.castAbility(o.id, 'R', C)).toBe(true);
    expect(sim.walls.size).toBe(16);
    sim.tick();
    dealDamage(ctxOf(sim), 0, o, 99999, 'true');
    sim.tick();
    sim.tick();
    expect(o.dead).toBe(true);
    expect(sim.walls.size).toBe(0);
    sim.orderMove(walker.id, 75, 76);
    for (let i = 0; i < 80; i++) sim.tick();
    expect(dist(walker.pos, C)).toBeLessThan(2);
  });

  it('stands its time when someone else dies inside it', () => {
    const { sim, o, e } = duel();
    expect(sim.castAbility(o.id, 'R', C)).toBe(true);
    sim.tick();
    dealDamage(ctxOf(sim), 0, e, 99999, 'true');
    sim.tick();
    sim.tick();
    expect(e.dead).toBe(true);
    expect(sim.walls.size).toBe(16);
  });
});

describe("an Ostrand bot's charge at the Sworn", () => {
  function thrown(): { sim: Sim; o: Unit; e: Unit } {
    const sim = new Sim(41);
    const o = sim.addChampion(0 as TeamId, C, 'ostrand');
    ready(o);
    const e = sim.addChampion(1 as TeamId, { x: 82, z: 75 }, 'torv');
    ready(e);
    expect(sim.castAbility(o.id, 'E', { x: 82, z: 75 })).toBe(true);
    for (let i = 0; i < 8; i++) sim.tick();
    o.cooldowns.Q = o.cooldowns.W = o.cooldowns.R = sim.time + 30;
    return { sim, o, e };
  }

  it('charges when it is the healthier', () => {
    const { sim, o, e } = thrown();
    e.hp = e.maxHp * 0.6;
    const action = act(sim, o.id);
    expect(action.kind === 'cast' && action.key).toBe('E');
  });

  it('does not charge in a duel it is behind in', () => {
    const { sim, o } = thrown();
    o.hp = o.maxHp * 0.6;
    const action = act(sim, o.id);
    expect(action.kind === 'cast' && action.key === 'E').toBe(false);
  });
});
