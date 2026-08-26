// Control-feel gate from the player review: the stop order (S) holds a
// champion out of idle auto-defense until the next real order, and bots get
// distinct lane assignments so the ten participants stop flocking.

import { describe, expect, it } from 'vitest';
import { BOTS, DEFAULT_BOT_ID } from '../src/sim/content/bots';
import { Sim } from '../src/sim/sim';

describe('the stop order', () => {
  it('holds: no idle auto-attack until the next order clears it', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    sim.addChampion(1, { x: 77, z: 75 });
    sim.orderStop(a.id);
    for (let i = 0; i < 30; i++) sim.tick();
    expect(a.attackTargetId).toBeNull();
    expect(a.holding).toBe(true);
    // Any real order releases the hold; idle defense re-engages after.
    sim.orderMove(a.id, 75, 75);
    expect(a.holding).toBe(false);
    for (let i = 0; i < 30; i++) sim.tick();
    expect(a.attackTargetId).not.toBeNull();
  });

  it('clears the current path and attack order', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    sim.orderMove(a.id, 90, 90);
    expect(a.path.length).toBeGreaterThan(0);
    sim.orderStop(a.id);
    expect(a.path).toHaveLength(0);
  });
});

describe('bot lane assignment', () => {
  it('spreads a team of bots across the three lanes', () => {
    const sim = new Sim(11);
    const lanes: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      const u = sim.addChampion(0);
      sim.attachPolicy(u.id, BOTS[DEFAULT_BOT_ID]!.policy);
      lanes.push(u.lane);
    }
    expect(new Set(lanes).size).toBe(3);
    expect(lanes).toContain('mid');
    expect(lanes).toContain('top');
    expect(lanes).toContain('bot');
  });

  it('assigned bots leave the fountain toward THEIR lane, not one shared lane', () => {
    const sim = new Sim(11);
    const bots = [];
    for (let i = 0; i < 3; i++) {
      const u = sim.addChampion(0);
      sim.attachPolicy(u.id, BOTS[DEFAULT_BOT_ID]!.policy);
      bots.push(u);
    }
    for (let i = 0; i < 30 * 20; i++) sim.tick();
    // After 30 s the three bots stand meaningfully apart.
    const spread =
      Math.hypot(bots[0]!.pos.x - bots[1]!.pos.x, bots[0]!.pos.z - bots[1]!.pos.z) +
      Math.hypot(bots[1]!.pos.x - bots[2]!.pos.x, bots[1]!.pos.z - bots[2]!.pos.z);
    expect(spread).toBeGreaterThan(40);
  });
});
