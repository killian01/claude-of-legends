// Where the battle royale's HUD puts what comes and goes on a desktop
// (src/ui/royale_layout.ts): the notices' lane and the first steps' card
// keep off the champion, the bar, the hints and the top line at every size
// the playtest looked at (960x540 stacked the loot, "Completed:" and the
// level on the champion, and the card covered the first fight).

import { describe, expect, it } from 'vitest';
import {
  BAR_HALF_PX,
  championBox,
  HINTS_TOP_PX,
  notesLane,
  overlaps,
  type ScreenBox,
  SIDE_MARGIN_PX,
  STEPS_CLEAR_MIDDLE_PX,
  stepsBox,
  stepsWidth,
} from '../src/ui/royale_layout';

// The desktops played at interface size 1 (ui_scale: 1 up to 1080 rows).
const SIZES: readonly [number, number][] = [
  [960, 540],
  [1280, 720],
  [1366, 768],
  [1920, 1080],
];

// The top line (the Dusk, the count, the leader's badge) at the top center.
const topLine = (w: number): ScreenBox => ({
  left: w / 2 - 130,
  top: 0,
  right: w / 2 + 130,
  bottom: 100,
});
// The bar with its bars, slots and loot row at the bottom center.
const bar = (w: number, h: number): ScreenBox => ({
  left: w / 2 - BAR_HALF_PX,
  top: h - 175,
  right: w / 2 + BAR_HALF_PX,
  bottom: h,
});
// The hints at the bottom left.
const hints = (h: number): ScreenBox => ({
  left: 12,
  top: h - HINTS_TOP_PX,
  right: 252,
  bottom: h,
});

describe('the notices lane', () => {
  for (const [w, h] of SIZES) {
    it(`stands off the champion, the bar and the hints at ${w}x${h}`, () => {
      const lane = notesLane(w, h);
      expect(overlaps(lane, championBox(w, h))).toBe(false);
      expect(overlaps(lane, bar(w, h))).toBe(false);
      expect(overlaps(lane, hints(h))).toBe(false);
      expect(lane.left).toBeGreaterThanOrEqual(SIDE_MARGIN_PX);
      // Room for a loot line that wraps once.
      expect(lane.right - lane.left).toBeGreaterThanOrEqual(260);
      expect(lane.top).toBeGreaterThan(0);
    });
  }
});

describe("the first steps' card", () => {
  for (const [w, h] of SIZES) {
    it(`stands at the top left, off the champion and the top line, at ${w}x${h}`, () => {
      const card = stepsBox(w);
      expect(overlaps(card, championBox(w, h))).toBe(false);
      expect(overlaps(card, topLine(w))).toBe(false);
      expect(overlaps(card, notesLane(w, h))).toBe(false);
      expect(card.right).toBeLessThanOrEqual(w / 2 - STEPS_CLEAR_MIDDLE_PX + 12);
      expect(stepsWidth(w)).toBeGreaterThanOrEqual(260);
    });
  }
});
