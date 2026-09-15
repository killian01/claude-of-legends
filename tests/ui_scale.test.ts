// The interface size (src/game/ui_scale.ts): the automatic rule and the
// setting's clamp.

import { describe, expect, it } from 'vitest';
import {
  autoUiScale,
  clampUiScale,
  effectiveUiScale,
  MAX_THUMB_SCALE,
  MAX_UI_SCALE,
  MIN_THUMB_SCALE,
  MIN_UI_SCALE,
  thumbScale,
  UI_SCALE_CHOICES,
} from '../src/game/ui_scale';

describe('the automatic scale', () => {
  it('is 1 on the screen the interface was drawn for, and below it', () => {
    expect(autoUiScale(1080)).toBe(1);
    expect(autoUiScale(768)).toBe(1);
    expect(autoUiScale(900)).toBe(1);
  });

  it('grows with the viewport, on steps, and stops at twice', () => {
    expect(autoUiScale(1440)).toBe(1.35);
    expect(autoUiScale(1600)).toBe(1.5);
    expect(autoUiScale(2160)).toBe(2);
    expect(autoUiScale(4320)).toBe(MAX_UI_SCALE);
  });

  it('is 1 when the viewport is unknown', () => {
    expect(autoUiScale(0)).toBe(MIN_UI_SCALE);
    expect(autoUiScale(Number.NaN)).toBe(MIN_UI_SCALE);
  });
});

describe("the thumb controls' size", () => {
  it('follows the height of the phone, a little smaller on a short one', () => {
    expect(thumbScale(420)).toBe(1);
    expect(thumbScale(390)).toBe(0.93);
    expect(thumbScale(360)).toBe(0.86);
    expect(thumbScale(300)).toBe(MIN_THUMB_SCALE);
  });

  it('grows on a tablet and stops before the cluster eats the map', () => {
    expect(thumbScale(600)).toBe(1.43);
    expect(thumbScale(1024)).toBe(MAX_THUMB_SCALE);
    expect(thumbScale(0)).toBe(1);
  });
});

describe('the setting', () => {
  it('is auto for anything that is not a number', () => {
    expect(clampUiScale('auto')).toBe('auto');
    expect(clampUiScale(undefined)).toBe('auto');
    expect(clampUiScale('big')).toBe('auto');
    expect(clampUiScale(Number.POSITIVE_INFINITY)).toBe('auto');
  });

  it('keeps a number in range, on a step', () => {
    expect(clampUiScale(1.5)).toBe(1.5);
    expect(clampUiScale(0.5)).toBe(MIN_UI_SCALE);
    expect(clampUiScale(3)).toBe(MAX_UI_SCALE);
    expect(clampUiScale(1.26)).toBe(1.25);
    for (const c of UI_SCALE_CHOICES) expect(clampUiScale(c)).toBe(c);
  });

  it('decides the scale: the rule on auto, the number otherwise', () => {
    expect(effectiveUiScale('auto', 1440)).toBe(1.35);
    expect(effectiveUiScale(1.75, 1440)).toBe(1.75);
    expect(effectiveUiScale(1, 2160)).toBe(1);
  });
});
