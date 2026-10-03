// A spatial index over a map's sight walls: which walls a sight line could
// touch, so a map of thousands of them (the Wanderseed's rocks and trees,
// ADR 0031) does not test every one on every line. Conservative by
// construction: a wall is listed in every grid cell its circle's box,
// slightly padded, overlaps, and a line's query covers every cell its box
// overlaps, the arc's outward bulge included on the sphere; the exact test
// (segmentDist) then decides, so the answer is the brute force's. Built
// once per wall list and kept beside it.

import type { WallShape } from './content/map';
import { segmentDist } from './geo';
import type { Vec2 } from './types';

// Below this many walls the plain loop is as quick.
export const WALL_INDEX_MIN = 64;
const CELL_M = 8;
// Coordinates fold into one integer key: cells within +-OFFSET of the
// origin on each axis.
const OFFSET = 512;
const SPAN = 2 * OFFSET;

interface WallIndex {
  cells: Map<number, number[]>;
  stamp: Int32Array;
  query: number;
}

const INDEXES = new WeakMap<readonly WallShape[], WallIndex>();

function cellOf(v: number): number {
  return Math.floor(v / CELL_M);
}

function key(ix: number, iy: number, iz: number): number {
  return ((ix + OFFSET) * SPAN + (iy + OFFSET)) * SPAN + (iz + OFFSET);
}

function build(walls: readonly WallShape[]): WallIndex {
  const cells = new Map<number, number[]>();
  walls.forEach((w, i) => {
    // The padding covers the gap between the plane distance segmentDist
    // measures on the sphere and the chord to the nearest arc point.
    const r = w.r * 1.02 + 0.05;
    const wy = w.y ?? 0;
    for (let ix = cellOf(w.x - r); ix <= cellOf(w.x + r); ix++) {
      for (let iy = cellOf(wy - r); iy <= cellOf(wy + r); iy++) {
        for (let iz = cellOf(w.z - r); iz <= cellOf(w.z + r); iz++) {
          const k = key(ix, iy, iz);
          const list = cells.get(k);
          if (list) list.push(i);
          else cells.set(k, [i]);
        }
      }
    }
  });
  return { cells, stamp: new Int32Array(walls.length), query: 0 };
}

function indexOf(walls: readonly WallShape[]): WallIndex {
  let idx = INDEXES.get(walls);
  if (!idx) {
    idx = build(walls);
    INDEXES.set(walls, idx);
  }
  return idx;
}

// Whether any wall touches the line from a to b, the same answer as
// testing them all.
export function anyWallOnLine(walls: readonly WallShape[], a: Vec2, b: Vec2): boolean {
  if (walls.length < WALL_INDEX_MIN) {
    for (const w of walls) {
      if (segmentDist(w, a, b).d <= w.r) return true;
    }
    return false;
  }
  const idx = indexOf(walls);
  idx.query = (idx.query + 1) | 0;
  if (idx.query === 0) {
    idx.stamp.fill(0);
    idx.query = 1;
  }
  const ay = a.y ?? 0;
  const by = b.y ?? 0;
  // On the sphere the arc bows outward past the chord's box by its
  // sagitta; a margin of the chord's own length over the radius covers it.
  let pad = 0.05;
  if (a.y !== undefined && b.y !== undefined) {
    const dx = a.x - b.x;
    const dy = ay - by;
    const dz = a.z - b.z;
    const l2 = dx * dx + dy * dy + dz * dz;
    const r2 = a.x * a.x + ay * ay + a.z * a.z;
    pad += r2 > 0 ? l2 / Math.sqrt(r2) : 0;
  }
  const x0 = cellOf(Math.min(a.x, b.x) - pad);
  const x1 = cellOf(Math.max(a.x, b.x) + pad);
  const y0 = cellOf(Math.min(ay, by) - pad);
  const y1 = cellOf(Math.max(ay, by) + pad);
  const z0 = cellOf(Math.min(a.z, b.z) - pad);
  const z1 = cellOf(Math.max(a.z, b.z) + pad);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iy = y0; iy <= y1; iy++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = idx.cells.get(key(ix, iy, iz));
        if (!list) continue;
        for (const i of list) {
          if (idx.stamp[i] === idx.query) continue;
          idx.stamp[i] = idx.query;
          const w = walls[i]!;
          if (segmentDist(w, a, b).d <= w.r) return true;
        }
      }
    }
  }
  return false;
}
