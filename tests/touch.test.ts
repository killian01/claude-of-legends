// The touch gesture classifier (game/touch.ts): pure state machine, driven
// here event by event exactly as the pointer listeners would.

import { describe, expect, it } from 'vitest';
import { TAP_SLOP_PX, TouchGestures } from '../src/game/touch';

describe('TouchGestures', () => {
  it('classifies a still press as a tap on release, however long it was held', () => {
    const g = new TouchGestures();
    expect(g.down(1, 100, 100)).toBeNull();
    expect(g.up(1, 102, 101)).toEqual({ kind: 'tap', x: 102, y: 101 });
  });

  it('stays a tap through sub-slop wobble', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100);
    expect(g.move(1, 100 + TAP_SLOP_PX - 1, 100)).toBeNull();
    expect(g.up(1, 100 + TAP_SLOP_PX - 1, 100)).toEqual({
      kind: 'tap',
      x: 100 + TAP_SLOP_PX - 1,
      y: 100,
    });
  });

  it('turns into a pan past the slop and never taps on release', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100);
    expect(g.move(1, 130, 100)).toEqual({
      kind: 'pan',
      fromX: 100,
      fromY: 100,
      toX: 130,
      toY: 100,
    });
    // Later moves pan from the previous position, not the start.
    expect(g.move(1, 140, 110)).toEqual({
      kind: 'pan',
      fromX: 130,
      fromY: 100,
      toX: 140,
      toY: 110,
    });
    expect(g.up(1, 140, 110)).toBeNull();
  });

  it('aims instead of panning while armed, and casts on release', () => {
    const g = new TouchGestures();
    g.setArmed(true);
    g.down(1, 100, 100);
    expect(g.move(1, 150, 120)).toEqual({ kind: 'aim', x: 150, y: 120 });
    expect(g.up(1, 150, 120)).toEqual({ kind: 'tap', x: 150, y: 120 });
  });

  it('still taps instantly while armed', () => {
    const g = new TouchGestures();
    g.setArmed(true);
    g.down(1, 80, 80);
    expect(g.up(1, 80, 80)).toEqual({ kind: 'tap', x: 80, y: 80 });
  });

  it('pinches with two fingers: spreading gives a factor above 1', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100);
    g.down(2, 200, 100);
    const a = g.move(2, 300, 100);
    expect(a?.kind).toBe('pinch');
    if (a?.kind === 'pinch') expect(a.factor).toBeCloseTo(2);
    const b = g.move(2, 250, 100);
    if (b?.kind === 'pinch') expect(b.factor).toBeCloseTo(0.75);
  });

  it('a second finger kills the pending tap, and the survivor stays dead', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100);
    g.down(2, 200, 100);
    g.up(2, 200, 100);
    // The remaining finger neither taps nor pans: the gesture was a pinch.
    expect(g.move(1, 160, 100)).toBeNull();
    expect(g.up(1, 160, 100)).toBeNull();
  });

  it('cancel forgets the pointer entirely', () => {
    const g = new TouchGestures();
    g.down(1, 100, 100);
    g.cancel(1);
    expect(g.up(1, 100, 100)).toBeNull();
  });
});
