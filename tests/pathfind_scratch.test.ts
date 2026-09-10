// The pathfinder's scratch state (src/sim/pathfind.ts): the arrays a search
// works in are shared between searches and marked by generation instead of
// allocated and filled per search, which was most of a search's cost once
// the Star Orchard's grid was ten times the launch map's. The pin: the
// previous implementation, verbatim below, and the shipped one agree on
// every path, on both grids, from many seeded start and goal pairs, with
// searches interleaved so a stale mark would be caught.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAME_MAP } from '../src/sim/content/map';
import {
  type StarOrchardLayout,
  type StarOrchardManifest,
  starOrchardMap,
} from '../src/sim/content/star_orchard';
import type { NavGrid } from '../src/sim/navgrid';
import { NavGrid as LaunchGrid } from '../src/sim/navgrid';
import { findPath } from '../src/sim/pathfind';
import { Rng } from '../src/sim/rng';
import { decodeTerrainNav, TerrainNavGrid } from '../src/sim/terrain_nav';
import type { Vec2 } from '../src/sim/types';

// The Star Orchard's grid, read from the shipped export.
const folder = new URL('../public/map/star-orchard/', import.meta.url);
const manifest: StarOrchardManifest = JSON.parse(
  readFileSync(new URL('manifest.json', folder), 'utf8'),
);
const layout: StarOrchardLayout = JSON.parse(
  readFileSync(new URL('gameplay.json', folder), 'utf8'),
);
const binary = readFileSync(new URL('navigation.bin', folder));
const orchardNav = decodeTerrainNav(
  manifest,
  binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength) as ArrayBuffer,
);
const orchardSize = starOrchardMap(layout, manifest).size;

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

function referencePath(grid: NavGrid, from: Vec2, to: Vec2): Vec2[] {
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
  const pts: Vec2[] = cellsPath.map((index) => grid.cellToWorld(index % n, (index / n) | 0));
  pts[pts.length - 1] = { x: goal.x, z: goal.z };
  return referenceSmooth(grid, start, pts);
}

// Greedy smoothing: from each anchor, jump to the furthest waypoint still in
// line of walk, dropping the grid staircase in between.
function referenceSmooth(grid: NavGrid, from: Vec2, pts: readonly Vec2[]): Vec2[] {
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

function pairs(rng: Rng, size: number, count: number): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  for (let i = 0; i < count; i++) {
    out.push([
      { x: rng.next() * size, z: rng.next() * size },
      { x: rng.next() * size, z: rng.next() * size },
    ]);
  }
  return out;
}

describe('the pathfinder with shared scratch state', () => {
  const launch = new LaunchGrid(GAME_MAP.size, GAME_MAP.walls, GAME_MAP.borderMargin);
  const orchardGrid = new TerrainNavGrid(orchardNav);
  const grids: [string, NavGrid, number][] = [
    ['launch map', launch, GAME_MAP.size],
    ['Star Orchard', orchardGrid, orchardSize],
  ];

  it('finds the same path as the previous implementation, on both grids, interleaved', () => {
    const rng = new Rng(2021);
    const cases = grids.flatMap(([name, grid, size]) =>
      pairs(rng, size, 40).map(([from, to]) => ({ name, grid, from, to })),
    );
    // Interleave the grids so the scratch is resized and reused in turn.
    cases.sort((a, b) => a.from.x - b.from.x);
    let searched = 0;
    for (const c of cases) {
      const got = findPath(c.grid, c.from, c.to);
      const want = referencePath(c.grid, c.from, c.to);
      expect(got, `${c.name} ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`).toEqual(want);
      if (got.length > 1) searched++;
    }
    // The pin means nothing if every pair was a straight line.
    expect(searched).toBeGreaterThan(20);
  });

  it('gives the same answer twice in a row, and after a search on the other grid', () => {
    const from = { x: 9.4, z: 41.1 };
    const to = { x: 140.2, z: 112.5 };
    const first = findPath(orchardGrid, from, to);
    findPath(launch, { x: 7, z: 7 }, { x: 143, z: 143 });
    expect(findPath(orchardGrid, from, to)).toEqual(first);
    expect(first.length).toBeGreaterThan(1);
  });
});
