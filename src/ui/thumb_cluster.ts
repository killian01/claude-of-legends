// The thumb cluster's geometry (CONTEXT.md: Thumb stick): where the attack
// button, the four casting slots, the two sigils and the level-up marks sit
// in the bottom-right corner of a phone's screen, as numbers. The HUD turns
// them into CSS (thumbClusterCss) and tests/thumb_cluster.test.ts checks
// that nothing in the cluster overlaps anything else: the first cluster
// shipped with the marks over the next slot along the arc and the slots'
// corners touching, and a player wrote that the spells overlapped.
//
// Every button is a finger's size even on the shortest phone: a slot, a
// sigil and a mark's tap ring are at least MIN_TAP_PX across once the
// cluster is scaled down to MIN_THUMB_SCALE (ui_scale.ts). They were 34
// to 43 px on a 360 px tall phone, and the level-up mark 19. A mark stays
// small to look at and is tapped through a ring round it, pushed out from
// its slot so that it reaches no deeper into the slot than the mark does.
//
// Coordinates are the distance of a circle's center from the screen's
// right and bottom edges, in unscaled CSS pixels; the HUD scales the
// whole cluster with the phone's height (ui_scale.ts, --thumb-scale).

export interface ThumbCircle {
  key: string;
  right: number;
  bottom: number;
  r: number;
}

export interface ThumbCluster {
  // The box the cluster is laid out in, anchored to the corner.
  width: number;
  height: number;
  attack: ThumbCircle;
  // Q W E R, on one arc round the attack button from the left to straight
  // above: an ellipse wider than tall, so the ultimate at the top stays in
  // the lower part of the screen.
  slots: readonly ThumbCircle[];
  // D F, further left on an outer ring at the arc's foot.
  sigils: readonly ThumbCircle[];
  // One level-up mark per casting slot, keyed like the slot: on the slot's
  // upper-left shoulder, centered on its rim, which points away from the
  // next slot along the arc and from the sigils.
  marks: readonly ThumbCircle[];
  // Where each mark is tapped, keyed like it: a finger-sized ring round
  // the mark, pushed out along the shoulder.
  taps: readonly ThumbCircle[];
}

const ATTACK: ThumbCircle = { key: 'attack', right: 44, bottom: 44, r: 32 };
const SLOT_R = 26;
const ULT_R = 27;
const SIGIL_R = 26;
export const MARK_R = 13;
export const MARK_TAP_R = 26;
const ARC = { rx: 150, ry: 88 };
const SLOT_ANGLES: readonly (readonly [string, number, number])[] = [
  ['Q', 180, SLOT_R],
  ['W', 143, SLOT_R],
  ['E', 114, SLOT_R],
  ['R', 90, ULT_R],
];
const SIGIL_RING = { rx: 232, ry: 158 };
const SIGIL_ANGLES: readonly (readonly [string, number])[] = [
  ['D', 180],
  ['F', 150],
];
const MARK_ANGLE = 125;
const MARGIN = 4;

const round = (v: number): number => Math.round(v * 10) / 10;

// A point on an ellipse round the attack button; 180 degrees is straight
// left of it, 90 straight above.
function onArc(rx: number, ry: number, degrees: number): { right: number; bottom: number } {
  const a = (degrees * Math.PI) / 180;
  return {
    right: round(ATTACK.right - rx * Math.cos(a)),
    bottom: round(ATTACK.bottom + ry * Math.sin(a)),
  };
}

// A point `by` pixels from `c` toward the slots' shoulder.
function alongShoulder(
  c: { right: number; bottom: number },
  by: number,
): { right: number; bottom: number } {
  const a = (MARK_ANGLE * Math.PI) / 180;
  return { right: round(c.right - by * Math.cos(a)), bottom: round(c.bottom + by * Math.sin(a)) };
}

export function thumbCluster(): ThumbCluster {
  const slots = SLOT_ANGLES.map(([key, deg, r]) => ({ key, r, ...onArc(ARC.rx, ARC.ry, deg) }));
  const sigils = SIGIL_ANGLES.map(([key, deg]) => ({
    key,
    r: SIGIL_R,
    ...onArc(SIGIL_RING.rx, SIGIL_RING.ry, deg),
  }));
  const marks = slots.map((s) => ({ key: s.key, r: MARK_R, ...alongShoulder(s, s.r) }));
  // The ring's inner edge sits where the mark's own does.
  const taps = marks.map((m) => ({
    key: m.key,
    r: MARK_TAP_R,
    ...alongShoulder(m, MARK_TAP_R - MARK_R),
  }));
  const all = [ATTACK, ...slots, ...sigils, ...marks];
  const width = Math.ceil(Math.max(...all.map((c) => c.right + c.r)) + MARGIN);
  const height = Math.ceil(Math.max(...all.map((c) => c.bottom + c.r)) + MARGIN);
  return { width, height, attack: ATTACK, slots, sigils, marks, taps };
}

// The clear space between two circles; negative when they overlap.
export function circleGap(a: ThumbCircle, b: ThumbCircle): number {
  const dx = a.right - b.right;
  const dy = a.bottom - b.bottom;
  return Math.sqrt(dx * dx + dy * dy) - a.r - b.r;
}

// The geometry as CSS, sizes and places only; the look stays in the HUD's
// stylesheet. A mark is a child of its slot, so it is placed inside the
// slot's box; its tap ring is the mark's ::before (a tap on it is a tap on
// the mark), placed from the mark's middle.
export function thumbClusterCss(c: ThumbCluster = thumbCluster()): string {
  const px = (v: number): string => `${round(v)}px`;
  const place = (circle: ThumbCircle): string =>
    `right: ${px(circle.right - circle.r)}; bottom: ${px(circle.bottom - circle.r)}; ` +
    `width: ${px(2 * circle.r)}; height: ${px(2 * circle.r)};`;
  const lines = [
    `.hud.thumbs .hud-slots { width: ${px(c.width)}; height: ${px(c.height)}; }`,
    `.hud.thumbs .hud-attack { ${place(c.attack)} }`,
  ];
  for (const s of [...c.slots, ...c.sigils]) {
    lines.push(`.hud.thumbs .hud-slot[data-key='${s.key}'] { ${place(s)} }`);
  }
  for (const m of c.marks) {
    const s = c.slots.find((x) => x.key === m.key);
    if (!s) continue;
    const inside: ThumbCircle = {
      key: m.key,
      r: m.r,
      right: m.right - (s.right - s.r),
      bottom: m.bottom - (s.bottom - s.r),
    };
    // The line height is the box less its 1 px border, so the + sits
    // in the middle.
    lines.push(
      `.hud.thumbs .hud-slot[data-key='${m.key}'] .hud-slot-up { ` +
        `left: auto; top: auto; transform: none; ${place(inside)} ` +
        `line-height: ${px(2 * m.r - 2)}; }`,
    );
    const tap = c.taps.find((x) => x.key === m.key);
    if (!tap) continue;
    // Screen offsets from the mark's middle: right and bottom grow toward
    // the left and the top of the screen.
    const dx = m.right - tap.right;
    const dy = m.bottom - tap.bottom;
    lines.push(
      `.hud.thumbs .hud-slot[data-key='${m.key}'] .hud-slot-up::before { ` +
        `content: ''; position: absolute; border-radius: 50%; ` +
        `left: calc(50% + ${px(dx - tap.r)}); top: calc(50% + ${px(dy - tap.r)}); ` +
        `width: ${px(2 * tap.r)}; height: ${px(2 * tap.r)}; }`,
    );
  }
  return lines.join('\n');
}
