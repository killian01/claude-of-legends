// The multikill ladder (src/ui/multikill.ts): the rung a run of kills
// reaches, and what the game does with it.
//
// The ladder is the announcer's loudest moment and it used to be three
// ternaries inside the HUD, counted on the wall clock, visible to nobody
// but the killer, and capped at a single rung for four kills and five
// alike. Every rule it grew is pinned here.

import { describe, expect, it } from 'vitest';
import {
  MULTIKILL_LEASH,
  MULTIKILL_TOP,
  MultikillLadder,
  multikillLook,
} from '../src/ui/multikill';

const HERO = 1;
const OTHER = 2;
const FOE = 10;

// A run of kills by one champion at the given sim times, from a clean
// ladder: the rungs it calls, in order, with 0 for a kill worth no call.
function run(times: readonly number[], killer = HERO): number[] {
  const ladder = new MultikillLadder();
  return times.map((t, i) => ladder.record(FOE + i, killer, t)?.tier ?? 0);
}

describe('the multikill leash', () => {
  it('holds the first link to seven seconds', () => {
    // The tight link is the point of the change: a flat ten seconds called
    // a double kill seven times a match, which is not an event.
    expect(run([0, 7])).toEqual([0, 2]);
    expect(run([0, 7.01])).toEqual([0, 0]);
  });

  it('opens the leash as the chain climbs', () => {
    // Ten to the triple and the quadra, thirty to the penta: a fight that
    // wipes a team takes twenty seconds, and a window short enough to make
    // the double mean something leaves the top of the ladder unreachable.
    expect(run([0, 7, 17, 27, 57])).toEqual([0, 2, 3, 4, 5]);
    // One second past each link, the chain restarts instead.
    expect(run([0, 7, 17.01])).toEqual([0, 2, 0]);
    expect(run([0, 7, 17, 27.01])).toEqual([0, 2, 3, 0]);
    expect(run([0, 7, 17, 27, 57.01])).toEqual([0, 2, 3, 4, 0]);
  });

  it('measures the leash from the last kill, not from the first', () => {
    // A rolling window: five kills seven seconds apart are a pentakill even
    // though they span half a minute.
    expect(run([0, 7, 14, 21, 28])).toEqual([0, 2, 3, 4, 5]);
  });
});

describe('the top of the ladder', () => {
  it('stops at the pentakill and wipes the slate', () => {
    // There is no word above five, so the chain restarts rather than
    // counting into silence: the sixth kill is an ordinary kill and can
    // build a fresh double behind it.
    expect(run([0, 5, 10, 15, 20, 22, 24])).toEqual([0, 2, 3, 4, 5, 0, 2]);
  });

  it('leaves nothing on the counter after the top rung', () => {
    const ladder = new MultikillLadder();
    for (const [i, t] of [0, 5, 10, 15, 20].entries()) ladder.record(FOE + i, HERO, t);
    expect(ladder.chainOf(HERO)).toBe(0);
  });
});

describe('whose chain it is', () => {
  it('resets a chain when its owner dies', () => {
    // Nobody carries a spree out of the fountain.
    const ladder = new MultikillLadder();
    expect(ladder.record(FOE, HERO, 0)).toBeNull();
    ladder.record(HERO, FOE, 2);
    expect(ladder.record(FOE + 1, HERO, 4)?.tier ?? 0).toBe(0);
  });

  it('counts each champion apart', () => {
    const ladder = new MultikillLadder();
    ladder.record(FOE, HERO, 0);
    ladder.record(FOE + 1, OTHER, 1);
    // Two kills each, two doubles, neither borrowing the other's link.
    expect(ladder.record(FOE + 2, HERO, 5)?.tier).toBe(2);
    expect(ladder.record(FOE + 3, OTHER, 6)?.tier).toBe(2);
  });

  it('calls nothing for a death nobody owns', () => {
    // A tower or a wave takes the kill: there is no chain to advance, but
    // the victim's own chain still ends.
    const ladder = new MultikillLadder();
    ladder.record(FOE, HERO, 0);
    expect(ladder.record(FOE + 1, null, 2)).toBeNull();
    ladder.record(HERO, null, 3);
    expect(ladder.record(FOE + 2, HERO, 4)?.tier ?? 0).toBe(0);
  });
});

describe('what a rung is worth', () => {
  it('has a leash for every link below the top', () => {
    expect(MULTIKILL_LEASH).toHaveLength(MULTIKILL_TOP - 1);
    for (const [i, s] of MULTIKILL_LEASH.entries()) {
      expect(s, `link ${i + 1} is not a positive number of seconds`).toBeGreaterThan(0);
    }
  });

  it('gives the top two rungs the whole lobby and their own moment', () => {
    // A pentakill only the killer hears is half a pentakill; a double kill
    // everyone hears seven times a match is noise. The line splits here.
    for (const tier of [2, 3]) {
      const look = multikillLook(tier);
      expect(look?.everyone, `tier ${tier}`).toBe(false);
      expect(look?.spotlight, `tier ${tier}`).toBe(false);
    }
    for (const tier of [4, 5]) {
      const look = multikillLook(tier);
      expect(look?.everyone, `tier ${tier}`).toBe(true);
      expect(look?.spotlight, `tier ${tier}`).toBe(true);
    }
  });

  it('climbs, and never steps back', () => {
    const looks = [2, 3, 4, 5].map((t) => multikillLook(t));
    for (const [i, look] of looks.entries()) {
      expect(look, `tier ${i + 2} has no look`).not.toBeNull();
      if (i === 0 || !look) continue;
      const before = looks[i - 1];
      if (!before) continue;
      expect(
        look.intensity,
        `tier ${i + 2} is quieter than the rung under it`,
      ).toBeGreaterThanOrEqual(before.intensity);
      expect(look.holdMs, `tier ${i + 2} is shorter than the rung under it`).toBeGreaterThanOrEqual(
        before.holdMs,
      );
    }
    expect(multikillLook(MULTIKILL_TOP)?.intensity).toBe(2);
  });

  it('has nothing to say about a single kill', () => {
    expect(multikillLook(1)).toBeNull();
    expect(multikillLook(MULTIKILL_TOP + 1)).toBeNull();
  });
});
