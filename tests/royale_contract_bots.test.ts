// The bots' intent where it meets the contract: a dead seat decides only
// while its Graft offer is open (royale/grafts.ts). The Respawn pick of
// where to come back (bot/brain.ts respawnPick) reaches nothing until
// tranche 2 (T2-C) lets the sim take a 'drop' while dead and gives a
// person the same pick, so running the policy for it would only cost a
// decision per slot. Never in One life (an elimination clears the queue),
// never in the 5v5. A newcomer's escorts are tested in
// tests/royale_drop.test.ts. Owned by tranche 1's bots-with-intent
// worktree (T1-C).

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
  it('asks no dead Respawn seat while the pick reaches nothing, a Seedfall called or not', () => {
    const { sim, unitIds } = landed('respawn');
    const mode = sim.royaleMode!;
    // The drop's Graft offer is open: that asks; once taken, nothing does.
    expect(mode.wantsDeadDecision(unitIds[1]!)).toBe(true);
    expect(sim.pickGraft(unitIds[1]!, 0)).toBe(true);
    expect(mode.wantsDeadDecision(unitIds[1]!)).toBe(false);
    calledSeedfall(sim);
    expect(mode.wantsDeadDecision(unitIds[1]!)).toBe(false);
  });

  it('refuses a drop pick from a dead Respawn seat in tranche 1', () => {
    const { sim, unitIds } = landed('respawn');
    calledSeedfall(sim);
    const u = sim.units.get(unitIds[1]!)!;
    u.dead = true;
    expect(sim.royaleMode!.pickDrop(u.id, { x: 0, y: 80, z: 0 }, sim.time)).toBe(false);
    expect(sim.royaleMode!.state.respawnPicks.size).toBe(0);
  });

  it('never asks one in One life', () => {
    const { sim, unitIds } = landed('one_life');
    sim.royaleMode!.state.offers.clear();
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
