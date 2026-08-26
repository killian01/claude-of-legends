// Skins gate: cosmetic only, every champion covered, carried across the
// wire in the identity block, and never visible to Policies.

import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../server/snapshot';
import { ClientWorld } from '../src/net/client_world';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { clampSkin, SKINS } from '../src/sim/content/skins';
import { buildObservation } from '../src/sim/observe';
import { Sim } from '../src/sim/sim';

describe('skin content', () => {
  it('every champion has at least three skins, default first, unique names', () => {
    for (const c of CHAMPION_LIST) {
      const list = SKINS[c.id];
      expect(list, c.id).toBeDefined();
      expect(list!.length, c.id).toBeGreaterThanOrEqual(3);
      expect(list![0]!.body, `${c.id} default body`).toBeNull();
      const names = list!.map((s) => s.name);
      expect(new Set(names).size, `${c.id} skin names`).toBe(names.length);
    }
  });

  it('clampSkin rejects out-of-range and junk indices', () => {
    expect(clampSkin('korrath', 1)).toBe(1);
    expect(clampSkin('korrath', 99)).toBe(0);
    expect(clampSkin('korrath', -1)).toBe(0);
    expect(clampSkin('korrath', 1.5)).toBe(0);
    expect(clampSkin('korrath', 'x')).toBe(0);
    expect(clampSkin('nobody', 1)).toBe(0);
  });
});

describe('skins in the sim and on the wire', () => {
  it('addChampion stores the clamped skin', () => {
    const sim = new Sim(5);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'vesk', 2);
    const b = sim.addChampion(0, { x: 77, z: 75 }, 'vesk', 99);
    expect(a.skin).toBe(2);
    expect(b.skin).toBe(0);
  });

  it('the snapshot ships the skin once, in the identity block', () => {
    const sim = new Sim(5);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'rhoka', 1);
    const known = new Set<number>();
    const first = buildSnapshot(sim, 0, a.id, known, []);
    if (first.t !== 'snap') throw new Error('expected snap');
    const firstRow = first.units.find((u) => u.i === a.id)!;
    expect(firstRow.sk).toBe(1);
    const second = buildSnapshot(sim, 0, a.id, known, []);
    if (second.t !== 'snap') throw new Error('expected snap');
    const secondRow = second.units.find((u) => u.i === a.id)!;
    expect(secondRow.sk).toBeUndefined();
  });

  it('the client mirror applies the skin', () => {
    const world = new ClientWorld(() => undefined);
    world.applyServer({
      t: 'snap',
      time: 1,
      units: [{ i: 9, x: 10, z: 10, h: 100, m: 100, k: 'champion', t: 0, c: 'maera', sk: 2 }],
      gone: [],
      projectiles: [],
      zones: [],
      self: null,
      events: [],
      winner: null,
    });
    expect(world.units.get(9)!.skin).toBe(2);
  });

  it('the Policy observation never exposes the skin', () => {
    const sim = new Sim(5);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'torv', 1);
    const obs = buildObservation(sim, a.id)!;
    expect('skin' in obs.self).toBe(false);
    for (const u of obs.units) expect('skin' in u).toBe(false);
  });
});
