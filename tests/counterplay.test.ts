// The counterplay levers (plan-bots phase 15): a lane's activity over the
// last minute in the observation, the numbers trigger (allies with me
// minus enemies in sight), the split push that takes the quietest lane,
// the validator's door for both, and the house styles that carry them.

import { describe, expect, it } from 'vitest';
import { fillWithBots } from '../server/bot_fill';
import { starOrchard } from '../server/star_orchard';
import { buildMatchSim } from '../src/net/replay';
import { BRAWLER_PLAYBOOK } from '../src/sim/content/playbooks/brawler';
import { SIEGER_PLAYBOOK } from '../src/sim/content/playbooks/sieger';
import { LaneSightings } from '../src/sim/lane_sightings';
import { buildObservation } from '../src/sim/observe';
import { validatePlaybook } from '../src/sim/playbook';
import { quietestLane } from '../src/sim/playbook/behaviors';
import { buildSlotContext } from '../src/sim/playbook/micro';
import { holds } from '../src/sim/playbook/triggers';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

describe('lane activity', () => {
  it('sums the seconds enemies were seen in a lane over the window', () => {
    const s = new LaneSightings();
    s.record(0, 'top', 7, 100, 4);
    s.record(0, 'top', 8, 105, 3);
    s.record(0, 'mid', 7, 40, 5);
    expect(s.activity(0, 'top', 110, 60)).toBe(7);
    // Sixty seconds later the top sightings are out of the window.
    expect(s.activity(0, 'top', 175, 60)).toBe(0);
    expect(s.activity(0, 'mid', 110, 60)).toBe(0);
    expect(s.activity(0, 'mid', 60, 60)).toBe(5);
    expect(s.activity(1, 'top', 110, 60)).toBe(0);
  });

  it('reaches the observation as laneActivity, every lane a number', () => {
    const seed = 4;
    const { sim } = buildMatchSim(starOrchard(), seed, fillWithBots([], seed));
    for (let i = 0; i < 2400; i++) sim.tick();
    const champ = [...sim.units.values()].find((u) => u.kind === 'champion')!;
    const obs = buildObservation(sim, champ.id)!;
    expect(obs.laneActivity).toBeDefined();
    for (const lane of ['top', 'mid', 'bot'] as const) {
      expect(typeof obs.laneActivity![lane]).toBe('number');
      expect(obs.laneActivity![lane]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the numbers trigger and the split push', () => {
  function scene() {
    const sim = new Sim(9);
    const me = sim.addChampion(0, undefined, 'vesk', 0);
    const ally = sim.addChampion(0, undefined, 'korrath', 0);
    const foe1 = sim.addChampion(1, undefined, 'dain', 0);
    const foe2 = sim.addChampion(1, undefined, 'sylra', 0);
    me.pos = { x: 75, z: 75 };
    ally.pos = { x: 78, z: 75 };
    foe1.pos = { x: 80, z: 75 };
    foe2.pos = { x: 82, z: 77 };
    sim.tick();
    return { sim, me, ally, foe1, foe2 };
  }

  it('counts allies with me minus enemies in sight within the radius', () => {
    const { sim, me } = scene();
    const obs = buildObservation(sim, me.id)!;
    const ctx = buildSlotContext(obs, new Rng(1));
    // Two of us, two of them: even.
    expect(holds({ kind: 'numbers', within: 20, atLeast: 0 }, ctx)).toBe(true);
    expect(holds({ kind: 'numbers', within: 20, atLeast: 1 }, ctx)).toBe(false);
    expect(holds({ kind: 'numbers', within: 20, atMost: -1 }, ctx)).toBe(false);
    // A tighter radius keeps the ally and the nearer enemy: two on one.
    expect(holds({ kind: 'numbers', within: 6, atLeast: 1 }, ctx)).toBe(true);
    // The ally gone far: outnumbered.
    const { sim: alone, me: me2, ally: ally2 } = scene();
    ally2.pos = { x: 40, z: 40 };
    alone.tick();
    const ctx2 = buildSlotContext(buildObservation(alone, me2.id)!, new Rng(1));
    expect(holds({ kind: 'numbers', within: 20, atMost: -1 }, ctx2)).toBe(true);
    expect(holds({ kind: 'numbers', within: 20, atLeast: 0 }, ctx2)).toBe(false);
  });

  it('takes the quietest lane, the farthest from the enemies on a tie', () => {
    const { sim, me } = scene();
    const obs = buildObservation(sim, me.id)!;
    const quiet = buildSlotContext(
      { ...obs, laneActivity: { top: 30, mid: 12, bot: 0 } },
      new Rng(1),
    );
    expect(quietestLane(quiet)).toBe('bot');
    // A tie between top and bot: the enemies stand mid, both are far; the
    // sim's answer is deterministic either way.
    const tie = buildSlotContext({ ...obs, laneActivity: { top: 0, mid: 40, bot: 0 } }, new Rng(1));
    expect(['top', 'bot']).toContain(quietestLane(tie));
    const none = buildSlotContext({ ...obs, laneActivity: undefined }, new Rng(1));
    expect(quietestLane(none)).toBe('assigned');
  });

  it('is accepted by the validator with bounds, and refused outside them', () => {
    const ok = validatePlaybook({
      version: 3,
      plays: [
        { id: 'even', when: { kind: 'numbers', within: 20, atLeast: 0 }, do: { kind: 'fight' } },
        { id: 'split', when: { kind: 'always' }, do: { kind: 'splitPush' } },
      ],
    });
    expect(ok.ok).toBe(true);
    const bad = validatePlaybook({
      version: 3,
      plays: [{ id: 'a', when: { kind: 'numbers', within: 20 }, do: { kind: 'fight' } }],
    });
    expect(bad.ok).toBe(false);
    const far = validatePlaybook({
      version: 3,
      plays: [
        { id: 'a', when: { kind: 'numbers', within: 20, atLeast: 40 }, do: { kind: 'fight' } },
      ],
    });
    expect(far.ok).toBe(false);
  });

  it('is what the house styles carry: the Brawler on the odds, the Sieger pressing', () => {
    // Phase 15's Brawler counted the numbers; phase 16's weighs the odds
    // (the fight's commit, the tower when they turn badly). The Sieger
    // tried the split push over three matrix rounds and lost more each
    // time; what it keeps is the press: one minion of escort, no regroup.
    const fight = BRAWLER_PLAYBOOK.plays.find((p) => p.id === 'fight')?.do;
    expect(fight?.kind === 'fight' && fight.commitAt === 0.5).toBe(true);
    expect(BRAWLER_PLAYBOOK.plays.find((p) => p.id === 'outnumbered')?.when.kind).toBe('odds');
    expect(SIEGER_PLAYBOOK.plays.some((p) => p.do.kind === 'splitPush')).toBe(false);
    const siege = SIEGER_PLAYBOOK.plays.find((p) => p.id === 'siege')?.do;
    expect(siege?.kind === 'siege' && siege.escortMin === 1).toBe(true);
    const push = SIEGER_PLAYBOOK.plays.find((p) => p.id === 'push')?.do;
    expect(push?.kind === 'push' && push.regroupAt === null).toBe(true);
    expect(validatePlaybook(SIEGER_PLAYBOOK).ok).toBe(true);
    expect(validatePlaybook(BRAWLER_PLAYBOOK).ok).toBe(true);
  });
});
