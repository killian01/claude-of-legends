// Movement gate: a champion ordered across the map arrives, stays on walkable
// ground, and two identical sims move identically.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';

describe('movement', () => {
  it('walks a champion from its fountain to mid and arrives on time', () => {
    const sim = new Sim(7);
    const champ = sim.addChampion(0);
    sim.orderMove(champ.id, 75, 75);
    const straight = Math.hypot(75 - champ.pos.x, 75 - champ.pos.z);
    const maxTicks = Math.ceil((straight / champ.moveSpeed / DT) * 2);
    let arrived = -1;
    for (let i = 0; i < maxTicks; i++) {
      sim.tick();
      expect(sim.nav.isWalkableAt(champ.pos.x, champ.pos.z)).toBe(true);
      if (champ.path.length === 0) {
        arrived = i;
        break;
      }
    }
    expect(arrived).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(champ.pos.x - 75, champ.pos.z - 75)).toBeLessThan(0.1);
  });

  it('ignores move orders for immobile units', () => {
    const sim = new Sim(7);
    const tower = [...sim.units.values()].find((u) => u.kind === 'tower');
    expect(tower).toBeDefined();
    if (!tower) return;
    const before = { ...tower.pos };
    sim.orderMove(tower.id, 75, 75);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(tower.pos).toEqual(before);
  });

  it('moves identically in two sims with the same seed and orders', () => {
    const run = () => {
      const sim = new Sim(99);
      const a = sim.addChampion(0);
      const b = sim.addChampion(1);
      sim.orderMove(a.id, 110, 40);
      sim.orderMove(b.id, 40, 110);
      const trace: number[] = [];
      for (let i = 0; i < 400; i++) {
        sim.tick();
        trace.push(a.pos.x, a.pos.z, b.pos.x, b.pos.z);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
