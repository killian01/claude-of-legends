// The two marks (ui/balances.ts). The drawing is a matter of taste and
// not testable; what is testable is the geometry the wreath is built from
// and the number beside it, and one rule that is not taste at all: the
// word must survive somewhere a screen reader can reach, because the
// whole change is that it stops being printed.

import { describe, expect, it } from 'vitest';
import {
  BALANCE_COLOR,
  BALANCE_WORD,
  format,
  LEAF_LEAN_DEG,
  LEAF_RX,
  LEAVES_PER_SIDE,
  leafAngle,
  THOUSANDS,
  wreathLeaves,
} from '../src/ui/balances';

describe('the wreath', () => {
  it('carries the same count of leaves on both sides', () => {
    const leaves = wreathLeaves();
    expect(leaves).toHaveLength(LEAVES_PER_SIDE * 2);
    expect(leaves.filter((l) => l.side === -1)).toHaveLength(LEAVES_PER_SIDE);
    expect(leaves.filter((l) => l.side === 1)).toHaveLength(LEAVES_PER_SIDE);
  });

  it('is symmetric about the middle of its box', () => {
    // A wreath that leans is a wreath that reads as a mistake at 14px.
    const left = wreathLeaves().filter((l) => l.side === -1);
    const right = wreathLeaves().filter((l) => l.side === 1);
    for (const [i, l] of left.entries()) {
      const r = right[i];
      expect(r).toBeDefined();
      expect(l.x + (r?.x ?? 0)).toBeCloseTo(24, 5);
      expect(l.y).toBeCloseTo(r?.y ?? 0, 5);
      // Reflected about the vertical, which is 180 minus the angle.
      expect(l.angleDeg).toBeCloseTo(180 - (r?.angleDeg ?? 0), 5);
    }
  });

  it('stays inside its own box', () => {
    // A mark that clips looks broken next to the one beside it.
    for (const l of wreathLeaves()) {
      expect(l.x).toBeGreaterThan(LEAF_RX);
      expect(l.x).toBeLessThan(24 - LEAF_RX);
      expect(l.y).toBeGreaterThan(LEAF_RX);
      expect(l.y).toBeLessThan(24 - LEAF_RX);
    }
  });

  it('lays each leaf along the arc and not across it', () => {
    // The first cut used the normal instead of the tangent, so every leaf
    // pointed at the centre and the mark came out a cog. At the side of
    // the circle the arc runs vertically, so a leaf there is upright.
    expect(leafAngle(90) - LEAF_LEAN_DEG).toBeCloseTo(-90, 5);
    // At the foot it runs horizontally.
    expect(leafAngle(0) - LEAF_LEAN_DEG).toBeCloseTo(0, 5);
  });

  it('opens at the crown by more than a leaf is long', () => {
    // The gap at the top is the whole silhouette: closed, it is a ring,
    // and a ring reads as a coin at 14px. The first cut of this shape
    // ended the arc past the crown, so the two top leaves crossed over
    // each other and the mark came out a closed circle.
    const top = Math.min(...wreathLeaves().map((l) => l.y));
    const highest = wreathLeaves().filter((l) => Math.abs(l.y - top) < 0.01);
    expect(highest).toHaveLength(2);
    const spread = Math.abs((highest[0]?.x ?? 0) - (highest[1]?.x ?? 0));
    expect(spread).toBeGreaterThan(LEAF_RX * 2);
  });

  it('closes at the foot, where the two branches meet', () => {
    // Open at both ends is a pair of brackets, not a wreath.
    const bottom = Math.max(...wreathLeaves().map((l) => l.y));
    const lowest = wreathLeaves().filter((l) => Math.abs(l.y - bottom) < 0.01);
    expect(lowest).toHaveLength(2);
    const spread = Math.abs((lowest[0]?.x ?? 0) - (lowest[1]?.x ?? 0));
    expect(spread).toBeLessThan(LEAF_RX * 2);
  });
});

describe('the number', () => {
  it('breaks four digits and up, and leaves the rest alone', () => {
    expect(format(0)).toBe('0');
    expect(format(60)).toBe('60');
    expect(format(999)).toBe('999');
    expect(format(1000)).toBe(`1${THOUSANDS}000`);
    expect(format(1250)).toBe(`1${THOUSANDS}250`);
    expect(format(1234567)).toBe(`1${THOUSANDS}234${THOUSANDS}567`);
  });

  it('separates with a space that cannot wrap or be mistyped', () => {
    // An ordinary space here splits a balance across two lines in a bar
    // that is already tight, and looks identical in the source.
    expect(THOUSANDS).toBe('\u202f');
    expect(format(1250)).not.toContain(' ');
  });

  it('rounds rather than showing a fraction of a laurel', () => {
    expect(format(60.4)).toBe('60');
    expect(format(60.6)).toBe('61');
  });
});

describe('the two marks', () => {
  it('never share a colour', () => {
    // Nothing converts one into the other (ADR 0017, ADR 0018), so the
    // one thing they must never do is look alike.
    expect(BALANCE_COLOR.laurels).not.toBe(BALANCE_COLOR.embers);
  });

  it('keep the word for the tooltip and the screen reader', () => {
    for (const kind of ['laurels', 'embers'] as const) {
      expect(BALANCE_WORD[kind].length).toBeGreaterThan(0);
    }
    expect(BALANCE_WORD.laurels.toLowerCase()).toContain('laurel');
    expect(BALANCE_WORD.embers.toLowerCase()).toContain('ember');
  });
});
