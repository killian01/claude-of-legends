// The death timer curve. The complaint it answers: at the old flat ramp a
// level 18 death was 29 s, short enough that throwing yourself at a fight
// cost your team nothing, so dying carried no real disadvantage late.

import { describe, expect, it } from 'vitest';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { respawnDelay } from '../src/sim/respawn';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/stats';
import { DT } from '../src/sim/types';

describe('the respawn delay', () => {
  it('leaves the early game where the pacing review put it', () => {
    // Levels 1 to 6 are unchanged from the old base + 1.3 per level ramp.
    expect(respawnDelay(1)).toBeCloseTo(6.8, 5);
    expect(respawnDelay(6)).toBeCloseTo(13.8, 5);
  });

  it('accelerates, so each level costs more than the one before it', () => {
    for (let l = 2; l <= MAX_LEVEL; l++) {
      const step = respawnDelay(l) - respawnDelay(l - 1);
      const prev = respawnDelay(l - 1) - respawnDelay(l - 2 < 1 ? 1 : l - 2);
      expect(step).toBeGreaterThan(0);
      if (l > 2) expect(step).toBeGreaterThan(prev);
    }
  });

  it('makes a late death cost most of a minute', () => {
    expect(respawnDelay(MAX_LEVEL)).toBeGreaterThan(45);
    // Still under a full minute: a mini MOBA, not a 40 minute one.
    expect(respawnDelay(MAX_LEVEL)).toBeLessThan(60);
  });

  it('clamps outside the level range rather than going negative or wild', () => {
    expect(respawnDelay(0)).toBe(respawnDelay(1));
    expect(respawnDelay(MAX_LEVEL + 5)).toBe(respawnDelay(MAX_LEVEL));
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
    // loop sees the corpse one tick of it has already run off.
    const left = b.respawnAt - sim.time;
    expect(left).toBeLessThanOrEqual(respawnDelay(12));
    expect(left).toBeGreaterThan(respawnDelay(12) - DT - 1e-9);
  });
});
