// The rotated view (src/game/rotated_view.ts): when the match's stage
// turns for a phone held upright, where it is laid out, and how a client
// point of the page becomes a point on the stage.

import { describe, expect, it } from 'vitest';
import {
  type Edge,
  frameFor,
  frameMoved,
  isPortrait,
  type LockAnswer,
  pageEdgeOf,
  rectToStage,
  stagePlacement,
  stageSize,
  stageTurns,
  toClient,
  toStage,
  turnWallUp,
  type ViewFrame,
  wallFallback,
} from '../src/game/rotated_view';

// An iPhone held upright in Safari, and the same page turned.
const UPRIGHT: ViewFrame = { width: 390, height: 844, turned: false };
const TURNED: ViewFrame = { width: 390, height: 844, turned: true };

describe('when the stage turns', () => {
  const base = { enabled: true, coarsePointer: true, portrait: true, lock: 'refused' as const };

  it('turns for a touchscreen held upright that the browser would not turn', () => {
    expect(stageTurns(base)).toBe(true);
  });

  it('waits for the browser to answer, so a phone about to rotate is never drawn turned', () => {
    expect(stageTurns({ ...base, lock: 'asking' })).toBe(false);
  });

  it('stands straight once the browser holds landscape, or the phone is sideways', () => {
    expect(stageTurns({ ...base, lock: 'granted' })).toBe(false);
    expect(stageTurns({ ...base, portrait: false })).toBe(false);
  });

  it('never turns for a mouse, and not when the setting is off', () => {
    expect(stageTurns({ ...base, coarsePointer: false })).toBe(false);
    expect(stageTurns({ ...base, enabled: false })).toBe(false);
  });

  it('reads upright the way the stylesheet does, a square included', () => {
    expect(isPortrait(390, 844)).toBe(true);
    expect(isPortrait(844, 390)).toBe(false);
    expect(isPortrait(600, 600)).toBe(true);
  });
});

describe('the frame the stage takes', () => {
  const inputs = { enabled: true, coarsePointer: true, lock: 'refused' as const };

  it('turns on an upright page and stands on a landscape one', () => {
    expect(frameFor(390, 844, inputs)).toEqual(TURNED);
    expect(frameFor(844, 390, inputs)).toEqual({ width: 844, height: 390, turned: false });
  });

  it('is laid out again when it turns or stands up, or the page resizes under a turn', () => {
    expect(frameMoved(UPRIGHT, TURNED)).toBe(true);
    expect(frameMoved(TURNED, { width: 844, height: 390, turned: false })).toBe(true);
    expect(frameMoved(TURNED, { width: 390, height: 780, turned: true })).toBe(true);
    expect(frameMoved(TURNED, TURNED)).toBe(false);
  });

  it('asks nothing of a straight stage when the page only resizes: it is the page', () => {
    expect(frameMoved(UPRIGHT, { width: 1440, height: 900, turned: false })).toBe(false);
  });
});

describe('the wall as the fallback', () => {
  it('is left only to the setting turned off and to the moment before the answer', () => {
    expect(wallFallback(true, 'refused', true)).toBe(false);
    expect(wallFallback(true, 'refused', false)).toBe(true);
    expect(wallFallback(true, 'asking', true)).toBe(true);
    expect(wallFallback(true, 'granted', true)).toBe(false);
    expect(wallFallback(true, 'granted', false)).toBe(false);
    expect(wallFallback(false, 'refused', false)).toBe(false);
  });

  it('never stands over a turned stage, and an upright phone always has one or the other', () => {
    const answers: LockAnswer[] = ['asking', 'granted', 'refused'];
    for (const lock of answers) {
      for (const enabled of [true, false]) {
        const turns = stageTurns({ enabled, coarsePointer: true, portrait: true, lock });
        const wall = wallFallback(true, lock, enabled);
        expect(turns && wall).toBe(false);
        // Upright, a phone the browser did not turn is either turned by
        // the page or asked to turn: never left cramped with neither.
        if (lock !== 'granted') expect(turns || wall).toBe(true);
      }
    }
  });
});

describe('the wall standing', () => {
  it('stands while a phone held upright waits on the browser, or has the setting off', () => {
    expect(turnWallUp(true, 'asking', true, true)).toBe(true);
    expect(turnWallUp(true, 'refused', false, true)).toBe(true);
  });

  it('is down over a turned stage, once the phone is sideways, or the browser holds landscape', () => {
    expect(turnWallUp(true, 'refused', true, true)).toBe(false);
    expect(turnWallUp(true, 'refused', false, false)).toBe(false);
    expect(turnWallUp(true, 'granted', false, true)).toBe(false);
  });

  it('never stands on a mouse, even on a tall window', () => {
    expect(turnWallUp(false, 'refused', false, true)).toBe(false);
  });
});

