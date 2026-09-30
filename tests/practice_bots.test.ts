// Who the opponents' lane seats play in Practice (src/game/practice_bots.ts):
// Gentle until the viewer says otherwise, Normal being the styles the fill
// drew, and the lineup the seed gives either way.

import { describe, expect, it } from 'vitest';
import {
  clampPracticeBots,
  DEFAULT_PRACTICE_BOTS,
  PRACTICE_BOTS,
  practiceBotsHint,
  practiceBotsTitle,
  practiceOpponents,
} from '../src/game/practice_bots';
import { gentleSeats, houseSeats, LANE_STYLES } from '../src/sim/content/bots/house';
import { JUNGLER } from '../src/sim/content/bots/jungler';
import { Rng } from '../src/sim/rng';

describe('the enemy bots of Practice', () => {
  it('offers Gentle first and preselects it', () => {
    expect(PRACTICE_BOTS).toEqual(['gentle', 'normal']);
    expect(DEFAULT_PRACTICE_BOTS).toBe('gentle');
    expect(PRACTICE_BOTS.map(practiceBotsTitle)).toEqual(['Gentle', 'Normal']);
  });

  it('reads anything but Normal from storage as Gentle', () => {
    expect(clampPracticeBots('normal')).toBe('normal');
    expect(clampPracticeBots('gentle')).toBe('gentle');
    for (const junk of [undefined, null, 'Normal', 'hard', 0, {}]) {
      expect(clampPracticeBots(junk)).toBe('gentle');
    }
  });

  it("says what Gentle holds back, with the playbook's own threshold", () => {
    expect(practiceBotsHint('gentle')).toContain('before 2:00 and level 3');
    expect(practiceBotsHint('normal')).toMatch(/^Normal:/);
  });

  it("Gentle posts the Gentle player on the lane seats; Normal keeps the fill's styles", () => {
    const drawnIds = new Set(LANE_STYLES.map((s) => s.id));
    for (let seed = 1; seed <= 10; seed++) {
      const drawn = houseSeats([], new Rng(seed));
      const before = drawn.map((s) => ({ ...s }));
      const gentle = practiceOpponents(drawn, 'gentle');
      const normal = practiceOpponents(drawn, 'normal');
      expect(gentle).toEqual(gentleSeats(drawn));
      expect(normal).toEqual(drawn);
      // The lineup and the lanes are the seed's either way.
      for (const seats of [gentle, normal]) {
        expect(seats.map((s) => [s.championId, s.lane])).toEqual(
          drawn.map((s) => [s.championId, s.lane]),
        );
      }
      for (const [i, s] of normal.entries()) {
        if (s.bot !== JUNGLER.id) expect(drawnIds.has(s.bot)).toBe(true);
        expect(gentle[i]!.bot).toBe(s.bot === JUNGLER.id ? JUNGLER.id : 'gentle');
      }
      // The fill's seats themselves are left as they were.
      expect(drawn).toEqual(before);
      expect(normal).not.toBe(drawn);
    }
  });
});
