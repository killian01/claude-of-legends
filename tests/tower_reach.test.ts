// The tower reach ring (src/render/tower_reach.ts): drawn around an enemy
// tower as the viewer's own champion comes near, at the distance the
// tower's fire starts for that champion, flashing on each shot at it.

import { describe, expect, it } from 'vitest';
import {
  flashLevel,
  REACH_FLASH_MS,
  REACH_SHOW_MARGIN,
  type ReachTower,
  reachRadius,
  reachRings,
  reachStrength,
} from '../src/render/tower_reach';
import { Sim } from '../src/sim/sim';
import { TOWER_ATTACK_RANGE, TOWER_RADIUS } from '../src/sim/unit';

const tower = (id: number, team: number, x: number, z: number, dead = false): ReachTower => ({
  id,
  kind: 'tower',
  team,
  pos: { x, z },
  radius: TOWER_RADIUS,
  dead,
  stats: { attackRange: TOWER_ATTACK_RANGE },
});

describe('the tower reach ring', () => {
  it('sits where the tower fires on the champion, from the sim or its content', () => {
    expect(reachRadius(tower(1, 1, 0, 0), 0.6)).toBeCloseTo(
      TOWER_RADIUS + TOWER_ATTACK_RANGE + 0.6,
    );
    // A mirror that never heard the numbers falls back on the sim's.
    expect(reachRadius({ radius: 0, stats: { attackRange: 0 } }, 0.5)).toBeCloseTo(
      TOWER_RADIUS + TOWER_ATTACK_RANGE + 0.5,
    );
    // And the sim's tower carries the same numbers the ring reads.
    const sim = new Sim(1);
    const t = [...sim.units.values()].find((u) => u.kind === 'tower')!;
    expect(t.radius).toBe(TOWER_RADIUS);
    expect(t.stats.attackRange).toBe(TOWER_ATTACK_RANGE);
  });

  it('fades in over the margin outside the reach and holds full inside', () => {
    expect(reachStrength(5, 11)).toBe(1);
    expect(reachStrength(11, 11)).toBe(1);
    expect(reachStrength(11 + REACH_SHOW_MARGIN / 2, 11)).toBeCloseTo(0.5);
    expect(reachStrength(11 + REACH_SHOW_MARGIN, 11)).toBe(0);
    expect(reachStrength(40, 11)).toBe(0);
  });

  it('flashes on a shot and fades', () => {
    expect(flashLevel(null)).toBe(0);
    expect(flashLevel(0)).toBe(1);
    expect(flashLevel(REACH_FLASH_MS / 2)).toBeCloseTo(0.5);
    expect(flashLevel(REACH_FLASH_MS)).toBe(0);
    expect(flashLevel(-5)).toBe(0);
  });

  it('shows only the live enemy towers the champion is near', () => {
    const self = { team: 0, radius: 0.6, dead: false };
    const units = [
      tower(1, 1, 0, 0),
      tower(2, 0, 3, 0),
      tower(3, 1, 100, 100),
      tower(4, 1, 5, 5, true),
      { ...tower(5, 1, 1, 1), kind: 'minion' },
    ];
    const rings = reachRings(self, { x: 8, z: 0 }, units, new Map([[1, 1000]]), 1100);
    expect(rings.map((r) => r.towerId)).toEqual([1]);
    expect(rings[0]!.strength).toBe(1);
    expect(rings[0]!.flash).toBeCloseTo(1 - 100 / REACH_FLASH_MS);
    expect(rings[0]!.radius).toBeCloseTo(TOWER_RADIUS + TOWER_ATTACK_RANGE + 0.6);
    // Nothing for a dead champion or none at all.
    expect(reachRings({ ...self, dead: true }, { x: 8, z: 0 }, units, new Map(), 0)).toEqual([]);
    expect(reachRings(null, null, units, new Map(), 0)).toEqual([]);
  });
});
