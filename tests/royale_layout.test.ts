// Where the battle royale's HUD puts what comes and goes on a desktop
// (src/ui/royale_layout.ts): the notices' lane and the first steps' card
// keep off the champion, the bar, the hints and the top line at every size
// the playtest looked at (960x540 stacked the loot, "Completed:" and the
// level on the champion, and the card covered the first fight).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/content/items';
import {
  ANNOUNCE_Z,
  announceBox,
  announceMaxWidthCss,
  announceWidth,
  BAR_HALF_PX,
  COMPACT_DONE_MAX_W_PX,
  championBox,
  compactNoteWidth,
  FEED_MAX_W_PX,
  FEED_NAME_MAX_W_PX,
  feedBox,
  HINTS_TOP_PX,
  MODAL_Z,
  notesLane,
  overlaps,
  type ScreenBox,
  SIDE_MARGIN_PX,
  SPOT_FADE_MS,
  STEPS_CLEAR_MIDDLE_PX,
  slainBox,
  spotCoverMs,
  stepsBox,
  stepsWidth,
  WASH_Z,
} from '../src/ui/royale_layout';
import { BUILD_COMPLETE, completedText } from '../src/ui/royale_text';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

describe('the announcement', () => {
  for (const [w, h] of SIZES) {
    it(`keeps clear of a four-line feed, the card, the champion and the top line at ${w}x${h}`, () => {
      // "You took down Rushlantern" ran under the feed at 960x540.
      const call = announceBox(w);
      expect(overlaps(call, feedBox(w))).toBe(false);
      expect(overlaps(call, stepsBox(w))).toBe(false);
      expect(overlaps(call, championBox(w, h))).toBe(false);
      expect(overlaps(call, topLine(w))).toBe(false);
      expect(overlaps(call, slainBox(w, h))).toBe(false);
      // Room for "You took down" and a name on a line.
      expect(announceWidth(w)).toBeGreaterThanOrEqual(300);
    });
  }

  it('takes the width the stylesheet gives it', () => {
    const css = announceMaxWidthCss();
    for (const [w] of SIZES) {
      const js = css
        .replace(/calc\(/g, '(')
        .replace(/max\(/g, 'Math.max(')
        .replace(/min\(/g, 'Math.min(')
        .replace(/100%/g, String(w))
        .replace(/50%/g, String(w / 2))
        .replace(/px/g, '');
      expect(new Function(`return ${js};`)()).toBeCloseTo(announceWidth(w));
    }
  });

  it('stands over the wash of a death and under the modal screens', () => {
    // SLAIN dimmed "Two Seedfalls have landed" under it.
    expect(ANNOUNCE_Z).toBeGreaterThan(WASH_Z);
    expect(ANNOUNCE_Z).toBeLessThan(MODAL_Z);
    // The numbers the HUD's stylesheet gives the wash and the modals.
    const hud = readFileSync(path.join(ROOT, 'src/ui/hud.ts'), 'utf8');
    const z = (selector: string): number => {
      const at = hud.indexOf(`${selector} {`);
      const body = hud.slice(at, hud.indexOf('}', at));
      return Number(/z-index: (\d+);/.exec(body)?.[1]);
    };
    expect(z('.hud-overlay')).toBe(WASH_Z);
    expect(z('.hud-overlay.modal')).toBe(MODAL_Z);
    expect(hud).toContain(['z-index: $', '{ANNOUNCE_Z}'].join(''));
  });
});

describe('the feed', () => {
  it('holds a line of two cut names and their bot marks in its column', () => {
    // Padding and border, two names with a gap and a bot mark each, the
    // ">" with its gaps.
    const bot = 30;
    const line = 18 + 2 + 2 * (FEED_NAME_MAX_W_PX + 4 + bot) + 6 + 8 + 6;
    expect(line).toBeLessThanOrEqual(FEED_MAX_W_PX);
  });
});

describe("a phone's spotlight and the first steps' card", () => {
  it('keeps the card away from the call until the word has faded', () => {
    for (const hold of [2600, 3000, 3800]) {
      expect(spotCoverMs(hold)).toBeGreaterThanOrEqual(hold + SPOT_FADE_MS);
    }
  });
});

describe("a phone's finished item line", () => {
  it('fits on one line for every finished item ("Completed: Doombrand · Deathmark")', () => {
    const lines = Object.values(ITEMS)
      .map((d) => completedText(d, true))
      .filter((t): t is string => t !== null);
    expect(lines.length).toBeGreaterThan(0);
    for (const text of [...lines, BUILD_COMPLETE]) {
      expect(compactNoteWidth(text), text).toBeLessThanOrEqual(COMPACT_DONE_MAX_W_PX);
    }
  });
});