describe('the stage laid out on the page', () => {
  it('is the page itself while it stands straight', () => {
    expect(stageSize(UPRIGHT)).toEqual({ width: 390, height: 844 });
    expect(stagePlacement(UPRIGHT)).toEqual({
      left: 0,
      top: 0,
      width: 390,
      height: 844,
      rotate: 0,
    });
  });

  it('is the landscape box the phone would have if the page turned', () => {
    expect(stageSize(TURNED)).toEqual({ width: 844, height: 390 });
    expect(stagePlacement(TURNED)).toEqual({
      left: -227,
      top: 227,
      width: 844,
      height: 390,
      rotate: 90,
    });
  });

  it('lands exactly on the page once CSS turns it a quarter about its center', () => {
    // rotate(90deg) in CSS, y pointing down: (dx, dy) goes to (-dy, dx).
    const box = stagePlacement(TURNED);
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    for (const [sx, sy] of [
      [0, 0],
      [box.width, 0],
      [0, box.height],
      [box.width, box.height],
      [100, 250],
    ] as const) {
      const dx = box.left + sx - cx;
      const dy = box.top + sy - cy;
      const shown = { x: cx - dy, y: cy + dx };
      const mapped = toClient(TURNED, sx, sy);
      expect(mapped.x).toBeCloseTo(shown.x, 9);
      expect(mapped.y).toBeCloseTo(shown.y, 9);
    }
  });
});

describe('a client point on the stage', () => {
  it('is unchanged while the stage stands straight', () => {
    expect(toStage(UPRIGHT, 120, 700)).toEqual({ x: 120, y: 700 });
    expect(toClient(UPRIGHT, 120, 700)).toEqual({ x: 120, y: 700 });
  });

  it('puts the stage corner at the top right of an upright page and keeps the center', () => {
    expect(toStage(TURNED, 390, 0)).toEqual({ x: 0, y: 0 });
    expect(toStage(TURNED, 390, 844)).toEqual({ x: 844, y: 0 });
    expect(toStage(TURNED, 0, 0)).toEqual({ x: 0, y: 390 });
    expect(toStage(TURNED, 195, 422)).toEqual({ x: 422, y: 195 });
  });

  it('goes back where it came from', () => {
    for (const [x, y] of [
      [0, 0],
      [37, 811],
      [389, 12],
    ] as const) {
      const s = toStage(TURNED, x, y);
      expect(toClient(TURNED, s.x, s.y)).toEqual({ x, y });
    }
  });

  it('reads a finger moving right on the upright page as moving up the turned match', () => {
    const from = toStage(TURNED, 150, 400);
    const to = toStage(TURNED, 210, 400);
    expect(to.x - from.x).toBe(0);
    expect(to.y - from.y).toBe(-60);
    // And down the page is right along the match.
    const lower = toStage(TURNED, 150, 460);
    expect(lower.x - from.x).toBe(60);
    expect(lower.y - from.y).toBe(0);
  });
});

describe('a client rect on the stage', () => {
  it('is copied as it is while the stage stands straight', () => {
    expect(rectToStage(UPRIGHT, { left: 10, top: 20, right: 60, bottom: 30 })).toEqual({
      left: 10,
      top: 20,
      right: 60,
      bottom: 30,
      width: 50,
      height: 10,
    });
  });

  it('trades its sides on a turned stage, and the whole page is the whole stage', () => {
    expect(rectToStage(TURNED, { left: 0, top: 0, right: 390, bottom: 844 })).toEqual({
      left: 0,
      top: 0,
      right: 844,
      bottom: 390,
      width: 844,
      height: 390,
    });
    // A card 100 wide and 40 tall on the stage is 40 wide and 100 tall on
    // the upright page, at the stage point its top left corner maps to.
    const card = rectToStage(TURNED, { left: 300, top: 50, right: 340, bottom: 150 });
    expect(card).toEqual({ left: 50, top: 50, right: 150, bottom: 90, width: 100, height: 40 });
    expect(toStage(TURNED, 340, 50)).toEqual({ x: card.left, y: card.top });
  });
});

describe('the safe area on a turned stage', () => {
  it('keeps every edge its own while the stage stands straight', () => {
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      expect(pageEdgeOf(false, edge)).toBe(edge);
    }
  });

  it('takes each inset from the page edge the stage edge lies along', () => {
    const { width, height } = stageSize(TURNED);
    const middles: Record<Edge, [number, number]> = {
      top: [width / 2, 0],
      right: [width, height / 2],
      bottom: [width / 2, height],
      left: [0, height / 2],
    };
    const onEdge = (p: { x: number; y: number }): Edge | null => {
      if (p.y === 0) return 'top';
      if (p.x === TURNED.width) return 'right';
      if (p.y === TURNED.height) return 'bottom';
      return p.x === 0 ? 'left' : null;
    };
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      const [x, y] = middles[edge];
      expect(onEdge(toClient(TURNED, x, y))).toBe(pageEdgeOf(true, edge));
    }
    // An upright phone's notch is at the top of the page: the stage's left.
    expect(pageEdgeOf(true, 'left')).toBe('top');
  });
});
