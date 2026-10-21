// Ostrand, the Pledgeblade, through the Sim (docs/design/ostrand.md, slice
// 2): the release switch that keeps him out of every pick, the Sworn his
// hits name and his gauntlet takes, Lance Drive's harder slow on it, and the
// Oathfield: refused with nobody in reach, a closed ring that keeps each
// unit on its own side, stops a walk and a traveling dash at the rim alike
// for a person and a bot, and opens again when it falls.

import { describe, expect, it } from 'vitest';
import { slowPct } from '../src/sim/combat/status';
import { CHAMPION_LIST, CHAMPIONS, UNRELEASED_CHAMPIONS } from '../src/sim/content/champions';
import { SWORN_DAMAGE_PCT } from '../src/sim/content/champions/ostrand';
import { dist } from '../src/sim/geo';
import { passiveOf } from '../src/sim/passives';
import { Sim } from '../src/sim/sim';
import { isSwornBy, swornOf } from '../src/sim/sworn';
import type { TeamId, Vec2 } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

const C: Vec2 = { x: 75, z: 75 };

function arena(seed = 41): { sim: Sim; o: Unit } {
  const sim = new Sim(seed);
  const o = sim.addChampion(0 as TeamId, C, 'ostrand');
  o.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  o.level = 6;
  o.mana = o.maxMana;
  return { sim, o };
}

function enemy(sim: Sim, at: Vec2, id = 'torv'): Unit {
  const u = sim.addChampion(1 as TeamId, at, id);
  u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  u.level = 6;
  return u;
}

function ticks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

type Ctx = Parameters<typeof swornOf>[0];
const ctxOf = (sim: Sim): Ctx => (sim as unknown as { ctx(): Ctx }).ctx();

describe('the release switch', () => {
  it('keeps Ostrand out of every pick while the Sim can still field him', () => {
    expect(CHAMPION_LIST.some((c) => c.id === 'ostrand')).toBe(false);
    expect(CHAMPIONS.ostrand).toBeUndefined();
    expect(UNRELEASED_CHAMPIONS.ostrand?.released).toBe(false);
    for (const c of CHAMPION_LIST) expect(c.released).not.toBe(false);
    const { o } = arena();
    expect(o.championId).toBe('ostrand');
  });
});

describe('the Sworn', () => {
  it('is the first enemy champion he damages, and another hit does not take it', () => {
    const { sim, o } = arena();
    const a = enemy(sim, { x: 77, z: 75 });
    const b = enemy(sim, { x: 75, z: 77 }, 'vesk');
    const passive = passiveOf(o)!;
    const ctx = ctxOf(sim);
    passive.modifyDamage!(ctx, o, a, 100, 'physical', 'attack');
    expect(swornOf(ctx, o)?.id).toBe(a.id);
    const onB = passive.modifyDamage!(ctx, o, b, 100, 'physical', 'attack');
    expect(onB).toBe(100);
    expect(swornOf(ctx, o)?.id).toBe(a.id);
    expect(passive.modifyDamage!(ctx, o, a, 100, 'physical', 'attack')).toBeCloseTo(
      100 * (1 + SWORN_DAMAGE_PCT),
    );
  });

  it('lapses after eight seconds without a hit, and Gauntlet Throw takes it over', () => {
    const { sim, o } = arena();
    const a = enemy(sim, { x: 79, z: 75 });
    const b = enemy(sim, { x: 82, z: 75 }, 'vesk');
    passiveOf(o)!.modifyDamage!(ctxOf(sim), o, b, 10, 'physical', 'attack');
    expect(isSwornBy(b, o.id, sim.time)).toBe(true);
    expect(sim.castAbility(o.id, 'E', { x: 85, z: 75 })).toBe(true);
    ticks(sim, 10);
    expect(isSwornBy(a, o.id, sim.time)).toBe(true);
    expect(isSwornBy(b, o.id, sim.time)).toBe(false);
    ticks(sim, 8 * 20 + 2);
    expect(swornOf(ctxOf(sim), o)).toBeNull();
  });

  it('heals him and refreshes Lance Drive when it falls, and only then', () => {
    const { sim, o } = arena();
    const a = enemy(sim, { x: 77, z: 75 });
    const b = enemy(sim, { x: 75, z: 77 }, 'vesk');
    const passive = passiveOf(o)!;
    const ctx = ctxOf(sim);
    passive.modifyDamage!(ctx, o, a, 10, 'physical', 'attack');
    o.hp = o.maxHp / 2;
    o.cooldowns.Q = sim.time + 5;
    passive.onTakedown!(ctx, o, b);
    expect(o.hp).toBe(o.maxHp / 2);
    passive.onTakedown!(ctx, o, a);
    expect(o.hp).toBeCloseTo(o.maxHp / 2 + (o.maxHp / 2) * 0.12);
    expect(o.cooldowns.Q).toBe(sim.time);
  });

  it('is slowed harder by Lance Drive than anyone else on the line', () => {
    const { sim, o } = arena();
    const a = enemy(sim, { x: 77, z: 75 });
    const b = enemy(sim, { x: 78.5, z: 75 }, 'vesk');
    passiveOf(o)!.modifyDamage!(ctxOf(sim), o, a, 10, 'physical', 'attack');
    expect(sim.castAbility(o.id, 'Q', { x: 80, z: 75 })).toBe(true);
    ticks(sim, 4);
    expect(slowPct(a, sim.time)).toBeCloseTo(0.4);
    expect(slowPct(b, sim.time)).toBeCloseTo(0.25);
  });
});

