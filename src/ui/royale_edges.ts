// The arrows at the screen's edge (the loud moments): what everyone should
// find on the Wanderseed and is not on the screen right now (a Seedfall's
// column, and later a Rising, the Wrath, the Lodestar, an Ablaze run)
// points at from the border, with how far it is. Pure: the targets come in
// already projected by the renderer (render/royale_cues.ts), the screen's
// safe area beside them, and the arrows come out placed and turned. The
// HUD draws them (ui/royale_hud_moments.ts).

import { SEEDFALL_AT_S } from '../sim/content/royale_events';

// What an arrow points at, in priority order: a Seedfall before a Rising
// before the Wrath before the Lodestar before an Ablaze run.
export type EdgeKind = 'seedfall' | 'rising' | 'wrath' | 'lodestar' | 'ablaze';
export const EDGE_PRIORITY: readonly EdgeKind[] = [
  'seedfall',
  'rising',
  'wrath',
  'lodestar',
  'ablaze',
];

// At most this many arrows at once: more is a frame of noise.
export const MAX_ARROWS = 3;

// A target as the renderer projected it: its screen point in the stage's
// pixels (off the screen when it is), whether it stands behind the camera
// (the point is then mirrored through the screen's middle, as a
// perspective projection leaves it), and how far it is along the ground.
// `hidden` when the planet stands between it and the camera: past the
// horizon a point still projects onto the globe's disc, inside the screen,
// so it is pointed at by `bearing` (radians off the camera's forward along
// the ground, positive to the right) instead. `secondsLeft` until what it
// marks happens, read under the arrow while it counts down.
export interface EdgeTarget {
  key: string;
  kind: EdgeKind;
  x: number;
  y: number;
  behind: boolean;
  hidden?: boolean;
  bearing?: number;
  distance: number;
  secondsLeft?: number;
}

// The screen, and the band at each side the arrows keep out of (the top
// bar, the ability bar, the minimap, the thumbs), in the same pixels.
export interface EdgeView {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface EdgeArrow {
  key: string;
  kind: EdgeKind;
  // Where the arrow stands, on the safe area's border.
  x: number;
  y: number;
  // Its heading in radians, 0 pointing right, PI/2 pointing down.
  angle: number;
  distance: number;
  label: string;
}

// Meters, rounded the way a glance reads them.
export function distanceLabel(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.max(1, Math.round(m))} m`;
}

// The arrow's line: the distance, and the seconds left while it counts.
function arrowLabel(t: Pick<EdgeTarget, 'distance' | 'secondsLeft'>): string {
  const d = distanceLabel(t.distance);
  if (t.secondsLeft === undefined) return d;
  const s = Math.max(0, Math.ceil(t.secondsLeft));
  return `${d} \u00b7 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// A landed Seedfall nobody opened stops being pointed at once the next
// one is due (an interval after it landed): its column stands, but it no
// longer holds one of the few arrows.
export const SEEDFALL_STALE_S = (SEEDFALL_AT_S[1] ?? 200) - (SEEDFALL_AT_S[0] ?? 120);

export function seedfallPointed(landsAt: number, landed: boolean, now: number): boolean {
  return !landed || now - landsAt <= SEEDFALL_STALE_S;
}

// The safe area's rectangle, never inverted on a tiny screen.
function safeRect(v: EdgeView): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = Math.min(v.left, v.width / 2 - 1);
  const x1 = Math.max(v.width - v.right, v.width / 2 + 1);
  const y0 = Math.min(v.top, v.height / 2 - 1);
  const y1 = Math.max(v.height - v.bottom, v.height / 2 + 1);
  return { x0, y0, x1, y1 };
}

// Whether a target stands inside the safe area, in front of the camera:
// then it is seen and wants no arrow.
export function onScreen(
  t: Pick<EdgeTarget, 'x' | 'y' | 'behind' | 'hidden'>,
  v: EdgeView,
): boolean {
  if (t.behind || t.hidden) return false;
  const r = safeRect(v);
  return t.x >= r.x0 && t.x <= r.x1 && t.y >= r.y0 && t.y <= r.y1;
}

