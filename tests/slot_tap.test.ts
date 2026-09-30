// A finger or a click on a spell's slot (src/ui/slot_tap.ts): a spell not
// learned yet is learned while a skill point waits, refused with the line
// when none does, and a learned spell casts. The rank rule is the sim's.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { BASIC_MAX_RANK, effectiveRank, ULT_MAX_RANK, ULT_RANK_LEVELS } from '../src/sim/stats';
import type { AbilityKey } from '../src/sim/types';
import { rankable, slotTap } from '../src/ui/slot_tap';

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

function champion() {
  const sim = new Sim(1);
  return { sim, u: sim.addChampion(0) };
}

describe('a tap on a spell slot', () => {
  it('learns a basic spell at level 1, where the one point waits', () => {
    const { u } = champion();
    expect(u.level).toBe(1);
    expect(u.skillPoints).toBe(1);
    for (const key of ['Q', 'W', 'E'] as const) expect(slotTap(u, key)).toBe('learn');
  });

  it('refuses the ultimate before its level, point or not', () => {
    const { u } = champion();
    expect(slotTap(u, 'R')).toBe('refuse');
  });

  it('refuses an unlearned spell once the point is spent, and casts the learned one', () => {
    const { sim, u } = champion();
    expect(sim.levelAbility(u.id, 'Q')).toBe(true);
    expect(u.skillPoints).toBe(0);
    expect(slotTap(u, 'Q')).toBe('cast');
    expect(slotTap(u, 'W')).toBe('refuse');
    expect(slotTap(u, 'E')).toBe('refuse');
  });

  it('casts a learned spell even while a point waits: the + ranks it up', () => {
    const { u } = champion();
    u.abilityRanks.Q = 1;
    u.skillPoints = 1;
    expect(rankable(u, 'Q')).toBe(true);
    expect(slotTap(u, 'Q')).toBe('cast');
  });

  it("casts the ultimate from its level, the free first rank's", () => {
    const { sim, u } = champion();
    sim.setLevel(u.id, ULT_RANK_LEVELS[0]!);
    expect(slotTap(u, 'R')).toBe('cast');
  });

  it("follows the sim's own rule for a skill point, on every rank and level", () => {
    const { sim, u } = champion();
    for (const level of [1, 2, 5, 6, 10, 11, 15, 16, 18]) {
      for (const points of [0, 1, 2]) {
        for (const key of KEYS) {
          const max = key === 'R' ? ULT_MAX_RANK : BASIC_MAX_RANK;
          for (let rank = 0; rank <= max; rank++) {
            u.level = level;
            u.skillPoints = points;
            u.abilityRanks = { Q: 0, W: 0, E: 0, R: 0, [key]: rank };
            const said = rankable(u, key);
            const tap = slotTap(u, key);
            const unlearned = effectiveRank(u, key) === 0;
            const took = sim.levelAbility(u.id, key);
            const at = `${key} rank ${rank}, level ${level}, ${points} points`;
            expect(said, at).toBe(took);
            // A learned spell casts; an unlearned one is learned exactly
            // when the sim takes the point, and refused otherwise.
            expect(tap === 'cast', at).toBe(!unlearned);
            expect(tap === 'learn', at).toBe(unlearned && took);
          }
        }
      }
    }
  });
});
