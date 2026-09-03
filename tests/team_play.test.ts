// Team play in the language (plan-bots phase 10, from scouting round 1: a
// third of the deaths were outnumbered, fights were taken one bot at a
// time, and a retreat gave the lane away): an ally in a fight is a
// trigger, joining it is a behavior, and falling back under one's own
// tower is the alternative to running home.

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../src/sim/observe';
import { runBehavior } from '../src/sim/playbook/behaviors';
import { buildSlotContext, type SlotContext } from '../src/sim/playbook/micro';
import { holds } from '../src/sim/playbook/triggers';
import { validatePlaybook } from '../src/sim/playbook/validate';
import type { Action } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

function ctxOf(sim: Sim, unitId: number): SlotContext {
  const obs = buildObservation(sim, unitId);
  if (!obs) throw new Error('no observation');
  return buildSlotContext(obs, new Rng(1), undefined);
}

describe('an ally in a fight', () => {
  it('is seen within the radius, joined until beside it, and ignored when nobody fights', () => {
    const sim = new Sim(4);
    // Positions in the open near team 0's side, where the duel tests see
    // each other (a spot in a brush hides the foe from the team).
    const me = sim.addChampion(0, { x: 40, z: 60 }, 'vesk');
    const ally = sim.addChampion(0, { x: 60, z: 60 }, 'korrath');
    const foe = sim.addChampion(1, { x: 63, z: 60 }, 'dain');
    sim.tick();
    const ctx = ctxOf(sim, me.id);
    expect(holds({ kind: 'allyFighting', within: 40 }, ctx)).toBe(true);
    expect(holds({ kind: 'allyFighting', within: 10 }, ctx)).toBe(false);
    const step = runBehavior({ kind: 'joinAlly' }, ctx) as Action;
    expect(step.kind).toBe('move');
    if (step.kind === 'move') expect(step.x).toBeGreaterThan(50);
    expect(runBehavior({ kind: 'joinAlly', within: 10 }, ctx)).toBeNull();
    // Beside the ally already: the turn passes.
    const near = sim.addChampion(0, { x: 58, z: 60 }, 'sylra');
    sim.tick();
    expect(runBehavior({ kind: 'joinAlly' }, ctxOf(sim, near.id))).toBeNull();
    // The fight ends: nobody to join.
    foe.pos.x = 140;
    sim.tick();
    expect(holds({ kind: 'allyFighting', within: 40 }, ctxOf(sim, me.id))).toBe(false);
    expect(runBehavior({ kind: 'joinAlly' }, ctxOf(sim, me.id))).toBeNull();
    expect(ally.id).toBeGreaterThan(0);
  });
});

describe('falling back', () => {
  it('walks to the nearest live allied tower and passes the turn under it', () => {
    const sim = new Sim(4);
    const me = sim.addChampion(0, { x: 120, z: 120 }, 'vesk');
    sim.tick();
    const obs = buildObservation(sim, me.id);
    if (!obs) throw new Error('no observation');
    const towers = obs.units.filter((u) => u.friendly && u.kind === 'tower');
    expect(towers.length).toBeGreaterThan(0);
    const nearest = towers.reduce((a, b) =>
      Math.hypot(a.x - 120, a.z - 120) <= Math.hypot(b.x - 120, b.z - 120) ? a : b,
    );
    const step = runBehavior({ kind: 'fallBack' }, ctxOf(sim, me.id)) as Action;
    expect(step.kind).toBe('move');
    if (step.kind === 'move') {
      expect(Math.hypot(step.x - nearest.x, step.z - nearest.z)).toBeLessThan(3);
    }
    me.pos.x = nearest.x + 1;
    me.pos.z = nearest.z + 1;
    sim.tick();
    expect(runBehavior({ kind: 'fallBack' }, ctxOf(sim, me.id))).toBeNull();
  });

  it('is a play the validator accepts, with the trigger', () => {
    const v = validatePlaybook({
      version: 2,
      plays: [
        {
          id: 'join',
          when: { kind: 'allyFighting', within: 40 },
          do: { kind: 'joinAlly', within: 60 },
        },
        { id: 'back', when: { kind: 'always' }, do: { kind: 'fallBack' } },
      ],
    });
    expect(v.ok).toBe(true);
    const bad = validatePlaybook({
      version: 2,
      plays: [{ id: 'join', when: { kind: 'allyFighting' }, do: { kind: 'joinAlly' } }],
    });
    expect(bad.ok).toBe(false);
  });
});
