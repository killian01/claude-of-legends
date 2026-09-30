// The touch bar (src/ui/touch_bar.ts): buttons a finger's size, stepped in
// from the notch and the rounded corners on whichever side it rides.

import { describe, expect, it } from 'vitest';
import { MIN_TAP_PX } from '../src/game/ui_scale';
import { TOUCH_BAR_CSS } from '../src/ui/touch_bar';

describe('the touch bar', () => {
  it('draws its buttons at least a finger tall and wide', () => {
    const height = /min-height:\s*(\d+)px/.exec(TOUCH_BAR_CSS);
    const width = /min-width:\s*(\d+)px/.exec(TOUCH_BAR_CSS);
    expect(Number(height?.[1])).toBeGreaterThanOrEqual(MIN_TAP_PX);
    expect(Number(width?.[1])).toBeGreaterThanOrEqual(MIN_TAP_PX);
  });

  it('keeps clear of the safe area on the right and on the left', () => {
    expect(TOUCH_BAR_CSS).toContain('right: calc(8px + env(safe-area-inset-right, 0px))');
    expect(TOUCH_BAR_CSS).toContain('left: calc(8px + env(safe-area-inset-left, 0px))');
  });
});
