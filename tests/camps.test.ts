// Jungle camps gate: mirrored walkable spots spawn neutral monsters on the
// opening clock, they sit in the FOG for both teams (unlike the Warden),
// pay gold and a respawn clock on death, the buff camp grants its killer an
// attack speed buff, and minions never fight them.

import { describe, expect, it } from 'vitest';
import { CAMP_BUFF_AS_PCT, CAMP_FIRST_SPAWN_S, CAMP_RESPAWN_S } from '../src/sim/camps';
import { attackSpeedBonusPct } from '../src/sim/combat/status';
import { GAME_MAP } from '../src/sim/content/map';
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

describe('jungle camps', () => {
  it('spawns six neutral monsters on mirrored walkable spots', () => {
    const sim = new Sim(11);
    expect(GAME_MAP.camps).toHaveLength(6);
    for (const spot of GAME_MAP.camps) {
      expect(sim.nav.isWalkableAt(spot.x, spot.z), `camp ${spot.x},${spot.z}`).toBe(true);
      const mirror = GAME_MAP.camps.find(
        (c) =>
          Math.abs(c.x - (GAME_MAP.size - spot.x)) < 0.01 &&
          Math.abs(c.z - (GAME_MAP.size - spot.z)) < 0.01,
      );
      expect(mirror, `mirror of ${spot.x},${spot.z}`).toBeDefined();
    }
    const spawned = runToCamps(sim);
    expect(spawned).toHaveLength(6);
    expect(spawned.every((c) => c.neutral)).toBe(true);
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

  it('pays gold, schedules a respawn, and the buff camp grants attack speed', () => {
    const sim = new Sim(11);
    const spawned = runToCamps(sim);
    const buffSpot = GAME_MAP.camps.find((c) => c.buff)!;
    const camp = spawned.find((c) => Math.hypot(c.pos.x - buffSpot.x, c.pos.z - buffSpot.z) < 1)!;
    const slayer = sim.addChampion(0, { x: camp.pos.x + 2, z: camp.pos.z });
    const goldBefore = slayer.gold;
    camp.hp = 1;
    camp.lastDamagedAt = sim.time;
    sim.orderAttack(slayer.id, camp.id);
    for (let i = 0; i < 100 && sim.units.has(camp.id); i++) sim.tick();
    expect(sim.units.has(camp.id)).toBe(false);
    expect(slayer.gold - goldBefore).toBeGreaterThanOrEqual(80);
    expect(attackSpeedBonusPct(slayer, sim.time)).toBeCloseTo(CAMP_BUFF_AS_PCT, 5);
    // The cleared camp comes back on its clock.
    for (let i = 0; i < (CAMP_RESPAWN_S + 2) * TICKS_PER_S; i++) sim.tick();
    const back = camps(sim).find((c) => Math.hypot(c.pos.x - buffSpot.x, c.pos.z - buffSpot.z) < 1);
    expect(back).toBeDefined();
  });

  it('resets to full when the attacker walks away', () => {
    const sim = new Sim(11);
    const camp = runToCamps(sim)[0]!;
    camp.hp = camp.maxHp - 300;
    camp.lastDamagedAt = sim.time;
    for (let i = 0; i < 8 * TICKS_PER_S; i++) sim.tick();
    expect(camp.hp).toBe(camp.maxHp);
  });
});
