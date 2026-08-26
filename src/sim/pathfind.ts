// A* over the NavGrid (8 directions, no corner cutting), followed by greedy
// line-of-walk smoothing. Deterministic: fixed neighbor order, no randomness.
// A blocked target is redirected to its nearest walkable point first.

import type { NavGrid } from './navgrid';
import type { Vec2 } from './types';

const SQRT2 = Math.SQRT2;
const NODE_CAP = 60000;

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function octile(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return dx > dz ? dx + (SQRT2 - 1) * dz : dz + (SQRT2 - 1) * dx;
}

function snap(grid: NavGrid, p: Vec2): Vec2 | null {
  return grid.isWalkableAt(p.x, p.z) ? p : grid.nearestWalkable(p.x, p.z);
}

export function findPath(grid: NavGrid, from: Vec2, to: Vec2): Vec2[] {
  const start = snap(grid, from);
  const goal = snap(grid, to);
  if (!start || !goal) return [];
  if (grid.lineOfWalk(start, goal)) return [{ x: goal.x, z: goal.z }];

  const n = grid.cells;
  const sc = grid.worldToCell(start.x, start.z);
  const gc = grid.worldToCell(goal.x, goal.z);
  const sIdx = sc.cz * n + sc.cx;
  const gIdx = gc.cz * n + gc.cx;

  const g = new Float64Array(n * n).fill(Number.POSITIVE_INFINITY);
  const came = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);

  // Binary min-heap keyed by f score.
  const hf: number[] = [];
  const hi: number[] = [];
  const push = (idx: number, f: number): void => {
    hf.push(f);
    hi.push(idx);
    let i = hf.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p]! <= hf[i]!) break;
      [hf[p], hf[i]] = [hf[i]!, hf[p]!];
      [hi[p], hi[i]] = [hi[i]!, hi[p]!];
      i = p;
    }
  };
  const pop = (): number => {
    const top = hi[0]!;
    const lf = hf.pop()!;
    const li = hi.pop()!;
    if (hf.length > 0) {
      hf[0] = lf;
      hi[0] = li;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < hf.length && hf[l]! < hf[m]!) m = l;
        if (r < hf.length && hf[r]! < hf[m]!) m = r;
        if (m === i) break;
        [hf[m], hf[i]] = [hf[i]!, hf[m]!];
        [hi[m], hi[i]] = [hi[i]!, hi[m]!];
        i = m;
      }
    }
    return top;
  };

  g[sIdx] = 0;
  push(sIdx, octile(sc.cx, sc.cz, gc.cx, gc.cz));
  let found = false;
  let visited = 0;

  while (hf.length > 0) {
    const cur = pop();
    if (cur === gIdx) {
      found = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++visited > NODE_CAP) break;
    const cx = cur % n;
    const cz = (cur / n) | 0;
    for (const [dx, dz] of DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!grid.isWalkableCell(nx, nz)) continue;
      if (
        dx !== 0 &&
        dz !== 0 &&
        (!grid.isWalkableCell(cx + dx, cz) || !grid.isWalkableCell(cx, cz + dz))
      ) {
        continue;
      }
      const ni = nz * n + nx;
      if (closed[ni]) continue;
      const cost = dx === 0 || dz === 0 ? 1 : SQRT2;
      const ng = g[cur]! + cost;
      if (ng < g[ni]!) {
        g[ni] = ng;
        came[ni] = cur;
        push(ni, ng + octile(nx, nz, gc.cx, gc.cz));
      }
    }
  }

  if (!found) return [];

  const cellsPath: number[] = [];
  for (let c = gIdx; c !== -1; c = came[c]!) cellsPath.push(c);
  cellsPath.reverse();
  const pts: Vec2[] = cellsPath.map((i) => ({ x: (i % n) + 0.5, z: ((i / n) | 0) + 0.5 }));
  pts[pts.length - 1] = { x: goal.x, z: goal.z };
  return smooth(grid, start, pts);
}

// Greedy smoothing: from each anchor, jump to the furthest waypoint still in
// line of walk, dropping the grid staircase in between.
function smooth(grid: NavGrid, from: Vec2, pts: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  let anchor = from;
  let i = 0;
  while (i < pts.length) {
    let j = i;
    for (let k = pts.length - 1; k > i; k--) {
      if (grid.lineOfWalk(anchor, pts[k]!)) {
        j = k;
        break;
      }
    }
    const p = pts[j]!;
    out.push({ x: p.x, z: p.z });
    anchor = p;
    i = j + 1;
  }
  return out;
}
