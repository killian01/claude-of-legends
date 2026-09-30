// The tap to walk's tap targets (src/ui/compact_taps.ts): every slot, every
// level-up + and both close buttons are a finger wide once the compact HUD
// is scaled, no two tap areas overlap, and a +'s area takes nothing from
// the slot under it.

import { describe, expect, it } from 'vitest';
import { MIN_TAP_PX } from '../src/game/ui_scale';
import {
  boxOverlap,
  CLOSE,
  CLOSE_TAP,
  COMPACT_ROW_GAP,
  COMPACT_SCALE,
  compactRow,
  compactTapsCss,
  ROW_MARGIN,
  SLOT,
  SLOT_REACH,
  type TapBox,
} from '../src/ui/compact_taps';

const contains = (outer: TapBox, inner: TapBox): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

describe('the tap to walk tap targets', () => {
  const row = compactRow();
  const named = (list: readonly TapBox[], prefix: string): TapBox[] =>
    list.map((b) => ({ ...b, key: `${prefix}${b.key}` }));
  const taps = [...named(row.slotTaps, 'slot '), ...named(row.upTaps, '+ ')];

  it('lays out the six castable slots, and a + over each spell', () => {
    expect(row.slots.map((s) => s.key)).toEqual(['Q', 'W', 'E', 'R', 'D', 'F']);
    expect(row.ups.map((u) => u.key)).toEqual(['Q', 'W', 'E', 'R']);
  });

  it('makes every slot and every + a finger wide on the screen', () => {
    for (const t of taps) {
      expect(t.w * COMPACT_SCALE, t.key).toBeGreaterThanOrEqual(MIN_TAP_PX);
      expect(t.h * COMPACT_SCALE, t.key).toBeGreaterThanOrEqual(MIN_TAP_PX);
    }
  });

  it('keeps every tap area clear of every other', () => {
    for (let i = 0; i < taps.length; i++) {
      for (let j = i + 1; j < taps.length; j++) {
        const a = taps[i]!;
        const b = taps[j]!;
        expect(boxOverlap(a, b), `${a.key} vs ${b.key}`).toBeLessThanOrEqual(0);
      }
    }
  });

  it('draws each target inside its own tap area', () => {
    for (const s of row.slots) {
      expect(contains(row.slotTaps.find((t) => t.key === s.key)!, s), s.key).toBe(true);
    }
    for (const u of row.ups) {
      expect(contains(row.upTaps.find((t) => t.key === u.key)!, u), u.key).toBe(true);
    }
  });

  it('stands each + on top of its slot area, taking none of it', () => {
    for (const u of row.ups) {
      for (const t of row.slotTaps) {
        expect(boxOverlap(u, t), `${u.key} vs ${t.key}`).toBeLessThanOrEqual(0);
      }
      const own = row.slotTaps.find((t) => t.key === u.key)!;
      expect(u.y + u.h).toBe(own.y);
    }
  });

  it('keeps the slot areas off the bars above and the items below', () => {
    const gap = COMPACT_ROW_GAP + ROW_MARGIN;
    for (const t of row.slotTaps) {
      expect(t.y).toBeGreaterThanOrEqual(-gap);
      expect(t.y + t.h).toBeLessThanOrEqual(SLOT + gap);
    }
    expect(SLOT_REACH).toBeLessThanOrEqual(gap);
  });

  it('makes the close buttons a finger wide', () => {
    expect(CLOSE_TAP).toBeGreaterThanOrEqual(MIN_TAP_PX);
    expect(CLOSE_TAP).toBeGreaterThan(CLOSE);
  });

  it('writes the areas for the tap to walk only, the close buttons for every touchscreen', () => {
    const css = compactTapsCss();
    expect(css).toContain(".hud.compact:not(.thumbs) .hud-slot[data-key]::before { content: '';");
    // From inside a 1 px border: 44 + 2 x 9 = 62, the slot and its reach.
    expect(css).toContain('inset: -9px;');
    expect(css).toContain('.hud.compact:not(.thumbs) .hud-slot-up::before {');
    expect(css).toContain('width: 62px; height: 62px;');
    // From inside a 1 px border: 24 + 2 x 10 = 44.
    expect(css).toContain(
      '.hud.compact .hud-lane-close::before, .hud.compact .hud-nudge-close::before',
    );
    expect(css).toContain('inset: -10px;');
  });
});
