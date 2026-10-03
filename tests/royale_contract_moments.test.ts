// The loud moments before the Clamor rings (CONTEXT.md: Clamor): a takedown
// leaves no Clamor in the state, the observation or on the wire. Owned by
// tranche 1's loud-moments worktree (T1-D), which deletes or rewrites this
// file as its rules land; no other worktree edits it.

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../src/sim/observe';
import { fakeSnap, landed } from './royale_contract_fixture';

describe('the Clamors, inert', () => {
  it('rings no Clamor for a takedown', () => {
    const { sim, unitIds } = landed('one_life');
    const victim = sim.units.get(unitIds[1]!)!;
    sim.royaleMode!.onDeath(sim, victim, unitIds[0]!, false);
    expect(sim.royale!.clamors).toEqual([]);
    sim.tick();
    expect(sim.royale!.clamors).toEqual([]);
  });

  it('leaves the Clamors out of the observation', () => {
    const { sim, unitIds } = landed();
    const obs = buildObservation(sim, unitIds[0]!)!;
    expect(obs.royale).not.toHaveProperty('clamors');
  });

  it('sends no Clamor block', () => {
    const { snap } = fakeSnap();
    expect(snap().royale).not.toHaveProperty('cl');
  });
});
