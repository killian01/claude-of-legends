// The left thumb's stick (src/game/thumb_stick.ts): which touch is the
// stick, what direction the thumb gives, and when that becomes an order.

import { describe, expect, it } from 'vitest';
import {
  inStickZone,
  leadPoint,
  STICK_DEAD,
  STICK_RADIUS,
  STICK_RESEND_MS,
  shouldResend,
  ThumbStick,
} from '../src/game/thumb_stick';

const vp = { width: 800, height: 400 };

describe('which touch is the stick', () => {
  it('is one that lands in the left part, below the score', () => {
    expect(inStickZone(100, 200, vp)).toBe(true);
    expect(inStickZone(500, 200, vp)).toBe(false);
    expect(inStickZone(100, 20, vp)).toBe(false);
  });

  it('is claimed by the first finger there and by nobody else', () => {
    const s = new ThumbStick();
    expect(s.down(1, 100, 200, vp)).toBe(true);
    expect(s.down(2, 120, 220, vp)).toBe(false);
    expect(s.down(3, 600, 200, vp)).toBe(false);
    expect(s.move(2, 130, 230)).toBe(false);
    expect(s.up(2)).toBe(false);
    expect(s.up(1)).toBe(true);
    expect(s.active).toBe(false);
    expect(s.down(2, 120, 220, vp)).toBe(true);
  });
});

describe('what the thumb gives', () => {
  it('rests in the dead zone, then points, unit length, with how far out', () => {
    const s = new ThumbStick();
    s.down(1, 100, 200, vp);
    expect(s.vector()).toBeNull();
    s.move(1, 100 + STICK_DEAD - 1, 200);
    expect(s.vector()).toBeNull();
    s.move(1, 100 + STICK_RADIUS, 200);
    expect(s.vector()).toEqual({ x: 1, y: 0, k: 1 });
    s.move(1, 100, 200 - (STICK_DEAD + (STICK_RADIUS - STICK_DEAD) / 2));
    const v = s.vector();
    expect(v?.x).toBeCloseTo(0);
    expect(v?.y).toBeCloseTo(-1);
    expect(v?.k).toBeCloseTo(0.5);
  });

  it('keeps the knob on the ring however far the thumb slides', () => {
    const s = new ThumbStick();
    s.down(1, 100, 200, vp);
    s.move(1, 400, 200);
    expect(s.knob).toEqual({ x: 100 + STICK_RADIUS, z: 200 });
    expect(s.vector()).toEqual({ x: 1, y: 0, k: 1 });
    expect(s.center).toEqual({ x: 100, z: 200 });
  });

  it('gives nothing once the thumb is up', () => {
    const s = new ThumbStick();
    s.down(1, 100, 200, vp);
    s.move(1, 200, 200);
    s.up(1);
    expect(s.vector()).toBeNull();
  });
});

describe('when the stick becomes an order', () => {
  it('speaks at once, again when the thumb turns, and on the keep-alive', () => {
    expect(shouldResend(null, { x: 1, z: 0 }, 1000)).toBe(true);
    const last = { x: 1, z: 0, at: 1000 };
    expect(shouldResend(last, { x: 1, z: 0 }, 1100)).toBe(false);
    expect(shouldResend(last, { x: Math.cos(0.3), z: Math.sin(0.3) }, 1100)).toBe(true);
    expect(shouldResend(last, { x: 1, z: 0 }, 1000 + STICK_RESEND_MS)).toBe(true);
  });

  it('names a point ahead, inside the map', () => {
    expect(leadPoint({ x: 10, z: 10 }, { x: 1, z: 0 }, 4, 156)).toEqual({ x: 14, z: 10 });
    expect(leadPoint({ x: 1, z: 155 }, { x: -1, z: 1 }, 4, 156)).toEqual({ x: 0, z: 156 });
  });
});
