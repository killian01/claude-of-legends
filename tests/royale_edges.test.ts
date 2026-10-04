// The arrows at the screen's edge (src/ui/royale_edges.ts): a target off
// the screen is pointed at from the safe area's border, a target behind
// the camera is pointed at too (and chimes when it appears), at most three
// arrows stand at once and a Seedfall outranks the rest.

import { describe, expect, it } from 'vitest';
import {
  clampToEdge,
  clearOf,
  distanceLabel,
  EDGE_PRIORITY,
  EdgeChimes,
  type EdgeTarget,
  type EdgeView,
  edgeArrows,
  edgeDirection,
  MAX_ARROWS,
  onScreen,
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
    expect(EDGE_PRIORITY).toEqual(['seedfall', 'rising', 'wrath', 'lodestar', 'ablaze']);
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
