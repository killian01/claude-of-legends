// The Clamors (CONTEXT.md: Clamor): a champion's takedown rings out where
// the victim fell, for CLAMOR_S, heard by every seat in the observation
// and on the wire (the cl block, sent the tick it changes). A fall nobody
// landed rings nothing, and a Clamor moves no rule: the rng and the units
// stay as they were.

import { describe, expect, it } from 'vitest';
import { CLAMOR_SEND_M } from '../server/royale_snapshot_blocks';
import type { Vec3 } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { noteClamor } from '../src/sim/royale/clamors';
import { CLAMOR_S, DROP_S } from '../src/sim/royale/types';
import { fakeSnap, landed } from './royale_contract_fixture';
import { near, spot } from './royale_fake';

const r2 = (n: number): number => Math.round(n * 100) / 100;

describe('a Clamor in the sim', () => {
  it('rings at the victim of a takedown, at the time it fell', () => {
    const { sim, unitIds } = landed('one_life');
    const victim = sim.units.get(unitIds[1]!)!;
    const at = { ...victim.pos };
    sim.royaleMode!.onDeath(sim, victim, unitIds[0]!, false);
    expect(sim.royale!.clamors).toEqual([{ pos: at, at: sim.time }]);
  });

  it('rings nothing for a fall nobody landed', () => {
    const { sim, unitIds } = landed('one_life');
    const victim = sim.units.get(unitIds[1]!)!;
    sim.royaleMode!.onDeath(sim, victim, 0, false);
    sim.royaleMode!.onDeath(sim, victim, victim.id, false);
    expect(sim.royale!.clamors).toEqual([]);
  });

  it(`lives ${CLAMOR_S} s, then falls silent`, () => {
    const { sim, unitIds } = landed('respawn');
    const victim = sim.units.get(unitIds[2]!)!;
    sim.royaleMode!.onDeath(sim, victim, unitIds[0]!, false);
    const rang = sim.time;
    while (sim.time < rang + CLAMOR_S - 0.06) sim.tick();
    expect(sim.royale!.clamors).toHaveLength(1);
    while (sim.time < rang + CLAMOR_S + 1e-6) sim.tick();
    expect(sim.royale!.clamors).toEqual([]);
  });

  it('is public: every seat observes it, near or far', () => {
    const { sim, unitIds } = landed('one_life');
    const victim = sim.units.get(unitIds[1]!)!;
    sim.royaleMode!.onDeath(sim, victim, unitIds[0]!, false);
    for (const id of unitIds) {
      const obs = buildObservation(sim, id)!;
      expect(obs.royale!.clamors).toEqual([
        { x: victim.pos.x, y: victim.pos.y, z: victim.pos.z, at: sim.time },
      ]);
    }
  });

  it('observes an empty list when nothing rings', () => {
    const { sim, unitIds } = landed();
    expect(buildObservation(sim, unitIds[0]!)!.royale!.clamors).toEqual([]);
  });

  it('draws no rng and moves no unit', () => {
    const { sim, unitIds } = landed('one_life');
    const victim = sim.units.get(unitIds[1]!)!;
    const killer = sim.units.get(unitIds[0]!)!;
    const rng = sim.rng.state;
    const units = JSON.stringify([...sim.units.values()].map((u) => [u.pos, u.hp, u.items]));
    noteClamor(sim.royaleMode!, sim, victim, killer);
    expect(sim.rng.state).toBe(rng);
    expect(JSON.stringify([...sim.units.values()].map((u) => [u.pos, u.hp, u.items]))).toBe(units);
    expect(sim.royale!.clamors).toHaveLength(1);
  });
});

describe('the cl block', () => {
  it('is sent the tick the Clamors change, and not between', () => {
    const { sim, self, snap } = fakeSnap();
    const here = self.pos as Vec3;
    // None through the drop.
    expect(snap().royale).not.toHaveProperty('cl');
    sim.royale.stage = 'play';
    sim.time = DROP_S + 5;
    // The first play snapshot tells the empty list once.
    expect(snap().royale!.cl).toEqual([]);
    expect(snap().royale).not.toHaveProperty('cl');
    const p = near(here, 20);
    sim.royale.clamors.push({ pos: p, at: sim.time });
    expect(snap().royale!.cl).toEqual([[r2(p.x), r2(p.y), r2(p.z), r2(sim.time)]]);
    sim.time += 0.05;
    expect(snap().royale).not.toHaveProperty('cl');
    // A second one: the whole list again.
    sim.royale.clamors.push({ pos: near(here, 30), at: sim.time });
    expect(snap().royale!.cl).toHaveLength(2);
    // Gone silent: the empty list, once.
    sim.royale.clamors = [];
    sim.time += CLAMOR_S;
    expect(snap().royale!.cl).toEqual([]);
    expect(snap().royale).not.toHaveProperty('cl');
  });

  it('reaches a viewer who cannot see the fight, within hearing of it', () => {
    const { sim, self, snap } = fakeSnap();
    sim.royale.stage = 'play';
    sim.time = DROP_S + 5;
    // Out of sight (the fake's sight is 12 m) and well within reach.
    const off = near(self.pos as Vec3, 40);
    sim.royale.clamors.push({ pos: off, at: sim.time });
    expect(snap().royale!.cl).toEqual([[r2(off.x), r2(off.y), r2(off.z), r2(sim.time)]]);
  });

  it(`leaves out a Clamor past ${CLAMOR_SEND_M} m, which no screen there can use`, () => {
    const { sim, self, snap } = fakeSnap();
    sim.royale.stage = 'play';
    sim.time = DROP_S + 5;
    const p = self.pos as Vec3;
    const q = spot(2, 4);
    expect(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z)).toBeGreaterThan(CLAMOR_SEND_M);
    sim.royale.clamors.push({ pos: q, at: sim.time });
    expect(snap().royale!.cl).toEqual([]);
    // Every seat's observation keeps it all the same: the bound is the wire's.
    expect(sim.royale.clamors).toHaveLength(1);
  });
});
