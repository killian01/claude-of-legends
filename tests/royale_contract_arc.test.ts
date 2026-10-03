// The match arc before its rules (CONTEXT.md: Reprieve, Arrival, Last
// light): no Arrival and no Reprieve in the observation or on the wire, a
// champion back at full health, and an Arrival begun or replayed changing
// nothing. Owned by tranche 2's match-arc worktree (T2-C), which deletes or
// rewrites this file as its rules land; no other worktree edits it.

import { describe, expect, it } from 'vitest';
import { applyReplayEvent } from '../src/net/replay';
import { buildObservation } from '../src/sim/observe';
import { Sim } from '../src/sim/sim';
import { fakeSnap, fingerprint, landed } from './royale_contract_fixture';

describe('the match arc, inert', () => {
  for (const key of ['arriving', 'reprieveAt']) {
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

  it('replays an arrive event as nothing', () => {
    const { sim, unitIds } = landed();
    const teams = new Map(unitIds.map((id, i) => [id, i]));
    const before = fingerprint(sim);
    applyReplayEvent(sim, teams, { k: sim.tickCount, u: unitIds[1]!, e: 'arrive' });
    expect(fingerprint(sim)).toEqual(before);
    expect(sim.policies.size).toBe(0);
  });
});
