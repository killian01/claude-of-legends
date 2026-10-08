// The arrows at the screen's edge (src/ui/royale_edges.ts): a target off
// the screen is pointed at from the safe area's border, a target behind
// the camera is pointed at too (and chimes when it appears), at most three
// arrows stand at once and a Seedfall outranks the rest.

import { describe, expect, it } from 'vitest';
import {
  ARROW_GAP_PX,
  arrowBox,
  arrowRect,
  clampToEdge,
  clearOf,
  clearOnRing,
  compactRing,
  distanceLabel,
  EDGE_PRIORITY,
  EdgeChimes,
  type EdgeRect,
  type EdgeTarget,
  type EdgeView,
  edgeArrows,
  edgeDirection,
  LABEL_H,
  LABEL_MARGIN,
  LABEL_TOP,
  labelShift,
  layoutArrows,
  MAX_ARROWS,
  onScreen,
  SEEDFALL_STALE_S,
  seedfallPointed,
} from '../src/ui/royale_edges';

// A phone held sideways: the top bar, the ability bar and the minimap's
// corner kept clear.
const VIEW: EdgeView = { width: 844, height: 390, top: 60, right: 70, bottom: 110, left: 70 };

const target = (over: Partial<EdgeTarget> = {}): EdgeTarget => ({
  key: 'sf1',
  kind: 'seedfall',
  x: 422,
  y: 195,
  behind: false,
  distance: 40,
  ...over,
});

describe('the projection', () => {
  it('leaves a target on the screen alone', () => {
    expect(onScreen(target(), VIEW)).toBe(true);
    expect(edgeArrows([target()], VIEW)).toEqual([]);
  });

  it('points at a target off the screen from the border', () => {
    const [a] = edgeArrows([target({ x: 2000, y: 195 })], VIEW);
    expect(a).toBeDefined();
    expect(a!.x).toBeCloseTo(VIEW.width - VIEW.right);
    expect(a!.y).toBeCloseTo(195);
    expect(a!.angle).toBeCloseTo(0);
    expect(a!.label).toBe('40 m');
  });

  it('counts a target under the ability bar as off the screen', () => {
    expect(onScreen(target({ y: 360 }), VIEW)).toBe(false);
    const [a] = edgeArrows([target({ y: 360 })], VIEW);
    expect(a!.y).toBeCloseTo(VIEW.height - VIEW.bottom);
  });

  it('mirrors a target behind the camera, and points it down the screen', () => {
    // Projected ahead and above the middle, but behind: it is behind and
    // below.
    const behind = target({ x: 500, y: 100, behind: true });
    const d = edgeDirection(behind, VIEW);
    expect(d.dy).toBeGreaterThan(0);
    expect(d.dx).toBeLessThan(0);
    expect(onScreen(behind, VIEW)).toBe(false);
    // Dead behind, projected right at the middle: straight down.
    const dead = edgeDirection(target({ behind: true }), VIEW);
    expect(dead).toEqual({ dx: 0, dy: 1 });
  });
});

describe('the clamp', () => {
  it('keeps every arrow on the safe area, whatever the direction', () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const far = target({ x: 422 + Math.cos(a) * 5000, y: 195 + Math.sin(a) * 5000 });
      const at = clampToEdge(far, VIEW);
      expect(at.x).toBeGreaterThanOrEqual(VIEW.left - 1e-6);
      expect(at.x).toBeLessThanOrEqual(VIEW.width - VIEW.right + 1e-6);
      expect(at.y).toBeGreaterThanOrEqual(VIEW.top - 1e-6);
      expect(at.y).toBeLessThanOrEqual(VIEW.height - VIEW.bottom + 1e-6);
      const onBorder =
        Math.abs(at.x - VIEW.left) < 1e-6 ||
        Math.abs(at.x - (VIEW.width - VIEW.right)) < 1e-6 ||
        Math.abs(at.y - VIEW.top) < 1e-6 ||
        Math.abs(at.y - (VIEW.height - VIEW.bottom)) < 1e-6;
      expect(onBorder, `angle ${a}`).toBe(true);
    }
  });

  it('never inverts the safe area on a tiny screen', () => {
    const tiny: EdgeView = { width: 100, height: 80, top: 60, right: 70, bottom: 60, left: 70 };
    const at = clampToEdge(target({ x: 1000, y: 40 }), tiny);
    expect(Number.isFinite(at.x)).toBe(true);
    expect(at.x).toBeGreaterThanOrEqual(50);
  });
});

