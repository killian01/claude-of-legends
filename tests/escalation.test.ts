// Lane escalation gate: once a team's towers on a lane are down, the
// OPPOSING team's waves on that lane carry a Vanguard elite; intact lanes
// never do.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { laneFullyOpen } from '../src/sim/structure_rules';

describe('lane escalation', () => {
  it('adds a Vanguard to waves on a fully open lane only', () => {
    const sim = new Sim(11);
    // Tear down team 1's mid towers; top and bot stay intact.
    for (const u of [...sim.units.values()]) {
      if (u.kind === 'tower' && u.team === 1 && u.structure?.lane === 'mid') {
        sim.units.delete(u.id);
      }
    }
    expect(laneFullyOpen(sim.units, 1, 'mid')).toBe(true);
    expect(laneFullyOpen(sim.units, 1, 'top')).toBe(false);

    for (let i = 0; i < 11 * 20; i++) sim.tick();
    const vanguards = [...sim.units.values()].filter(
      (u) => u.kind === 'minion' && u.goldBounty === 90,
    );
    // Team 0 (whose mid opponents lost their towers) fields exactly one.
    expect(vanguards).toHaveLength(1);
    expect(vanguards[0]!.team).toBe(0);
    expect(vanguards[0]!.maxHp).toBeGreaterThan(1000);
  });
});
