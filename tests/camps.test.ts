// Jungle camps gate: the map's spots each hold a kind of body
// (content/camps.ts): the Spinecrest alone, the Brackenlings three at a
// time, the Barkmaw with its buff; they rise on the opening clock, sit in
// the FOG for both teams (unlike the Warden), pay gold and a respawn
// clock once the last body of a spot falls, grow with the game clock like
// every neutral body, and leave each team a memory of what it saw at a
// spot, the knowledge a jungler routes on (ADR 0023).

import { describe, expect, it } from 'vitest';
import { CAMP_BUFF_AS_PCT, CAMP_FIRST_SPAWN_S, campStands } from '../src/sim/camps';
import { attackSpeedBonusPct } from '../src/sim/combat/status';
import { CAMPS } from '../src/sim/content/camps';
import { GAME_MAP } from '../src/sim/content/map';
import { bodyGrowth } from '../src/sim/content/rings';
import { buildObservation } from '../src/sim/observe';
import { Sim } from '../src/sim/sim';
import type { Unit } from '../src/sim/unit';

const TICKS_PER_S = 20;

function camps(sim: Sim): Unit[] {
  return [...sim.units.values()].filter((u) => u.kind === 'camp');
}

function runToCamps(sim: Sim): Unit[] {
  for (let i = 0; i < (CAMP_FIRST_SPAWN_S + 2) * TICKS_PER_S && camps(sim).length === 0; i++) {
    sim.tick();
  }
  return camps(sim);
}

function bodiesAt(sim: Sim, spot: { x: number; z: number }): Unit[] {
  return camps(sim).filter((c) => Math.hypot(c.pos.x - spot.x, c.pos.z - spot.z) < 4);
}

const spotOf = (kind: keyof typeof CAMPS) => GAME_MAP.camps.find((c) => c.kind === kind)!;