describe('the arrows', () => {
  it(`stand at most ${MAX_ARROWS} at once`, () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      target({ key: `t${i}`, x: -1000, y: 100 + i, distance: 30 + i }),
    );
    expect(edgeArrows(many, VIEW)).toHaveLength(MAX_ARROWS);
  });

  it('rank a Seedfall over a Rising over the Wrath over the Lodestar over Ablaze', () => {
    expect(EDGE_PRIORITY).toEqual(['seedfall', 'burr', 'rising', 'wrath', 'lodestar', 'ablaze']);
    const off = { x: -500, y: 200 };
    const arrows = edgeArrows(
      [
        target({ ...off, key: 'ab', kind: 'ablaze', distance: 5 }),
        target({ ...off, key: 'lo', kind: 'lodestar', distance: 6 }),
        target({ ...off, key: 'wr', kind: 'wrath', distance: 7 }),
        target({ ...off, key: 'ri', kind: 'rising', distance: 80 }),
        target({ ...off, key: 'sf', kind: 'seedfall', distance: 90 }),
      ],
      VIEW,
    );
    expect(arrows.map((a) => a.key)).toEqual(['sf', 'ri', 'wr']);
  });

  it("rank the own Burr's carrier after a Seedfall and before a Rising, its seconds left read", () => {
    const off = { x: -500, y: 200 };
    const arrows = edgeArrows(
      [
        target({ ...off, key: 'ri', kind: 'rising', distance: 10 }),
        target({ ...off, key: 'burr', kind: 'burr', distance: 42, secondsLeft: 37.2 }),
        target({ ...off, key: 'sf', kind: 'seedfall', distance: 90 }),
      ],
      VIEW,
    );
    expect(arrows.map((a) => a.key)).toEqual(['sf', 'burr', 'ri']);
    expect(arrows[1]!.label).toBe('42 m \u00b7 0:38');
  });

  it('take the nearest first within a kind', () => {
    const arrows = edgeArrows(
      [
        target({ key: 'far', x: -500, distance: 90 }),
        target({ key: 'near', x: -500, distance: 20 }),
      ],
      VIEW,
    );
    expect(arrows.map((a) => a.key)).toEqual(['near', 'far']);
  });

  it('read their distance the way a glance does', () => {
    expect(distanceLabel(0.2)).toBe('1 m');
    expect(distanceLabel(42.6)).toBe('43 m');
    expect(distanceLabel(1530)).toBe('1.5 km');
  });
});

describe('the chime', () => {
  it('rings once for a pillar that appears behind the camera, panned toward it', () => {
    const chimes = new EdgeChimes();
    const behindLeft = target({ key: 'sf2', x: 600, y: 120, behind: true });
    const first = chimes.step([behindLeft], VIEW);
    expect(first).toHaveLength(1);
    expect(first[0]!.pan).toBeLessThan(0);
    // And it gets an arrow.
    expect(edgeArrows([behindLeft], VIEW).map((a) => a.key)).toEqual(['sf2']);
    // Heard once while it stands.
    expect(chimes.step([behindLeft], VIEW)).toEqual([]);
  });

  it('stays quiet for a pillar that appears in view', () => {
    const chimes = new EdgeChimes();
    expect(chimes.step([target()], VIEW)).toEqual([]);
  });

  it('rings again for a pillar that went and came back', () => {
    const chimes = new EdgeChimes();
    const t = target({ x: 2000 });
    expect(chimes.step([t], VIEW)).toHaveLength(1);
    chimes.step([], VIEW);
    expect(chimes.step([t], VIEW)).toHaveLength(1);
  });
});

