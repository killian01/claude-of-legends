// The thumb cluster (src/ui/thumb_cluster.ts) never overlaps itself: every
// slot, sigil, level-up mark and the attack button keeps clear of every
// other, the whole of it fits its box, and the box keeps to the lower part
// of the shortest phone. Every button, and every mark's tap ring, is a
// finger's size there too.

import { describe, expect, it } from 'vitest';
import { MIN_TAP_PX, MIN_THUMB_SCALE } from '../src/game/ui_scale';
import {
  circleGap,
  MARK_R,
  MARK_TAP_R,
  type ThumbCircle,
  thumbCluster,
  thumbClusterCss,
} from '../src/ui/thumb_cluster';

// A fingertip's worth of clear space between two things a thumb aims at.
const MIN_GAP = 8;
// The shortest phone the cluster is drawn for, in landscape.
const SHORT_PHONE_HEIGHT = 360;

describe('thumb cluster', () => {
  const c = thumbCluster();
  const named = (list: readonly ThumbCircle[], prefix: string): ThumbCircle[] =>
    list.map((x) => ({ ...x, key: `${prefix}${x.key}` }));
  const everything: ThumbCircle[] = [
    c.attack,
    ...named(c.slots, 'slot '),
    ...named(c.sigils, 'sigil '),
    ...named(c.marks, 'mark '),
  ];

  it('lays out Q W E R, D F, the attack button and one mark per slot', () => {
    expect(c.slots.map((s) => s.key)).toEqual(['Q', 'W', 'E', 'R']);
    expect(c.sigils.map((s) => s.key)).toEqual(['D', 'F']);
    expect(c.marks.map((m) => m.key)).toEqual(['Q', 'W', 'E', 'R']);
    expect(c.taps.map((t) => t.key)).toEqual(['Q', 'W', 'E', 'R']);
    for (const m of c.marks) expect(m.r).toBe(MARK_R);
    for (const t of c.taps) expect(t.r).toBe(MARK_TAP_R);
  });

  it('keeps every pair clear of each other, a mark excepted from its own slot', () => {
    for (let i = 0; i < everything.length; i++) {
      for (let j = i + 1; j < everything.length; j++) {
        const a = everything[i]!;
        const b = everything[j]!;
        const ownMark =
          (a.key.startsWith('mark ') && b.key === `slot ${a.key.slice(5)}`) ||
          (b.key.startsWith('mark ') && a.key === `slot ${b.key.slice(5)}`);
        if (ownMark) continue;
        expect(circleGap(a, b), `${a.key} vs ${b.key}`).toBeGreaterThanOrEqual(MIN_GAP);
      }
    }
  });

  it('sits on its slot: a mark overlaps the slot it levels, and only that', () => {
    for (const m of c.marks) {
      const s = c.slots.find((x) => x.key === m.key)!;
      expect(circleGap(m, s)).toBeLessThan(0);
    }
  });

  it('fits its box, from the corner', () => {
    for (const x of everything) {
      expect(x.right - x.r, x.key).toBeGreaterThanOrEqual(0);
      expect(x.bottom - x.r, x.key).toBeGreaterThanOrEqual(0);
      expect(x.right + x.r, x.key).toBeLessThanOrEqual(c.width);
      expect(x.bottom + x.r, x.key).toBeLessThanOrEqual(c.height);
    }
  });

  it('keeps the ultimate in the lower part of the shortest phone', () => {
    expect((c.height * MIN_THUMB_SCALE) / SHORT_PHONE_HEIGHT).toBeLessThanOrEqual(0.42);
  });

  it('draws every button a finger wide on the shortest phone', () => {
    for (const x of [c.attack, ...named(c.slots, 'slot '), ...named(c.sigils, 'sigil ')]) {
      expect(2 * x.r * MIN_THUMB_SCALE, x.key).toBeGreaterThanOrEqual(MIN_TAP_PX);
    }
    for (const t of c.taps) {
      expect(2 * t.r * MIN_THUMB_SCALE, `tap ${t.key}`).toBeGreaterThanOrEqual(MIN_TAP_PX);
    }
  });

  it("taps a mark through a ring that reaches nothing but the mark's own slot", () => {
    const rings = named(c.taps, 'tap ');
    for (const ring of rings) {
      const key = ring.key.slice(4);
      for (const other of [...everything, ...rings]) {
        if (other === ring || other.key === `slot ${key}` || other.key === `mark ${key}`) continue;
        expect(circleGap(ring, other), `${ring.key} vs ${other.key}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps a tap ring no deeper into its slot than the mark it rings', () => {
    for (const t of c.taps) {
      const m = c.marks.find((x) => x.key === t.key)!;
      const s = c.slots.find((x) => x.key === t.key)!;
      const reach = (x: ThumbCircle): number =>
        Math.hypot(x.right - s.right, x.bottom - s.bottom) - x.r;
      // The ring's nearest point to the slot's middle is no nearer than the mark's.
      expect(reach(t), t.key).toBeGreaterThanOrEqual(reach(m) - 0.2);
      // And it rings the mark: the whole mark is inside it.
      expect(Math.hypot(t.right - m.right, t.bottom - m.bottom) + m.r, t.key).toBeLessThanOrEqual(
        t.r + 0.2,
      );
    }
  });

  it('writes one placement rule per circle and one per mark and tap ring', () => {
    const css = thumbClusterCss(c);
    expect(css).toContain(`.hud.thumbs .hud-slots { width: ${c.width}px; height: ${c.height}px; }`);
    for (const key of ['Q', 'W', 'E', 'R', 'D', 'F']) {
      expect(css).toContain(`.hud.thumbs .hud-slot[data-key='${key}'] {`);
    }
    for (const key of ['Q', 'W', 'E', 'R']) {
      expect(css).toContain(`.hud.thumbs .hud-slot[data-key='${key}'] .hud-slot-up {`);
      expect(css).toContain(`.hud.thumbs .hud-slot[data-key='${key}'] .hud-slot-up::before {`);
    }
    expect(css).toContain(`width: ${2 * MARK_TAP_R}px; height: ${2 * MARK_TAP_R}px;`);
    // The attack button: 64 px at 12 px from the corner, as it was drawn.
    expect(css).toContain(
      '.hud.thumbs .hud-attack { right: 12px; bottom: 12px; width: 64px; height: 64px; }',
    );
  });
});
