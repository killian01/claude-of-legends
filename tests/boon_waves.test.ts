// The Boon's waves (plan-bots phase 16): a team holding the Warden's Boon
// sends a siege minion with every wave while it lasts; the other team's
// waves keep the every-third rhythm.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { BOON_DURATION_S } from '../src/sim/team_buffs';
import { FIRST_WAVE_AT, WAVE_EVERY } from '../src/sim/waves';

function siegeCount(sim: Sim, team: number): number {
  let n = 0;
  for (const u of sim.units.values()) {
    if (u.kind === 'minion' && !u.dead && u.team === team && u.stats.attackRange === 4) n++;
  }
  return n;
}

function tickTo(sim: Sim, time: number): void {
  while (sim.time < time) sim.tick();
}

describe('the Boon and the waves', () => {
  it('adds a siege minion to every wave of the team that holds it', () => {
    const sim = new Sim(3);
    sim.teamBuffs.grantBoon(0, 0);
    // The first wave is not a siege wave by the rhythm (index 0 of 3).
    tickTo(sim, FIRST_WAVE_AT + 0.5);
    expect(siegeCount(sim, 0)).toBe(3);
    expect(siegeCount(sim, 1)).toBe(0);
  });

  it('stops with the Boon', () => {
    const sim = new Sim(3);
    sim.teamBuffs.grantBoon(0, 0);
    // Past the Boon's duration, the next non-siege wave carries none for
    // either team: the minions of the first waves have long since died or
    // walked off, so a fresh count after the Boon reads the rule alone.
    const after = FIRST_WAVE_AT + WAVE_EVERY * Math.ceil(BOON_DURATION_S / WAVE_EVERY);
    let waveAt = after;
    // Land on a wave that the rhythm leaves without a siege minion.
    while (Math.round((waveAt - FIRST_WAVE_AT) / WAVE_EVERY) % 3 === 2) waveAt += WAVE_EVERY;
    tickTo(sim, waveAt - 0.5);
    const before0 = siegeCount(sim, 0);
    const before1 = siegeCount(sim, 1);
    tickTo(sim, waveAt + 0.5);
    expect(sim.teamBuffs.boon(0, sim.time)).toBeNull();
    expect(siegeCount(sim, 0) - before0).toBe(siegeCount(sim, 1) - before1);
  });
});