describe('the obstacles', () => {
  it('slide an arrow along its border clear of the minimap', () => {
    // The phone's minimap, top right under the bar.
    const minimap = { left: 720, top: 58, right: 832, bottom: 170 };
    const at = clampToEdge(target({ x: 3000, y: 120 }), VIEW);
    expect(at.x).toBeCloseTo(VIEW.width - VIEW.right);
    const moved = clearOf(at, 14, [minimap], VIEW);
    expect(moved.x).toBeCloseTo(at.x);
    expect(moved.y - 14).toBeGreaterThanOrEqual(minimap.bottom);
    expect(moved.y).toBeLessThanOrEqual(VIEW.height - VIEW.bottom);
  });

  it('leave an arrow that is already clear where it stands', () => {
    const at = { x: VIEW.left, y: 200 };
    expect(clearOf(at, 14, [{ left: 700, top: 0, right: 844, bottom: 100 }], VIEW)).toEqual(at);
  });

  it('go around a corner when their whole border is covered', () => {
    const bottom = { left: 0, top: 270, right: 844, bottom: 390 };
    const at = { x: 422, y: VIEW.height - VIEW.bottom };
    const moved = clearOf(at, 14, [bottom], VIEW);
    expect(moved.y + 14).toBeLessThanOrEqual(bottom.top);
    expect(moved.x === VIEW.left || moved.x === VIEW.width - VIEW.right).toBe(true);
  });

  it('slide along the top or bottom border sideways', () => {
    const bar = { left: 300, top: 250, right: 560, bottom: 390 };
    const at = { x: 422, y: VIEW.height - VIEW.bottom };
    const moved = clearOf(at, 14, [bar], VIEW);
    expect(moved.y).toBe(at.y);
    expect(moved.x + 14 <= bar.left || moved.x - 14 >= bar.right).toBe(true);
  });
});

