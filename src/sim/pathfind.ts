// A* over the NavGrid (8 directions, no corner cutting), followed by greedy
// line-of-walk smoothing. Deterministic: fixed neighbor order, no randomness.
// A blocked target is redirected to its nearest walkable point first.
// tests/pathfind_scratch.test.ts pins that the shared scratch state below
// changes nothing about the paths.

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

// Scratch state shared by every search on a grid of one size. The arrays
// are the grid's size (a quarter million cells on the Star Orchard), and
// allocating and filling three of them per search was most of a search's
// cost once the map grew ten times. A generation number marks the cells a
// search touched, so nothing is cleared between searches; the heap is two
// typed arrays swapped by hand rather than by destructuring. Same
// expansions in the same order, same path to the last cell.
let scratchCells = -1;
let generation = 0;
let seen = new Uint32Array(0);
let gScore = new Float64Array(0);
let came = new Int32Array(0);
let closedAt = new Uint32Array(0);
let heapF = new Float64Array(0);
let heapI = new Int32Array(0);

function scratchFor(cells: number): void {
  // Also on generation wrap: a stale mark from four billion searches ago
  // must not read as this search's.
  if (scratchCells === cells && generation < 0xfffffffe) return;
  scratchCells = cells;
  generation = 0;
  seen = new Uint32Array(cells);
  gScore = new Float64Array(cells);
  came = new Int32Array(cells);
  closedAt = new Uint32Array(cells);
  heapF = new Float64Array(Math.max(1024, cells));
  heapI = new Int32Array(Math.max(1024, cells));
}

function growHeap(): void {
  const f = new Float64Array(heapF.length * 2);
  const i = new Int32Array(heapI.length * 2);
  f.set(heapF);
  i.set(heapI);
  heapF = f;
  heapI = i;
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

  scratchFor(n * n);
  const gen = ++generation;
  let size = 0;

  // Binary min-heap keyed by f score.
  const push = (idx: number, f: number): void => {
    if (size === heapF.length) growHeap();
    heapF[size] = f;
    heapI[size] = idx;
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pf = heapF[p]!;
      if (pf <= f) break;
      heapF[i] = pf;
      heapI[i] = heapI[p]!;
      heapF[p] = f;
      heapI[p] = idx;
      i = p;
    }
  };
  const pop = (): number => {
    const top = heapI[0]!;
    size--;
    if (size > 0) {
      const lf = heapF[size]!;
      const li = heapI[size]!;
      heapF[0] = lf;
      heapI[0] = li;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mf = lf;
        if (l < size && heapF[l]! < mf) {
          m = l;
          mf = heapF[l]!;
        }
        if (r < size && heapF[r]! < mf) {
          m = r;
          mf = heapF[r]!;
        }
        if (m === i) break;
        heapF[i] = mf;
        heapI[i] = heapI[m]!;
        heapF[m] = lf;
        heapI[m] = li;
        i = m;
      }
    }
    return top;
  };

  seen[sIdx] = gen;
  gScore[sIdx] = 0;
  came[sIdx] = -1;
  push(sIdx, octile(sc.cx, sc.cz, gc.cx, gc.cz));
  let found = false;
  let visited = 0;

  while (size > 0) {
    const cur = pop();
    if (cur === gIdx) {
      found = true;
      break;
    }
    if (closedAt[cur] === gen) continue;
    closedAt[cur] = gen;
    if (++visited > NODE_CAP) break;
    const cx = cur % n;
    const cz = (cur / n) | 0;
    const gCur = gScore[cur]!;
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
      if (closedAt[ni] === gen) continue;
      const cost = dx === 0 || dz === 0 ? 1 : SQRT2;
      const ng = gCur + cost;
      if (seen[ni] !== gen || ng < gScore[ni]!) {
        seen[ni] = gen;
        gScore[ni] = ng;
        came[ni] = cur;
        push(ni, ng + octile(nx, nz, gc.cx, gc.cz));
      }
    }
  }

  if (!found) return [];

  const cellsPath: number[] = [];
  for (let c = gIdx; c !== -1; c = came[c]!) cellsPath.push(c);
  cellsPath.reverse();
  const pts: Vec2[] = cellsPath.map((index) => grid.cellToWorld(index % n, (index / n) | 0));
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
