// The death timer curve. It scales with GAME TIME first, the design doc's
// promise: an early death costs a wave, a late one costs your team the map,
// whatever level the victim reached. The old curve scaled with level alone,
// so a mid-level death at minute 20 still cost under 20 s and winning a
// fight never opened the map.

import { describe, expect, it } from 'vitest';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { respawnDelay } from '../src/sim/respawn';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/stats';
import { DT } from '../src/sim/types';

describe('the respawn delay', () => {
  it('keeps an early death cheap', () => {
    expect(respawnDelay(1, 0)).toBeCloseTo(6.4, 5);
    expect(respawnDelay(3, 60)).toBeLessThan(10);
  });

  it('scales with the game clock at a fixed level', () => {
    const early = respawnDelay(9, 5 * 60);
    const mid = respawnDelay(9, 10 * 60);
    const late = respawnDelay(9, 20 * 60);
    expect(mid).toBeGreaterThan(early + 5);
    expect(late).toBeGreaterThan(mid + 10);
  });

  it('still charges extra for the victim level, so the fed carry waits longer', () => {
    expect(respawnDelay(18, 600)).toBeGreaterThan(respawnDelay(6, 600) + 3);
  });

  it('makes a late death cost most of a minute, capped under one', () => {
    expect(respawnDelay(18, 22 * 60)).toBeGreaterThan(45);
    expect(respawnDelay(18, 60 * 60)).toBeLessThanOrEqual(55);
  });

  it('clamps outside the valid ranges rather than going negative or wild', () => {
    expect(respawnDelay(0, 100)).toBe(respawnDelay(1, 100));
    expect(respawnDelay(MAX_LEVEL + 5, 100)).toBe(respawnDelay(MAX_LEVEL, 100));
    expect(respawnDelay(3, -50)).toBe(respawnDelay(3, 0));
  });

  it('is what the sim actually puts on a corpse', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 }, CHAMPION_LIST[0]!.id);
    const b = sim.addChampion(1, { x: 78, z: 75 }, CHAMPION_LIST[1]!.id);
    b.level = 12;
    b.hp = 1;
    sim.orderAttack(a.id, b.id);
    for (let i = 0; i < 100 && !b.dead; i++) sim.tick();
    expect(b.dead).toBe(true);
    // The clock is stamped during the tick that kills, so by the time the
    // loop sees the corpse one tick of it has already run off (and the
    // clock read now is a fraction later than the one stamped).
    const left = b.respawnAt - sim.time;
    expect(left).toBeLessThanOrEqual(respawnDelay(12, sim.time));
    expect(left).toBeGreaterThan(respawnDelay(12, sim.time) - DT - 0.01);
  });
});