// The direction from the screen's middle toward a target: through its
// projection, mirrored when it stands behind the camera. A target dead
// behind points down, the way a turn around would bring it. A target the
// planet hides goes by its ground bearing: ahead is up the screen.
export function edgeDirection(
  t: Pick<EdgeTarget, 'x' | 'y' | 'behind' | 'hidden' | 'bearing'>,
  v: EdgeView,
): { dx: number; dy: number } {
  if (t.hidden && t.bearing !== undefined) {
    return { dx: Math.sin(t.bearing), dy: -Math.cos(t.bearing) };
  }
  const cx = v.width / 2;
  const cy = v.height / 2;
  let dx = t.x - cx;
  let dy = t.y - cy;
  if (t.behind) {
    dx = -dx;
    dy = -dy;
    // Behind is down the screen: the camera looks ahead and down.
    if (dy < Math.abs(dx) * 0.25) dy = Math.abs(dy) + Math.abs(dx) * 0.25 + 1;
  }
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return { dx: 0, dy: 1 };
  return { dx: dx / len, dy: dy / len };
}

// The arrow for one target: on the safe area's border along the ray from
// the screen's middle, pointing out.
export function clampToEdge(
  t: Pick<EdgeTarget, 'x' | 'y' | 'behind' | 'hidden' | 'bearing'>,
  v: EdgeView,
): { x: number; y: number; angle: number } {
  const r = safeRect(v);
  const cx = v.width / 2;
  const cy = v.height / 2;
  const { dx, dy } = edgeDirection(t, v);
  const tx = dx > 0 ? (r.x1 - cx) / dx : dx < 0 ? (r.x0 - cx) / dx : Number.POSITIVE_INFINITY;
  const ty = dy > 0 ? (r.y1 - cy) / dy : dy < 0 ? (r.y0 - cy) / dy : Number.POSITIVE_INFINITY;
  const k = Math.min(tx, ty);
  return { x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) };
}

// A phone's ring: the border there is the thumbs', the bar's, the
// minimap's and the feed's, so an arrow slid along it lands far from
// where it points. The arrows stand instead on an ellipse round the
// champion (the camera looks at it: the screen's middle), well inside the
// safe area.
export interface EdgeRing {
  rx: number;
  ry: number;
}

export function compactRing(v: EdgeView): EdgeRing {
  const r = safeRect(v);
  const cx = v.width / 2;
  const cy = v.height / 2;
  return {
    rx: 0.62 * Math.min(cx - r.x0, r.x1 - cx),
    ry: 0.8 * Math.min(cy - r.y0, r.y1 - cy),
  };
}

// The point of the ring at a heading.
function ringAt(angle: number, v: EdgeView, ring: EdgeRing): { x: number; y: number } {
  return {
    x: v.width / 2 + ring.rx * Math.cos(angle),
    y: v.height / 2 + ring.ry * Math.sin(angle),
  };
}

// The arrows this frame: the targets off the screen, by priority then
// nearest, at most MAX_ARROWS; on the safe area's border, or on the ring
// when one is given.
export function edgeArrows(
  targets: readonly EdgeTarget[],
  v: EdgeView,
  ring?: EdgeRing,
): EdgeArrow[] {
  const off = targets.filter((t) => !onScreen(t, v));
  off.sort((a, b) => {
    const pa = EDGE_PRIORITY.indexOf(a.kind);
    const pb = EDGE_PRIORITY.indexOf(b.kind);
    return pa !== pb ? pa - pb : a.distance - b.distance;
  });
  return off.slice(0, MAX_ARROWS).map((t) => {
    let at: { x: number; y: number; angle: number };
    if (ring) {
      const { dx, dy } = edgeDirection(t, v);
      const angle = Math.atan2(dy, dx);
      at = { ...ringAt(angle, v, ring), angle };
    } else at = clampToEdge(t, v);
    return {
      key: t.key,
      kind: t.kind,
      x: at.x,
      y: at.y,
      angle: at.angle,
      distance: t.distance,
      label: arrowLabel(t),
    };
  });
}

// The pillars that just appeared where the viewer cannot see them: each
// earns a chime, panned toward it. A key is heard once while it stands.
export class EdgeChimes {
  private readonly known = new Set<string>();

