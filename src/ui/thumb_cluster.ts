// The thumb cluster's geometry (CONTEXT.md: Thumb stick): where the attack
// button, the four casting slots, the two sigils and the level-up marks sit
// in the bottom-right corner of a phone's screen, as numbers. The HUD turns
// them into CSS (thumbClusterCss) and tests/thumb_cluster.test.ts checks
// that nothing in the cluster overlaps anything else: the first cluster
// shipped with the marks over the next slot along the arc and the slots'
// corners touching, and a player wrote that the spells overlapped.
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
}

const ATTACK: ThumbCircle = { key: 'attack', right: 44, bottom: 44, r: 32 };
const SLOT_R = 23;
const ULT_R = 25;
const SIGIL_R = 20;
export const MARK_R = 11;
const ARC = { rx: 132, ry: 94 };
const SLOT_ANGLES: readonly (readonly [string, number, number])[] = [
  ['Q', 180, SLOT_R],
  ['W', 146, SLOT_R],
  ['E', 116, SLOT_R],
  ['R', 90, ULT_R],
];
const SIGIL_RING = { rx: 188, ry: 118 };
const SIGIL_ANGLES: readonly (readonly [string, number])[] = [
  ['D', 180],
  ['F', 152],
];
const MARK_ANGLE = 135;
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

export function thumbCluster(): ThumbCluster {
  const slots = SLOT_ANGLES.map(([key, deg, r]) => ({ key, r, ...onArc(ARC.rx, ARC.ry, deg) }));
  const sigils = SIGIL_ANGLES.map(([key, deg]) => ({
    key,
    r: SIGIL_R,
    ...onArc(SIGIL_RING.rx, SIGIL_RING.ry, deg),
  }));
  const a = (MARK_ANGLE * Math.PI) / 180;
  const marks = slots.map((s) => ({
    key: s.key,
    r: MARK_R,
    right: round(s.right - s.r * Math.cos(a)),
    bottom: round(s.bottom + s.r * Math.sin(a)),
  }));
  const all = [ATTACK, ...slots, ...sigils, ...marks];
  const width = Math.ceil(Math.max(...all.map((c) => c.right + c.r)) + MARGIN);
  const height = Math.ceil(Math.max(...all.map((c) => c.bottom + c.r)) + MARGIN);
  return { width, height, attack: ATTACK, slots, sigils, marks };
}

// The clear space between two circles; negative when they overlap.
export function circleGap(a: ThumbCircle, b: ThumbCircle): number {
  const dx = a.right - b.right;
  const dy = a.bottom - b.bottom;
  return Math.sqrt(dx * dx + dy * dy) - a.r - b.r;
}

// The geometry as CSS, sizes and places only; the look stays in the HUD's
// stylesheet. A mark is a child of its slot, so it is placed inside the
// slot's box.
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
    lines.push(
      `.hud.thumbs .hud-slot[data-key='${m.key}'] .hud-slot-up { ` +
        `left: auto; top: auto; transform: none; ${place(inside)} }`,
    );
  }
  return lines.join('\n');
}
