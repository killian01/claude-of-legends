// The right thumb's casts (src/game/thumb_cast.ts): tap, aim, cancel, and
// where each of them lands.

import { describe, expect, it } from 'vitest';
import {
  AIM_DEAD,
  AIM_FLOOR,
  AIM_REACH,
  aimedPoint,
  QUICK_SHARE,
  quickPoint,
  ThumbAim,
} from '../src/game/thumb_cast';

describe('a press on a slot', () => {
  it('is a tap while the thumb has not slid', () => {
    const a = new ThumbAim();
    a.start(100, 100);
    expect(a.move(105, 103)).toBeNull();
    expect(a.hasAimed).toBe(false);
    expect(a.release()).toBe('tap');
  });

  it('is an aim once the thumb slides out, unit direction and share of the reach', () => {
    const a = new ThumbAim();
    a.start(100, 100);
    const s = a.move(100 + AIM_DEAD + (AIM_REACH - AIM_DEAD) / 2, 100);
    expect(s?.x).toBe(1);
    expect(s?.y).toBe(0);
    expect(s?.k).toBeCloseTo(0.5);
    expect(a.move(100, 100 + 500)?.k).toBe(1);
    expect(a.release()).toBe('aimed');
  });

  it('is a cancel when the thumb comes back onto the slot', () => {
    const a = new ThumbAim();
    a.start(100, 100);
    a.move(160, 100);
    expect(a.move(103, 101)).toBeNull();
    expect(a.hasAimed).toBe(true);
    expect(a.release()).toBe('cancel');
  });

  it('starts over on the next press', () => {
    const a = new ThumbAim();
    a.start(100, 100);
    a.move(160, 100);
    a.release();
    a.start(200, 200);
    expect(a.hasAimed).toBe(false);
    expect(a.release()).toBe('tap');
  });
});

describe('where a cast lands', () => {
  const self = { x: 10, z: 10 };

  it('aimed: along the direction, by the share, never past the range', () => {
    expect(aimedPoint(self, { x: 1, z: 0 }, 0.5, 8)).toEqual({ x: 14, z: 10 });
    expect(aimedPoint(self, { x: 0, z: 1 }, 1, 8)).toEqual({ x: 10, z: 18 });
    expect(aimedPoint(self, { x: 0, z: 1 }, 3, 8)).toEqual({ x: 10, z: 18 });
  });

  it('aimed: never on the feet, whatever the slide', () => {
    expect(aimedPoint(self, { x: 1, z: 0 }, 0, 8)).toEqual({ x: 10 + 8 * AIM_FLOOR, z: 10 });
  });

  it('quick: on the target, else ahead along the facing, else on the feet', () => {
    expect(quickPoint(self, { x: 13, z: 12 }, { x: 1, z: 0 }, 8)).toEqual({ x: 13, z: 12 });
    expect(quickPoint(self, null, { x: 0, z: 1 }, 8)).toEqual({ x: 10, z: 10 + 8 * QUICK_SHARE });
    expect(quickPoint(self, null, null, 8)).toEqual({ x: 10, z: 10 });
  });
});