describe("the planet's horizon", () => {
  it('points at a target the planet hides, though it projects inside the safe area', () => {
    // Over the horizon dead ahead: its foot projects onto the globe's disc
    // low on the screen, but the ground bearing says ahead.
    const over = target({ x: 422, y: 300, hidden: true, bearing: 0 });
    expect(onScreen(over, VIEW)).toBe(false);
    const [a] = edgeArrows([over], VIEW);
    expect(a).toBeDefined();
    expect(a!.y).toBeCloseTo(VIEW.top);
    expect(a!.x).toBeCloseTo(422);
    expect(a!.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('turns a hidden target by its ground bearing, not by where it projects', () => {
    const right = edgeDirection(
      target({ x: 100, y: 195, hidden: true, bearing: Math.PI / 2 }),
      VIEW,
    );
    expect(right.dx).toBeCloseTo(1);
    expect(right.dy).toBeCloseTo(0);
    const back = edgeDirection(target({ x: 422, y: 60, hidden: true, bearing: Math.PI }), VIEW);
    expect(back.dy).toBeCloseTo(1);
  });

  it('chimes for a pillar that appears hidden by the planet, panned toward it', () => {
    const chimes = new EdgeChimes();
    const heard = chimes.step(
      [target({ key: 'sf9', x: 422, y: 250, hidden: true, bearing: -Math.PI / 2 })],
      VIEW,
    );
    expect(heard).toHaveLength(1);
    expect(heard[0]!.pan).toBeCloseTo(-1);
  });
});

describe('the countdown under an arrow', () => {
  it('reads the seconds left of a Seedfall still falling', () => {
    const [a] = edgeArrows([target({ x: -900, distance: 84, secondsLeft: 11.2 })], VIEW);
    expect(a!.label).toBe('84 m \u00b7 0:12');
    const [b] = edgeArrows([target({ x: -900, distance: 84 })], VIEW);
    expect(b!.label).toBe('84 m');
  });
});

describe('the Seedfalls pointed at', () => {
  it('drop one landed and left unopened past an interval, so it frees its slot', () => {
    expect(seedfallPointed(140, false, 130)).toBe(true);
    expect(seedfallPointed(140, true, 140 + SEEDFALL_STALE_S - 1)).toBe(true);
    expect(seedfallPointed(140, true, 140 + SEEDFALL_STALE_S + 1)).toBe(false);
  });
});

describe('the ring on a phone', () => {
  const ring = compactRing(VIEW);
  const cx = VIEW.width / 2;
  const cy = VIEW.height / 2;

  it('stands every arrow round the champion, on the side it points to', () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const far = target({ key: `a${a}`, x: cx + Math.cos(a) * 5000, y: cy + Math.sin(a) * 5000 });
      const [arrow] = edgeArrows([far], VIEW, ring);
      expect(arrow, `angle ${a}`).toBeDefined();
      const ox = arrow!.x - cx;
      const oy = arrow!.y - cy;
      expect(ox * Math.cos(a) + oy * Math.sin(a), `angle ${a}`).toBeGreaterThan(0);
      expect((ox / ring.rx) ** 2 + (oy / ring.ry) ** 2).toBeCloseTo(1);
      expect(arrow!.angle).toBeCloseTo(Math.atan2(Math.sin(a), Math.cos(a)));
    }
  });

  it('keeps the ring inside the safe area', () => {
    expect(ring.rx).toBeLessThan(cx - VIEW.left);
    expect(ring.ry).toBeLessThan(cy - VIEW.top);
    expect(ring.ry).toBeLessThan(VIEW.height - VIEW.bottom - cy + 1e-9);
  });

  it('slides an arrow along the ring clear of an obstacle, never to the other half', () => {
    // The thumb stick's corner, bottom left.
    const stick = { left: 0, top: 200, right: 330, bottom: 390 };
    const a = (3 * Math.PI) / 4;
    const at = { x: cx + ring.rx * Math.cos(a), y: cy + ring.ry * Math.sin(a), angle: a };
    const moved = clearOnRing(at, 14, [stick], VIEW, ring);
    const blocked =
      moved.x + 14 > stick.left &&
      moved.x - 14 < stick.right &&
      moved.y + 14 > stick.top &&
      moved.y - 14 < stick.bottom;
    expect(blocked).toBe(false);
    expect((moved.x - cx) * Math.cos(a) + (moved.y - cy) * Math.sin(a)).toBeGreaterThan(0);
  });
});

describe('the distance line under an arrow', () => {
  it('stays whole at the screen sides ("138 m, 0:0" and "6 m, 0:11")', () => {
    // A line 84 px wide under a dial at the left border of a 960 screen.
    expect(labelShift(26, 84, 960)).toBeCloseTo(LABEL_MARGIN + 42 - 26);
    expect(labelShift(934, 84, 960)).toBeCloseTo(960 - LABEL_MARGIN - 42 - 934);
    expect(labelShift(480, 84, 960)).toBe(0);
    for (const x of [0, 10, 26, 300, 700, 934, 960]) {
      const left = x + labelShift(x, 84, 960) - 42;
      expect(left).toBeGreaterThanOrEqual(LABEL_MARGIN - 1e-9);
      expect(left + 84).toBeLessThanOrEqual(960 - LABEL_MARGIN + 1e-9);
    }
  });

  it('counts in the room an arrow keeps clear', () => {
    const box = arrowBox(84);
    expect(box.left).toBe(42);
    expect(box.right).toBe(42);
    expect(box.bottom).toBeGreaterThanOrEqual(30);
    expect(arrowBox(0).left).toBeGreaterThanOrEqual(13);
  });
});

describe('the arrows placed together', () => {
  const hit = (a: EdgeRect, b: EdgeRect): boolean =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  it('never draw two arrows on each other on a phone ("5? m")', () => {
    // The phone's view as the HUD gives it, the thumb stick's corner and
    // the bar covered: two Seedfalls to the left, one ahead and one behind.
    const view: EdgeView = { width: 844, height: 390, top: 14, right: 26, bottom: 38, left: 26 };
    const ring = compactRing(view);
    const stick = { left: 20, top: 200, right: 240, bottom: 390 };
    const bar = { left: 240, top: 300, right: 460, bottom: 390 };
    const touchbar = { left: 0, top: 90, right: 80, bottom: 200 };
    const targets = [
      target({ key: 'sf1', x: -340, y: 136, distance: 59 }),
      target({ key: 'sf2', x: 523, y: 78, behind: true, distance: 70 }),
    ];
    const arrows = edgeArrows(targets, view, ring);
    expect(arrows).toHaveLength(2);
    const widths = [40, 84];
    const at = layoutArrows(arrows, widths, [stick, bar, touchbar], view, ring);
    const rects = at.map((p, i) => arrowRect(p, arrowBox(widths[i] ?? 0), p.labelDx));
    expect(hit(rects[0]!, rects[1]!)).toBe(false);
  });

  it('keep every arrow off the others however many point the same way', () => {
    const view: EdgeView = { width: 960, height: 540, top: 14, right: 26, bottom: 38, left: 26 };
    for (const ring of [undefined, compactRing(view)]) {
      const targets = [0, 1, 2].map((i) =>
        target({ key: `sf${i}`, x: -2000, y: 270 + i, distance: 50 + i }),
      );
      const arrows = edgeArrows(targets, view, ring);
      const widths = arrows.map(() => 84);
      const at = layoutArrows(arrows, widths, [], view, ring);
      const rects = at.map((p) => arrowRect(p, arrowBox(84), p.labelDx));
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          expect(hit(rects[i]!, rects[j]!), `${ring ? 'ring' : 'border'} ${i} ${j}`).toBe(false);
        }
      }
    }
  });

  it('slide off the points box at the top right (the arrow drew over "17 points")', () => {
    const view: EdgeView = { width: 960, height: 540, top: 14, right: 26, bottom: 38, left: 26 };
    const points = { left: 784, top: 8, right: 856, bottom: 56 };
    const kda = { left: 856, top: 8, right: 950, bottom: 44 };
    const [a] = edgeArrows([target({ x: 840, y: -400, distance: 84, secondsLeft: 19 })], view);
    const [p] = layoutArrows([a!], [84], [points, kda], view);
    const r = arrowRect(p!, arrowBox(84), p!.labelDx);
    expect(hit(r, points)).toBe(false);
    expect(hit(r, kda)).toBe(false);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(960);
  });

  it('keep a clear arrow where it points', () => {
    const view: EdgeView = { width: 960, height: 540, top: 14, right: 26, bottom: 38, left: 26 };
    const [a] = edgeArrows([target({ x: -500, y: 270 })], view);
    const [p] = layoutArrows([a!], [40], [], view);
    expect(p!.x).toBeCloseTo(a!.x);
    expect(p!.y).toBeCloseTo(a!.y);
  });
});

