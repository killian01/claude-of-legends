// The tap targets of the older touch scheme, the tap to walk (CONTEXT.md:
// Thumb stick), as numbers. Its casting row sits in the bottom block under
// the bars, and the whole block is drawn at COMPACT_SCALE so a phone keeps
// the middle of its screen: the slots came out 33 px across there, the
// level-up + 19 px, and the lane card's and the feedback nudge's close
// buttons were 26 px. They keep their size to look at and are tapped
// through a transparent area round each (a ::before, which a tap on counts
// as a tap on its element), MIN_TAP_PX across once scaled. The gaps between
// the slots grew so the areas meet without overlapping, and a +'s area
// rises from the +'s own foot, which sits on top of its slot's area: the
// + takes nothing from the slot under it, the way the thumb cluster's
// rings keep off their slots (thumb_cluster.ts). A tap that could be
// either goes to the slot, which arms a cast a second tap can drop, not to
// the +, which spends a point for good. tests/compact_taps.test.ts holds
// the numbers to that; the look stays in the HUD's stylesheet.
//
// Boxes are unscaled CSS pixels from the first castable slot's top-left
// corner, y growing down the screen. Every box here is a border box: the
// HUD draws its slots, marks and buttons with a 1 px border inside their
// size (box-sizing: border-box), and a ::before is placed from inside it.

export const COMPACT_SCALE = 0.72;
// The bottom block's gap between its rows (the bars, the slots, the items).
export const COMPACT_ROW_GAP = 3;
const BORDER = 1;

export const SLOT = 46;
export const SLOT_GAP = 16;
// How far past its edge a slot's tap area reaches, on every side.
export const SLOT_REACH = 8;
// The level-up +, and the square its tap area fills above it.
export const UP_W = 26;
export const UP_H = 24;
export const UP_TAP = 62;
// The lane card's and the nudge's close buttons (not scaled: they are not
// in the bottom block), and their tap area.
export const CLOSE = 26;
export const CLOSE_TAP = 44;

// The row stands this far from the rows above and below it, so a slot's
// area reaches neither.
export const ROW_MARGIN = SLOT_REACH - COMPACT_ROW_GAP;

export interface TapBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CompactRow {
  slots: readonly TapBox[];
  slotTaps: readonly TapBox[];
  ups: readonly TapBox[];
  upTaps: readonly TapBox[];
}

const CASTABLE = ['Q', 'W', 'E', 'R', 'D', 'F'] as const;
const RANKED = new Set<string>(['Q', 'W', 'E', 'R']);

export function compactRow(): CompactRow {
  const slots = CASTABLE.map((key, i) => ({
    key,
    x: i * (SLOT + SLOT_GAP),
    y: 0,
    w: SLOT,
    h: SLOT,
  }));
  const slotTaps = slots.map((s) => ({
    key: s.key,
    x: s.x - SLOT_REACH,
    y: s.y - SLOT_REACH,
    w: s.w + 2 * SLOT_REACH,
    h: s.h + 2 * SLOT_REACH,
  }));
  const ranked = slots.filter((s) => RANKED.has(s.key));
  // The + stands on top of its slot's area, centered over the slot.
  const ups = ranked.map((s) => ({
    key: s.key,
    x: s.x + (s.w - UP_W) / 2,
    y: s.y - SLOT_REACH - UP_H,
    w: UP_W,
    h: UP_H,
  }));
  const upTaps = ups.map((u) => ({
    key: u.key,
    x: u.x + (u.w - UP_TAP) / 2,
    y: u.y + u.h - UP_TAP,
    w: UP_TAP,
    h: UP_TAP,
  }));
  return { slots, slotTaps, ups, upTaps };
}

// How far two boxes overlap along the axis where they overlap least; zero
// or less when they do not overlap.
export function boxOverlap(a: TapBox, b: TapBox): number {
  const x = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return Math.min(x, y);
}

// The geometry as CSS, sizes and places only. The HUD's compact rules
// scale the block by COMPACT_SCALE and space its rows by COMPACT_ROW_GAP.
export function compactTapsCss(): string {
  const tap = '.hud.compact:not(.thumbs)';
  return [
    `${tap} .hud-slots { gap: ${SLOT_GAP}px; margin: ${ROW_MARGIN}px 0; }`,
    `${tap} .hud-slot[data-key]::before { content: ''; position: absolute; ` +
      `inset: -${SLOT_REACH + BORDER}px; }`,
    // The + over its slot, its foot on top of the slot's tap area. It is
    // placed from inside the slot's border, hence the border's pixel.
    `${tap} .hud-slot-up { width: ${UP_W}px; height: ${UP_H}px; ` +
      `top: -${SLOT_REACH + UP_H + BORDER}px; font-size: 17px; ` +
      `line-height: ${UP_H - 2 * BORDER}px; }`,
    `${tap} .hud-slot-up::before { content: ''; position: absolute; left: 50%; ` +
      `bottom: -${BORDER}px; width: ${UP_TAP}px; height: ${UP_TAP}px; transform: translateX(-50%); }`,
    '.hud.compact .hud-lane-close, .hud.compact .hud-nudge-close { position: relative; }',
    '.hud.compact .hud-lane-close::before, .hud.compact .hud-nudge-close::before { ' +
      `content: ''; position: absolute; inset: -${(CLOSE_TAP - CLOSE) / 2 + BORDER}px; ` +
      'border-radius: 50%; }',
  ].join('\n');
}