  // The targets this frame; the ones new and off the screen, with their
  // pan (-1 left to 1 right).
  step(targets: readonly EdgeTarget[], v: EdgeView): { key: string; pan: number }[] {
    const out: { key: string; pan: number }[] = [];
    const now = new Set<string>();
    for (const t of targets) {
      now.add(t.key);
      if (this.known.has(t.key)) continue;
      this.known.add(t.key);
      if (onScreen(t, v)) continue;
      const { dx } = edgeDirection(t, v);
      out.push({ key: t.key, pan: Math.max(-1, Math.min(1, dx)) });
    }
    for (const k of this.known) if (!now.has(k)) this.known.delete(k);
    return out;
  }
}

// A box on the screen the arrows keep off (the minimap, the thumb stick,
// the ability buttons), in the same pixels.
export interface EdgeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function hits(x: number, y: number, half: number, r: EdgeRect): boolean {
  return x + half > r.left && x - half < r.right && y + half > r.top && y - half < r.bottom;
}

// An arrow `half` pixels around its point, slid along the safe area's
// border (around a corner when it must) to the nearest place clear of
// every obstacle; where it was when the whole border is covered. Given the
// way it points, it never slides into the half of the screen behind that
// way: an arrow at the top pointing down would read backwards.
export function clearOf(
  at: { x: number; y: number },
  half: number,
  obstacles: readonly EdgeRect[],
  v: EdgeView,
  dir?: { dx: number; dy: number },
): { x: number; y: number } {
  const cx = v.width / 2;
  const cy = v.height / 2;
  const blocked = (x: number, y: number): boolean =>
    obstacles.some((r) => hits(x, y, half, r)) ||
    (dir !== undefined && (x - cx) * dir.dx + (y - cy) * dir.dy <= 0);
  if (!blocked(at.x, at.y)) return at;
  const r = safeRect(v);
  const w = r.x1 - r.x0;
  const h = r.y1 - r.y0;
  const perimeter = 2 * (w + h);
  // The border as one loop: the top left to right, the right down, the
  // bottom right to left, the left up.
  const pointAt = (s: number): { x: number; y: number } => {
    const u = ((s % perimeter) + perimeter) % perimeter;
    if (u < w) return { x: r.x0 + u, y: r.y0 };
    if (u < w + h) return { x: r.x1, y: r.y0 + (u - w) };
    if (u < 2 * w + h) return { x: r.x1 - (u - w - h), y: r.y1 };
    return { x: r.x0, y: r.y1 - (u - 2 * w - h) };
  };
  const onTop = Math.abs(at.y - r.y0) < 0.5;
  const onRight = Math.abs(at.x - r.x1) < 0.5;
  const onBottom = Math.abs(at.y - r.y1) < 0.5;
  const s0 = onTop
    ? at.x - r.x0
    : onRight
      ? w + (at.y - r.y0)
      : onBottom
        ? w + h + (r.x1 - at.x)
        : 2 * w + h + (r.y1 - at.y);
  for (let d = 4; d <= perimeter / 2; d += 4) {
    for (const s of [s0 + d, s0 - d]) {
      const p = pointAt(s);
      if (!blocked(p.x, p.y)) return p;
    }
  }
  return at;
}

// How far round the ring an arrow may slide off its heading, radians:
// under a right angle, so it stays on the side it points to.
const RING_SLIDE = 1.1;

// An arrow on the ring slid round it to the nearest place clear of every
// obstacle, within RING_SLIDE of its heading; where it was otherwise.
export function clearOnRing(
  at: { x: number; y: number; angle: number },
  half: number,
  obstacles: readonly EdgeRect[],
  v: EdgeView,
  ring: EdgeRing,
): { x: number; y: number } {
  const blocked = (p: { x: number; y: number }): boolean =>
    obstacles.some((r) => hits(p.x, p.y, half, r));
  if (!blocked(at)) return { x: at.x, y: at.y };
  for (let d = 0.05; d <= RING_SLIDE; d += 0.05) {
    for (const a of [at.angle + d, at.angle - d]) {
      const p = ringAt(a, v, ring);
      if (!blocked(p)) return p;
    }
  }
  return { x: at.x, y: at.y };
}
