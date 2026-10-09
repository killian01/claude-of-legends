// The house bots and Nisk in the 5v5, through the same observation and
// budget as a person (ADR 0002, ADR 0003): a Nisk bot plants its pods at
// an enemy in a fight, and a bot never sees a pod or a lurker it could not
// see as a person (the bots against pods and the fumble in general are
// tests/bots_pods.test.ts).

import { describe, expect, it } from 'vitest';
import { LANER } from '../src/sim/content/bots/laner';
import { hypot } from '../src/sim/exact';
import { buildObservation } from '../src/sim/observe';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { DT, type TeamId } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

function ready(u: Unit): void {
  u.skillPoints = 0;
  u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  u.level = 6;
}

function act(sim: Sim, unitId: number): ReturnType<typeof LANER.policy> {
  sim.tick();
  const obs = buildObservation(sim, unitId);
  if (!obs) throw new Error('no observation');
  return LANER.policy(obs, new Rng(3));
}

describe('a Nisk bot', () => {
  it('plants a pod at an enemy champion in reach, with a charge in store', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'nisk');
    ready(a);
    const b = sim.addChampion(1, { x: 79, z: 75 }, 'sylra');
    ready(b);
    const action = act(sim, a.id);
    expect(action.kind).toBe('cast');
    if (action.kind === 'cast') {
      expect(action.key).toBe('R');
      expect(hypot(action.x - b.pos.x, action.z - b.pos.z)).toBeLessThan(1.5);
    }
    // With the store spent it fights with the rest of its kit.
    a.charges.R = { count: 0, nextAt: sim.time + 30 };
    const next = act(sim, a.id);
    if (next.kind === 'cast') expect(next.key).not.toBe('R');
  });

  it('is never seen by an enemy bot while it lurks, and neither are its pods', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'nisk');
    ready(a);
    const b = sim.addChampion(1, { x: 84, z: 75 }, 'vesk');
    ready(b);
    sim.tick();
    expect(sim.castAbility(a.id, 'R', { x: 79, z: 75 })).toBe(true);
    sim.orderStop(a.id);
    sim.orderStop(b.id);
    for (let i = 0; i < Math.ceil(1.7 / DT); i++) sim.tick();
    const obs = buildObservation(sim, b.id)!;
    expect(obs.units.some((u) => u.id === a.id)).toBe(false);
    expect((obs.zones ?? []).length).toBe(0);
    // Its memory knows where it last stood, as a person's would.
    expect((obs.lastSeen ?? []).some((l) => l.id === a.id)).toBe(true);
  });
});

describe('a bot facing Nisk', () => {
  it('reads the fumble on the enemy it struck, as every viewer does', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0 as TeamId, { x: 75, z: 75 }, 'nisk');
    ready(a);
    const b = sim.addChampion(1 as TeamId, { x: 81, z: 75 }, 'vesk');
    ready(b);
    sim.tick();
    expect(sim.castAbility(a.id, 'Q', { x: 81, z: 75 })).toBe(true);
    let seen = false;
    for (let i = 0; i < 20 && !seen; i++) {
      sim.tick();
      const obs = buildObservation(sim, a.id)!;
      seen = obs.units.some((u) => u.id === b.id && u.statuses?.some((s) => s.kind === 'fumble'));
    }
    expect(seen).toBe(true);
  });
});