describe('the Oathfield', () => {
  it('is refused with no enemy champion in reach, and nothing is paid', () => {
    const { sim, o } = arena();
    enemy(sim, { x: 82, z: 75 });
    const mana = o.mana;
    expect(sim.castAbility(o.id, 'R', C)).toBe(false);
    expect(o.mana).toBe(mana);
    expect(sim.walls.size).toBe(0);
  });

  it('swears the nearest enemy, rises closed, and keeps each unit on its side', () => {
    const { sim, o } = arena();
    const near = enemy(sim, { x: 78, z: 75 });
    // Two units standing on the rim, one just inside it and one just out.
    const rimIn = enemy(sim, { x: 75, z: 79.6 }, 'vesk');
    const rimOut = enemy(sim, { x: 75, z: 69.6 }, 'dain');
    expect(sim.castAbility(o.id, 'R', C)).toBe(true);
    expect(sim.walls.size).toBe(16);
    expect(isSwornBy(near, o.id, sim.time)).toBe(true);
    expect(dist(rimIn.pos, C)).toBeLessThan(5);
    expect(dist(rimOut.pos, C)).toBeGreaterThan(5);
    const ground = (sim as unknown as { ground: { lineOfWalk(a: Vec2, b: Vec2): boolean } }).ground;
    for (const p of [rimIn, rimOut, near]) {
      expect(ground.lineOfWalk(p.pos, C)).toBe(dist(p.pos, C) < 5);
    }
  });

  it('stops a person or a bot walking in at the rim, and the flight of a dash', () => {
    const { sim, o } = arena();
    enemy(sim, { x: 78, z: 75 });
    const walker = enemy(sim, { x: 75, z: 64 }, 'vesk');
    const leaper = enemy(sim, { x: 66, z: 75 }, 'korrath');
    // A champion of Ostrand's own side chasing the Sworn inside, the way
    // a bot's attack order chases: the chase also ends at the stone.
    const chaser = sim.addChampion(0 as TeamId, { x: 86, z: 75 }, 'torv');
    expect(sim.castAbility(o.id, 'R', C)).toBe(true);
    sim.orderMove(walker.id, 75, 76);
    sim.orderAttack(
      chaser.id,
      [...sim.units.values()].find((u) => isSwornBy(u, o.id, sim.time))!.id,
    );
    // Korrath's Earthbreak is a traveling leap of 7 straight at the ring.
    sim.castAbility(leaper.id, 'R', { x: 73, z: 75 });
    ticks(sim, 60);
    expect(dist(walker.pos, C)).toBeGreaterThan(5);
    expect(dist(walker.pos, C)).toBeLessThan(8);
    expect(dist(leaper.pos, C)).toBeGreaterThan(5);
    expect(dist(chaser.pos, C)).toBeGreaterThan(5);
    expect(dist(chaser.pos, C)).toBeLessThan(8);
    // The walk ended at the rim instead of pacing along it.
    const at = { ...walker.pos };
    ticks(sim, 20);
    expect(dist(walker.pos, at)).toBeLessThan(0.5);
  });

  it('falls after four seconds and the ground opens again', () => {
    const { sim, o } = arena();
    enemy(sim, { x: 78, z: 75 });
    const walker = enemy(sim, { x: 75, z: 64 }, 'vesk');
    expect(sim.castAbility(o.id, 'R', C)).toBe(true);
    ticks(sim, 4 * 20 + 2);
    expect(sim.walls.size).toBe(0);
    sim.orderMove(walker.id, 75, 76);
    ticks(sim, 80);
    expect(dist(walker.pos, C)).toBeLessThan(2);
  });
});
