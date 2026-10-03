// The Grafts before their rules (CONTEXT.md: Graft): no offer and no Graft
// in the observation or on the wire, and the pick accepted, free, changing
// nothing (no state, no rng), live, replayed and in the 5v5. Owned by
// tranche 2's grafts worktree (T2-B), which deletes or rewrites this file
// as its rules land; no other worktree edits it.

import { describe, expect, it } from 'vitest';
import { applySimCommand } from '../src/net/replay';
import { dispatchAction } from '../src/sim/action_dispatch';
import { buildObservation } from '../src/sim/observe';
import { Sim } from '../src/sim/sim';
import { fakeSnap, fingerprint, landed } from './royale_contract_fixture';

describe('the Grafts, inert', () => {
  for (const key of ['offer', 'grafts']) {
    it(`leaves ${key} out of the observation`, () => {
      const { sim, unitIds } = landed();
      expect(buildObservation(sim, unitIds[0]!)!.royale).not.toHaveProperty(key);
    });
  }

  for (const key of ['offer', 'gr']) {
    it(`sends no ${key} block`, () => {
      expect(fakeSnap().snap().royale).not.toHaveProperty(key);
    });
  }

  it('picks no Graft', () => {
    const { sim, unitIds } = landed('one_life');
    expect(sim.royaleMode!.pickGraft(unitIds[1]!, 0, sim.time)).toBe(false);
  });

  it('accepts the graft action, free, and changes nothing', () => {
    const { sim, unitIds } = landed();
    const before = fingerprint(sim);
    for (const pick of [0, 1, 2] as const) {
      expect(dispatchAction(sim, unitIds[0]!, { kind: 'graft', pick })).toBe(true);
    }
    expect(dispatchAction(sim, unitIds[0]!, { kind: 'graft', pick: 3 as 0 })).toBe(false);
    expect(fingerprint(sim)).toEqual(before);
  });

  it('changes nothing in the 5v5 either', () => {
    const sim = new Sim(31);
    const u = sim.addChampion(0);
    sim.tick();
    const before = { checksum: sim.checksum(), rng: sim.rng.state, tokens: u.decisionTokens };
    expect(dispatchAction(sim, u.id, { kind: 'graft', pick: 0 })).toBe(true);
    expect(sim.pickGraft(u.id, 0)).toBe(false);
    expect({ checksum: sim.checksum(), rng: sim.rng.state, tokens: u.decisionTokens }).toEqual(
      before,
    );
  });

  it('replays a graft command as nothing', () => {
    const { sim, unitIds } = landed();
    const before = fingerprint(sim);
    applySimCommand(sim, 0, unitIds[0]!, { t: 'graft', pick: 2 });
    expect(fingerprint(sim)).toEqual(before);
    expect(sim.policies.size).toBe(0);
  });

  it('plays the same match with the picks pressed as without', () => {
    const a = landed();
    const b = landed();
    for (let i = 0; i < 100; i++) {
      for (const id of a.unitIds) dispatchAction(a.sim, id, { kind: 'graft', pick: 0 });
      a.sim.tick();
      b.sim.tick();
    }
    expect(a.sim.checksum()).toBe(b.sim.checksum());
  });
});
