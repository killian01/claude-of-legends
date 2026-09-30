// The controls hint on a touchscreen (src/ui/hints_fade.ts): its fade
// clock runs only while nothing covers the HUD.

import { describe, expect, it } from 'vitest';
import {
  HINTS_HOLD_TAP,
  HINTS_HOLD_THUMBS,
  HINTS_START,
  type HintsClock,
  hintsHold,
  stepHints,
} from '../src/ui/hints_fade';

// Steps the clock every 0.05 s from `from` to `to` (match seconds).
function run(
  state: HintsClock,
  from: number,
  to: number,
  covered: boolean,
  hold: number | null,
): HintsClock {
  let s = state;
  for (let t = from; t <= to + 1e-9; t += 0.05) s = stepHints(s, t, covered, hold);
  return s;
}

describe('how long the hint stays', () => {
  it('stays for good on a mouse', () => {
    expect(hintsHold(false, false)).toBeNull();
    expect(hintsHold(false, true)).toBeNull();
  });

  it('gives the thumb controls 12 s and the tap-to-walk paragraph 25 s', () => {
    expect(hintsHold(true, true)).toBe(HINTS_HOLD_THUMBS);
    expect(hintsHold(true, false)).toBe(HINTS_HOLD_TAP);
    expect(HINTS_HOLD_THUMBS).toBe(12);
    expect(HINTS_HOLD_TAP).toBe(25);
  });
});

describe('the hint fade clock', () => {
  it('does not start while the opening shop or the turn wall covers the HUD', () => {
    const covered = run(HINTS_START, 0, 30, true, HINTS_HOLD_THUMBS);
    expect(covered.faded).toBe(false);
    expect(covered.seen).toBe(0);
  });

  it('fades 12 s after the cover comes off, not 12 s after the match began', () => {
    const covered = run(HINTS_START, 0, 8.5, true, HINTS_HOLD_THUMBS);
    const early = run(covered, 8.55, 20, false, HINTS_HOLD_THUMBS);
    expect(early.faded).toBe(false);
    const late = run(early, 20.05, 20.6, false, HINTS_HOLD_THUMBS);
    expect(late.faded).toBe(true);
  });

  it('stands still while the HUD is covered again, and resumes after', () => {
    const a = run(HINTS_START, 0, 5, false, HINTS_HOLD_THUMBS);
    const shop = run(a, 5.05, 40, true, HINTS_HOLD_THUMBS);
    expect(shop.faded).toBe(false);
    expect(shop.seen).toBeCloseTo(a.seen, 5);
    const b = run(shop, 40.05, 46, false, HINTS_HOLD_THUMBS);
    expect(b.faded).toBe(false);
    const c = run(b, 46.05, 48, false, HINTS_HOLD_THUMBS);
    expect(c.faded).toBe(true);
  });

  it('never fades on a mouse', () => {
    expect(run(HINTS_START, 0, 600, false, null).faded).toBe(false);
  });

  it('stays faded once faded', () => {
    const faded = run(HINTS_START, 0, 13, false, HINTS_HOLD_THUMBS);
    expect(faded.faded).toBe(true);
    expect(stepHints(faded, 14, true, HINTS_HOLD_THUMBS)).toBe(faded);
  });
});
