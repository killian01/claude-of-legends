// The match arc before its rules (CONTEXT.md: Reprieve, Last light): no
// Reprieve in the observation or on the wire (nor a Grace while nobody is
// in one), a champion back at full health, and no Arrival in the 5v5. The Arrival's own rules and its Grace
// are pinned in tests/royale_arrival.test.ts and tests/royale_grace.test.ts.
// Owned by tranche 2's match-arc worktree (T2-C), which deletes or rewrites
// this file as its rules land.

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../src/sim/observe';
import { Sim } from '../src/sim/sim';
import { fakeSnap, landed } from './royale_contract_fixture';

describe('the match arc, inert', () => {
  for (const key of ['arriving', 'graced', 'reprieveAt']) {
    it(`leaves ${key} out of the observation`, () => {
      const { sim, unitIds } = landed();
      expect(buildObservation(sim, unitIds[0]!)!.royale).not.toHaveProperty(key);
    });
  }

  for (const key of ['rp', 'ar', 'fi']) {
    it(`sends no ${key} block`, () => {
      expect(fakeSnap().snap().royale).not.toHaveProperty(key);
    });
  }

  it('brings a champion back at full health', () => {
    const { sim, unitIds } = landed('one_life');
    const u = sim.units.get(unitIds[1]!)!;
    expect(sim.royaleMode!.respawnHealth(u)).toBe(u.maxHp);
  });

  it('begins no Arrival in the 5v5', () => {
    const sim = new Sim(31);
    const u = sim.addChampion(0);
    sim.tick();
    const before = { checksum: sim.checksum(), rng: sim.rng.state, tokens: u.decisionTokens };
    sim.beginArrival(u.id);
    expect({ checksum: sim.checksum(), rng: sim.rng.state, tokens: u.decisionTokens }).toEqual(
      before,
    );
  });
});