describe('the border slide on a phone', () => {
  it('never carries an arrow to the half of the screen it does not point to', () => {
    // The bottom, the left and the right all covered (the thumbs, the
    // feed, the minimap): an arrow pointing down stays down, overlapping,
    // rather than standing at the top pointing down.
    const covered = [
      { left: 0, top: 120, right: 844, bottom: 390 },
      { left: 0, top: 0, right: 120, bottom: 390 },
      { left: 724, top: 0, right: 844, bottom: 390 },
    ];
    const at = { x: 422, y: VIEW.height - VIEW.bottom };
    const moved = clearOf(at, 14, covered, VIEW, { dx: 0, dy: 1 });
    expect(moved.y).toBeGreaterThan(VIEW.height / 2);
  });
});

describe('the distance lines of arrows side by side', () => {
  // The line under a placed arrow, as the HUD draws it.
  const line = (p: { x: number; y: number; labelDx: number }, w: number): EdgeRect => ({
    left: p.x + p.labelDx - w / 2,
    top: p.y + LABEL_TOP,
    right: p.x + p.labelDx + w / 2,
    bottom: p.y + LABEL_TOP + LABEL_H,
  });
  // Apart by the gap on one axis at least.
  const apart = (a: EdgeRect, b: EdgeRect): boolean =>
    a.right + ARROW_GAP_PX <= b.left + 1e-9 ||
    b.right + ARROW_GAP_PX <= a.left + 1e-9 ||
    a.bottom + ARROW_GAP_PX <= b.top + 1e-9 ||
    b.bottom + ARROW_GAP_PX <= a.top + 1e-9;

  it('never touch on the same edge ("201 m \u00b7 0:1679 m \u00b7 0:16")', () => {
    // The playtest at 960x540: two Seedfalls up and to the left, their
    // arrows on the top border next to each other.
    const view: EdgeView = { width: 960, height: 540, top: 14, right: 26, bottom: 38, left: 26 };
    const targets = [
      target({ key: 'sf1', x: 150, y: -900, distance: 201, secondsLeft: 16 }),
      target({ key: 'sf2', x: 235, y: -900, distance: 79, secondsLeft: 16 }),
    ];
    const arrows = edgeArrows(targets, view);
    expect(arrows.map((a) => a.label)).toEqual(['79 m \u00b7 0:16', '201 m \u00b7 0:16']);
    const widths = [74, 82];
    const at = layoutArrows(arrows, widths, [], view);
    expect(at.every((p) => p.labelShown)).toBe(true);
    expect(apart(line(at[0]!, 74), line(at[1]!, 82))).toBe(true);
  });

  it('never touch, on the border or the ring, wherever two or three point', () => {
    const views: EdgeView[] = [
      { width: 960, height: 540, top: 14, right: 26, bottom: 38, left: 26 },
      { width: 1280, height: 720, top: 14, right: 26, bottom: 38, left: 26 },
      { width: 844, height: 390, top: 14, right: 26, bottom: 38, left: 26 },
    ];
    const widths = [84, 60, 92];
    for (const view of views) {
      const bar = {
        left: view.width / 2 - 150,
        top: view.height - 170,
        right: view.width / 2 + 150,
        bottom: view.height,
      };
      for (const ring of [undefined, compactRing(view)]) {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * 2 * Math.PI;
          for (const n of [2, 3]) {
            const targets = Array.from({ length: n }, (_, i) =>
              target({
                key: `sf${i}`,
                x: view.width / 2 + 3000 * Math.cos(a + i * 0.04),
                y: view.height / 2 + 3000 * Math.sin(a + i * 0.04),
                distance: 40 + i,
                secondsLeft: 12,
              }),
            );
            const arrows = edgeArrows(targets, view, ring);
            const at = layoutArrows(arrows, widths, [bar], view, ring);
            for (let i = 0; i < at.length; i++) {
              for (let j = i + 1; j < at.length; j++) {
                if (!at[i]!.labelShown || !at[j]!.labelShown) continue;
                const where = `${view.width} ${ring ? 'ring' : 'border'} ${k} ${n}: ${i} ${j}`;
                expect(apart(line(at[i]!, widths[i]!), line(at[j]!, widths[j]!)), where).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  it('drop a line rather than let it touch another when nowhere is clear', () => {
    // A screen too small for three lines side by side: the last stands
    // where it points and goes without its line.
    const view: EdgeView = { width: 150, height: 100, top: 14, right: 26, bottom: 38, left: 26 };
    const arrows = edgeArrows(
      [0, 1, 2].map((i) => target({ key: `sf${i}`, x: 75 + i, y: -900, distance: 40 + i })),
      view,
    );
    const at = layoutArrows(arrows, [84, 84, 84], [], view);
    expect(at.some((p) => !p.labelShown)).toBe(true);
    for (let i = 0; i < at.length; i++) {
      for (let j = i + 1; j < at.length; j++) {
        if (!at[i]!.labelShown || !at[j]!.labelShown) continue;
        expect(apart(line(at[i]!, 84), line(at[j]!, 84))).toBe(true);
      }
    }
  });
});
