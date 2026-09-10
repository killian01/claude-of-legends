// The river gate. Round 3 shipped a map where three jungle blobs sat ON the
// diagonal, so the water was a chain of disconnected pockets: from the top
// lane's crossing you could not walk to mid, you had to go back through your
// own jungle. The river is supposed to be the road between the lanes, so
// this pins the two halves of that claim: nothing stands in the band, and
// all three lanes open onto the same connected stretch of it.

import { describe, expect, it } from 'vitest';
import { GAME_MAP } from '../src/sim/content/map';
import { NavGrid } from '../src/sim/navgrid';
import type { Vec2 } from '../src/sim/types';

const map = GAME_MAP;
const grid = new NavGrid(map.size, map.walls, map.borderMargin);
const river = map.river;
const half = river.width / 2;

function segDist(px: number, pz: number, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  const t0 = len2 > 0 ? ((px - a.x) * abx + (pz - a.z) * abz) / len2 : 0;
  const t = t0 < 0 ? 0 : t0 > 1 ? 1 : t0;
  return Math.hypot(px - a.x - abx * t, pz - a.z - abz * t);
}

const riverDist = (x: number, z: number) => segDist(x, z, river.a, river.b);
const inBand = (cx: number, cz: number) =>
  grid.isWalkableCell(cx, cz) && riverDist(cx + 0.5, cz + 0.5) <= half;

// Every cell of the band reachable from the center, walking inside the band.
function bandFromCenter(): Set<number> {
  const n = map.size;
  const start = Math.floor(n / 2);
  const seen = new Set<number>([start * n + start]);
  const queue: [number, number][] = [[start, start]];
  while (queue.length > 0) {
    const [cx, cz] = queue.pop()!;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const nz = cz + dz;
      const k = nx * n + nz;
      if (seen.has(k) || !inBand(nx, nz)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  return seen;
}

// The point where a lane polyline sits deepest in the river, sampled finely
// enough that a lane crossing at an angle cannot slip between samples. The
// deepest point rather than the first one: a sample that only grazes the
// band edge can land in a cell whose center is just outside it.
function laneCrossing(pts: readonly Vec2[]): Vec2 | undefined {
  let best: Vec2 | undefined;
  let bestDist = half;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 4));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const d = riverDist(x, z);
      if (d <= bestDist) {
        bestDist = d;
        best = { x, z };
      }
    }
  }
  return best;
}

describe('the river', () => {
  it('is self-mirrored, so neither team owns a bank', () => {
    expect(river.b.x).toBeCloseTo(map.size - river.a.x, 6);
    expect(river.b.z).toBeCloseTo(map.size - river.a.z, 6);
  });

  it('keeps every jungle blob out of the band', () => {
    const intruders = map.walls.filter(
      (w) => segDist(w.x, w.z, river.a, river.b) < w.r + half - 1e-9,
    );
    expect(intruders).toEqual([]);
  });

  it('is walkable end to end', () => {
    const n = map.size;
    let cells = 0;
    const blocked: string[] = [];
    for (let cz = 0; cz < n; cz++) {
      for (let cx = 0; cx < n; cx++) {
        if (riverDist(cx + 0.5, cz + 0.5) > half) continue;
        cells++;
        if (!grid.isWalkableCell(cx, cz)) blocked.push(`${cx},${cz}`);
      }
    }
    expect(cells).toBeGreaterThan(500);
    expect(blocked).toEqual([]);
  });

  it('is one connected stretch, not a chain of pockets', () => {
    const n = map.size;
    const reachable = bandFromCenter();
    let total = 0;
    for (let cz = 0; cz < n; cz++) {
      for (let cx = 0; cx < n; cx++) if (inBand(cx, cz)) total++;
    }
    expect(reachable.size).toBe(total);
  });

  it('opens onto all three lanes', () => {
    const n = map.size;
    const reachable = bandFromCenter();
    for (const [lane, pts] of Object.entries(map.lanes)) {
      const at = laneCrossing(pts);
      expect(at, `${lane} lane never meets the river`).toBeDefined();
      if (!at) continue;
      const k = Math.floor(at.x) * n + Math.floor(at.z);
      expect(reachable.has(k), `${lane} lane's crossing is cut off from mid`).toBe(true);
    }
  });

  it('holds both Warden pits', () => {
    for (const pit of map.wardenPits) {
      expect(riverDist(pit.x, pit.z)).toBeLessThanOrEqual(half);
      expect(grid.isWalkableAt(pit.x, pit.z)).toBe(true);
    }
  });
});