describe('jungle camps', () => {
  it('spawns every kind on mirrored walkable spots: one body, or three for the Brackenlings', () => {
    const sim = new Sim(11);
    expect(GAME_MAP.camps).toHaveLength(6);
    expect(GAME_MAP.camps.filter((c) => c.kind === 'barkmaw')).toHaveLength(2);
    for (const spot of GAME_MAP.camps) {
      expect(sim.nav.isWalkableAt(spot.x, spot.z), `camp ${spot.x},${spot.z}`).toBe(true);
      const mirror = GAME_MAP.camps.find(
        (c) =>
          Math.abs(c.x - (GAME_MAP.size - spot.x)) < 0.01 &&
          Math.abs(c.z - (GAME_MAP.size - spot.z)) < 0.01,
      );
      expect(mirror, `mirror of ${spot.x},${spot.z}`).toBeDefined();
      expect(mirror!.kind).toBe(spot.kind);
    }
    const spawned = runToCamps(sim);
    expect(spawned).toHaveLength(10);
    expect(spawned.every((c) => c.neutral)).toBe(true);
    for (const spot of GAME_MAP.camps) {
      const bodies = bodiesAt(sim, spot);
      expect(bodies, spot.kind).toHaveLength(CAMPS[spot.kind].count);
      for (const b of bodies) {
        expect(b.campKind).toBe(spot.kind);
        expect(b.maxHp).toBe(CAMPS[spot.kind].body.hp);
        expect(b.goldBounty).toBe(CAMPS[spot.kind].goldBounty);
        expect(sim.nav.isWalkableAt(b.pos.x, b.pos.z)).toBe(true);
      }
    }
    // The pack stands a stride apart, never on one point.
    const stands = campStands({ x: 0, z: 0 }, 'brackenlings');
    expect(stands).toHaveLength(3);
    expect(Math.hypot(stands[1]!.x - stands[2]!.x, stands[1]!.z - stands[2]!.z)).toBeGreaterThan(1);
  });

  it('sits in the fog: invisible until a champion walks up', () => {
    const sim = new Sim(11);
    const spawned = runToCamps(sim);
    const camp = spawned[0]!;
    expect(sim.isVisible(0, camp.id)).toBe(false);
    expect(sim.isVisible(1, camp.id)).toBe(false);
    sim.addChampion(0, { x: camp.pos.x + 3, z: camp.pos.z });
    sim.tick();
    expect(sim.isVisible(0, camp.id)).toBe(true);
    expect(sim.isVisible(1, camp.id)).toBe(false);
  });

  it('pays gold, schedules a respawn, and the Barkmaw grants attack speed', () => {
    const sim = new Sim(11);
    runToCamps(sim);
    const spot = spotOf('barkmaw');
    const camp = bodiesAt(sim, spot)[0]!;
    const slayer = sim.addChampion(0, { x: camp.pos.x + 2, z: camp.pos.z });
    const goldBefore = slayer.gold;
    camp.hp = 1;
    camp.lastDamagedAt = sim.time;
    sim.orderAttack(slayer.id, camp.id);
    for (let i = 0; i < 100 && sim.units.has(camp.id); i++) sim.tick();
    expect(sim.units.has(camp.id)).toBe(false);
    expect(slayer.gold - goldBefore).toBeGreaterThanOrEqual(CAMPS.barkmaw.goldBounty);
    expect(attackSpeedBonusPct(slayer, sim.time)).toBeCloseTo(CAMP_BUFF_AS_PCT, 5);
    // The cleared camp comes back on its own clock.
    for (let i = 0; i < (CAMPS.barkmaw.respawnS - 5) * TICKS_PER_S; i++) sim.tick();
    expect(bodiesAt(sim, spot)).toHaveLength(0);
    for (let i = 0; i < 7 * TICKS_PER_S; i++) sim.tick();
    expect(bodiesAt(sim, spot)).toHaveLength(1);
  });

  it('a pack comes back together, once its last body has fallen', () => {
    const sim = new Sim(11);
    runToCamps(sim);
    const spot = spotOf('brackenlings');
    const pack = bodiesAt(sim, spot);
    expect(pack).toHaveLength(3);
    const slayer = sim.addChampion(0, { x: spot.x - 2, z: spot.z });
    const kill = (body: Unit): void => {
      body.hp = 1;
      body.lastDamagedAt = sim.time;
      sim.orderAttack(slayer.id, body.id);
      for (let i = 0; i < 100 && sim.units.has(body.id); i++) sim.tick();
      expect(sim.units.has(body.id)).toBe(false);
    };
    kill(pack[0]!);
    // Two down, one standing: no clock runs while the slayer waits far off.
    kill(pack[1]!);
    slayer.pos = { x: 75, z: 75 };
    for (let i = 0; i < (CAMPS.brackenlings.respawnS + 5) * TICKS_PER_S; i++) sim.tick();
    expect(bodiesAt(sim, spot)).toHaveLength(1);
    slayer.pos = { x: spot.x - 2, z: spot.z };
    slayer.hp = slayer.maxHp;
    kill(pack[2]!);
    for (let i = 0; i < (CAMPS.brackenlings.respawnS + 2) * TICKS_PER_S; i++) sim.tick();
    expect(bodiesAt(sim, spot)).toHaveLength(3);
    expect(attackSpeedBonusPct(slayer, sim.time)).toBe(0);
  });

  it('resets to full when the attacker walks away', () => {
    const sim = new Sim(11);
    const camp = runToCamps(sim)[0]!;
    camp.hp = camp.maxHp - 300;
    camp.lastDamagedAt = sim.time;
    for (let i = 0; i < 8 * TICKS_PER_S; i++) sim.tick();
    expect(camp.hp).toBe(camp.maxHp);
  });

  it('grows with the game clock like every neutral body', () => {
    const late = new Sim(11);
    late.time = 720;
    for (let i = 0; i < 3 && camps(late).length === 0; i++) late.tick();
    const spot = spotOf('spinecrest');
    const body = bodiesAt(late, spot)[0]!;
    expect(body.maxHp).toBe(Math.round(CAMPS.spinecrest.body.hp * bodyGrowth(720)));
    expect(body.maxHp).toBeGreaterThan(CAMPS.spinecrest.body.hp * 1.8);
  });

  it('leaves each team a memory of what it saw at a spot, and nothing it never looked at', () => {
    const sim = new Sim(11);
    runToCamps(sim);
    const spot = spotOf('spinecrest');
    const me = sim.addChampion(0, { x: 75, z: 75 });
    sim.tick();
    const blind = buildObservation(sim, me.id)!;
    const never = blind.camps!.find((c) => c.x === spot.x && c.z === spot.z)!;
    expect(never).toMatchObject({ kind: 'spinecrest', seenAt: null, up: null, downSince: null });
    expect(blind.camps).toHaveLength(6);
    // A look says up.
    me.pos = { x: spot.x + 3, z: spot.z };
    sim.tick();
    const looked = buildObservation(sim, me.id)!.camps!.find((c) => c.x === spot.x)!;
    expect(looked.up).toBe(true);
    expect(looked.seenAt).toBeGreaterThan(sim.time - 0.11);
    expect(looked.downSince).toBeNull();
    // The other team never looked.
    const foe = sim.addChampion(1, { x: 75, z: 75 });
    sim.tick();
    expect(buildObservation(sim, foe.id)!.camps!.find((c) => c.x === spot.x)!.up).toBeNull();
    // Cleared in sight: seen empty since the kill, and still so a while later.
    const body = bodiesAt(sim, spot)[0]!;
    body.hp = 1;
    body.lastDamagedAt = sim.time;
    sim.orderAttack(me.id, body.id);
    for (let i = 0; i < 100 && sim.units.has(body.id); i++) sim.tick();
    const cleared = buildObservation(sim, me.id)!.camps!.find((c) => c.x === spot.x)!;
    expect(cleared.up).toBe(false);
    const since = cleared.downSince!;
    expect(since).toBeCloseTo(sim.time, 0);
    for (let i = 0; i < 3 * TICKS_PER_S; i++) sim.tick();
    const later = buildObservation(sim, me.id)!.camps!.find((c) => c.x === spot.x)!;
    expect(later.downSince).toBe(since);
    expect(later.seenAt).toBeGreaterThan(since + 2);
  });
});
