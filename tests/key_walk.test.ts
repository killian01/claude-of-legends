import { describe, expect, it } from 'vitest';
import {
  isWalkKey,
  KEY_WALK_LEAD_PX,
  KEY_WALK_REPEAT_S,
  KeyWalk,
  keyWalkAim,
} from '../src/game/key_walk';

describe('walking with the arrow keys', () => {
  it('only the arrows walk; W A S D keep their own verbs', () => {
    expect(isWalkKey('ArrowUp')).toBe(true);
    expect(isWalkKey('ArrowLeft')).toBe(true);
    for (const k of ['w', 'a', 's', 'd', 'W', ' ']) expect(isWalkKey(k)).toBe(false);
  });

  it('a press walks at once, again every repeat while held, and stops once let go', () => {
    const k = new KeyWalk();
    expect(k.step(0)).toBeNull();
    k.press('ArrowUp');
    expect(k.step(1)).toEqual({ kind: 'walk', dir: { x: 0, y: -1 } });
    expect(k.step(1 + KEY_WALK_REPEAT_S / 2)).toBeNull();
    expect(k.step(1 + KEY_WALK_REPEAT_S)).toEqual({ kind: 'walk', dir: { x: 0, y: -1 } });
    k.release('ArrowUp');
    expect(k.step(2)).toEqual({ kind: 'stop' });
    expect(k.step(3)).toBeNull();
  });

  it('a second arrow turns the walk at once, on the diagonal', () => {
    const k = new KeyWalk();
    k.press('ArrowUp');
    k.step(1);
    k.press('ArrowRight');
    const s = k.step(1.01);
    expect(s?.kind).toBe('walk');
    if (s?.kind !== 'walk') return;
    expect(s.dir.x).toBeCloseTo(Math.SQRT1_2);
    expect(s.dir.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it('opposite arrows cancel into a stop; a lost keyboard lets every arrow go', () => {
    const k = new KeyWalk();
    k.press('ArrowLeft');
    k.step(0);
    k.press('ArrowRight');
    expect(k.step(0.01)).toEqual({ kind: 'stop' });
    k.release('ArrowRight');
    expect(k.step(0.02)?.kind).toBe('walk');
    k.releaseAll();
    expect(k.step(0.03)).toEqual({ kind: 'stop' });
    expect(k.dir()).toBeNull();
  });

  it('aims ahead of the champion on screen, the way the arrows point', () => {
    expect(keyWalkAim({ x: 400, y: 300 }, { x: 1, y: 0 })).toEqual({
      x: 400 + KEY_WALK_LEAD_PX,
      y: 300,
    });
    expect(keyWalkAim({ x: 400, y: 300 }, { x: 0, y: -1 })).toEqual({
      x: 400,
      y: 300 - KEY_WALK_LEAD_PX,
    });
  });
});
