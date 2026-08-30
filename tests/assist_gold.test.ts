// Assist gold: helpers on a champion kill split a pot on top of the
// killer's full bounty (snowball review, round 2: gold was strictly
// last-hit, so a won team fight paid one bot and the team lead never
// became items).

import { describe, expect, it } from 'vitest';
import { ASSIST_GOLD_FRAC, CHAMPION_BOUNTY_BASE } from '../src/sim/rewards';
import { Sim } from '../src/sim/sim';

describe('assist gold', () => {
  it('pays each helper an even share of the assist pot', () => {
    const sim = new Sim(11);
    const killer = sim.addChampion(0, { x: 75, z: 75 });
    // Out of attack and xp-share range: only the assist pot can pay it.
    const helper = sim.addChampion(0, { x: 55, z: 75 });
    const victim = sim.addChampion(1, { x: 78, z: 75 });
    victim.hp = 1;
    // The helper tagged the victim moments ago (the assist window).
    victim.recentDamagers.push({ id: helper.id, at: 0 });
    const expected = Math.floor(CHAMPION_BOUNTY_BASE * ASSIST_GOLD_FRAC);
    const helperGold = helper.gold;
    const killerGold = killer.gold;
    sim.orderAttack(killer.id, victim.id);
    for (let i = 0; i < 100 && !victim.dead; i++) sim.tick();
    expect(victim.dead).toBe(true);
    expect(helper.assists).toBe(1);
    expect(helper.gold - helperGold).toBe(expected);
    // The killer still collects the full bounty, untouched by the pot.
    expect(killer.gold - killerGold).toBeGreaterThanOrEqual(CHAMPION_BOUNTY_BASE);
  });

  it('pays nothing when nobody helped', () => {
    const sim = new Sim(11);
    const killer = sim.addChampion(0, { x: 75, z: 75 });
    const bystander = sim.addChampion(0, { x: 40, z: 40 });
    const victim = sim.addChampion(1, { x: 78, z: 75 });
    victim.hp = 1;
    const bystanderGold = bystander.gold;
    sim.orderAttack(killer.id, victim.id);
    for (let i = 0; i < 100 && !victim.dead; i++) sim.tick();
    expect(victim.dead).toBe(true);
    expect(bystander.assists).toBe(0);
    expect(bystander.gold).toBe(bystanderGold);
  });
});
