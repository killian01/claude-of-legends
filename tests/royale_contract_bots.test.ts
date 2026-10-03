// The bots' intent where it meets the contract: a dead seat decides only
// in Respawn's play while a Seedfall is called (the pick of where to come
// back), never in One life and never in the 5v5; a newcomer's escorts are
// tested in tests/royale_drop.test.ts. Owned by tranche 1's
// bots-with-intent worktree (T1-C).

import { describe, expect, it } from 'vitest';
import { runBotDecisions } from '../src/sim/bot_driver';
import { Sim } from '../src/sim/sim';
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
  it('asks a dead Respawn seat only while a Seedfall is called', () => {
    const { sim, unitIds } = landed('respawn');
    const mode = sim.royaleMode!;
    expect(mode.wantsDeadDecision(unitIds[1]!)).toBe(false);
    calledSeedfall(sim);
    expect(mode.wantsDeadDecision(unitIds[1]!)).toBe(true);
  });

  it('never asks one in One life', () => {
    const { sim, unitIds } = landed('one_life');
    calledSeedfall(sim);
    expect(sim.royaleMode!.wantsDeadDecision(unitIds[1]!)).toBe(false);
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
