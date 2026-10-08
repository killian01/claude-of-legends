// The bots' intent where it meets the contract: a dead seat decides while
// its Graft offer is open (royale/grafts.ts), and in Respawn once a wait,
// on its first slot after the fall, until it picked where it comes back
// (the 'drop' while dead that royale/return_pick.ts takes, the same pick a
// person makes on the globe; the house brain picks nothing, bot/brain.ts;
// the rule is pinned in tests/royale_return_pick.test.ts). Never in One
// life (an elimination clears the queue), never in the 5v5. A first royale's
// escorts are tested in tests/royale_drop.test.ts. Owned by tranche 1's
// bots-with-intent worktree (T1-C).

import { describe, expect, it } from 'vitest';
import { runBotDecisions } from '../src/sim/bot_driver';
import { RESPAWN_S } from '../src/sim/royale/types';
import { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { landed } from './royale_contract_fixture';

function calledSeedfall(sim: Sim) {
  sim.royaleMode!.state.seedfalls.push({
    id: 1,
    pos: { x: 0, y: 80, z: 0 },
    announcedAt: sim.time,
    landsAt: sim.time + 20,
    landed: false,
    cacheId: null,
  });
}

describe('the dead seats that decide', () => {
  it('asks a dead Respawn seat on its first slot after the fall until it picked, a Seedfall called or not', () => {
    const { sim, unitIds } = landed('respawn');
    const mode = sim.royaleMode!;
    const u = sim.units.get(unitIds[1]!)!;
    u.dead = true;
    u.respawnAt = sim.time + RESPAWN_S;
    const late = sim.time + 1;
    // The drop's Graft offer is open: that asks at any slot of the wait.
    expect(mode.wantsDeadDecision(u, late)).toBe(true);
    expect(sim.pickGraft(u.id, 0)).toBe(true);
    // Taken: the pick asks on the first slot only.
    expect(mode.wantsDeadDecision(u, sim.time + DT)).toBe(true);
    expect(mode.wantsDeadDecision(u, late)).toBe(false);
    calledSeedfall(sim);
    expect(mode.wantsDeadDecision(u, sim.time + DT)).toBe(true);
    expect(sim.pickDrop(u.id, { x: 0, y: 80, z: 0 })).toBe(true);
    expect(mode.wantsDeadDecision(u, sim.time + DT)).toBe(false);
  });

  it('takes a drop pick from a dead Respawn seat only, as where it comes back', () => {
    const { sim, unitIds } = landed('respawn');
    calledSeedfall(sim);
    const u = sim.units.get(unitIds[1]!)!;
    expect(sim.pickDrop(u.id, { x: 0, y: 80, z: 0 })).toBe(false);
    expect(sim.royaleMode!.state.respawnPicks.size).toBe(0);
    u.dead = true;
    expect(sim.pickDrop(u.id, { x: 0, y: 80, z: 0 })).toBe(true);
    expect(sim.royaleMode!.state.respawnPicks.size).toBe(1);
  });

  it('never asks one in One life', () => {
    const { sim, unitIds } = landed('one_life');
    sim.royaleMode!.state.offers.clear();
    calledSeedfall(sim);
    const u = sim.units.get(unitIds[1]!)!;
    u.dead = true;
    u.respawnAt = sim.time + RESPAWN_S;
    expect(sim.royaleMode!.wantsDeadDecision(u, sim.time + DT)).toBe(false);
  });

  it('runs no dead seat in the 5v5', () => {
    const sim = new Sim(11);
    const u = sim.addChampion(0);
    let asked = 0;
    sim.attachPolicy(u.id, () => {
      asked++;
      return { kind: 'noop' };
    });
    u.dead = true;
    for (let i = 0; i < 20; i++) {
      sim.tickCount = i;
      runBotDecisions(sim, sim.policies);
    }
    expect(asked).toBe(0);
    u.dead = false;
    for (let i = 0; i < 20; i++) {
      sim.tickCount = i;
      runBotDecisions(sim, sim.policies);
    }
    expect(asked).toBeGreaterThan(0);
  });
});
