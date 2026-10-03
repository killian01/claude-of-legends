// The planet's walkability grid (src/sim/sphere_nav.ts): the cube-sphere
// conventions it shares with scripts/planet/generate.mjs, the neighbors
// across face edges and cube corners, the exact great-circle traversal, the
// path search across faces and around the poles, and the search budget on
// the shipped planet.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assemblePlanet } from '../src/sim/content/planet';
import { Rng } from '../src/sim/rng';
import {
  arcLowerBound,
  decodeSphereNav,
  faceOf,
  findSpherePath,
  SphereNavGrid,
  type SpherePoint,
} from '../src/sim/sphere_nav';

const R = 80;

function openGrid(n: number, radius = R): SphereNavGrid {
  return new SphereNavGrid({
    radius,
    cellsPerFace: n,
    heightScale: 0.001,
    blockedValue: -32768,
    heights: new Int16Array(6 * n * n),
  });
}

const len = (p: SpherePoint) => Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
const dist = (a: SpherePoint, b: SpherePoint) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
const onSphere = (x: number, y: number, z: number, radius = R): SpherePoint => {
  const l = Math.sqrt(x * x + y * y + z * z);
  return { x: (x / l) * radius, y: (y / l) * radius, z: (z / l) * radius };
};
// The point `meters` along the great circle from a toward b.
function toward(a: SpherePoint, b: SpherePoint, meters: number): SpherePoint {
  const ua = { x: a.x / R, y: a.y / R, z: a.z / R };
  const d = (b.x * ua.x + b.y * ua.y + b.z * ua.z) / R;
  const t = { x: b.x / R - ua.x * d, y: b.y / R - ua.y * d, z: b.z / R - ua.z * d };
  const tl = len(t);
  const ang = meters / R;
  return {
    x: R * (ua.x * Math.cos(ang) + (t.x / tl) * Math.sin(ang)),
    y: R * (ua.y * Math.cos(ang) + (t.y / tl) * Math.sin(ang)),
    z: R * (ua.z * Math.cos(ang) + (t.z / tl) * Math.sin(ang)),
  };
}
function randomPoint(rng: Rng): SpherePoint {
  const z = rng.range(-1, 1);
  const phi = rng.range(0, Math.PI * 2);
  const s = Math.sqrt(1 - z * z);
  return { x: R * s * Math.cos(phi), y: R * z, z: R * s * Math.sin(phi) };
}
function pathLength(from: SpherePoint, path: SpherePoint[]): number {
  let total = 0;
  let prev = from;
  for (const p of path) {
    total += dist(prev, p);
    prev = p;
  }
  return total;
}
function expectWalkablePath(grid: SphereNavGrid, from: SpherePoint, path: SpherePoint[]): void {
  let prev = grid.nearestWalkable(from)!;
  for (const p of path) {
    expect(Math.abs(len(p) - grid.radius)).toBeLessThan(1e-9);
    expect(grid.isWalkableAt(p)).toBe(true);
    expect(grid.lineOfWalk(prev, p)).toBe(true);
    prev = p;
  }
}

describe('cube-sphere cells', () => {
  it('looks every cell center up as its own cell, on the sphere', () => {
    for (const n of [8, 31, 320]) {
      const grid = openGrid(n);
      let wrong = 0;
      let off = 0;
      for (let c = 0; c < grid.cellCount; c++) {
        const p = grid.cellCenter(c);
        if (grid.cellOf(p) !== c) wrong += 1;
        if (Math.abs(len(p) - R) > 1e-9) off += 1;
      }
      expect(wrong).toBe(0);
      expect(off).toBe(0);
    }
  });

  it('indexes cells as f n^2 + j n + i with i along U and j along V', () => {
    const n = 320;
    const grid = openGrid(n);
    // Face 2 (+Y): U = +x, V = -z. Its cell (i, j) = (n - 1, 0) is toward
    // +x and +z.
    const c = grid.cellOf(onSphere(0.999, 1, 0.999));
    expect(c).toBe(2 * n * n + 0 * n + (n - 1));
    // Face 5 (-Z): U = -x, V = +y; i = 0 is toward +x.
    expect(grid.cellOf(onSphere(0.999, 0.999, -1))).toBe(5 * n * n + (n - 1) * n + 0);
    // Face 0 (+X): U = -z, V = +y.
    expect(grid.cellOf(onSphere(1, -0.999, 0.999))).toBe(0);
  });

  it('puts points near edges and corners on the face of their largest axis', () => {
    const grid = openGrid(320);
    const n = grid.n;
    const eps = 1e-9;
    expect(grid.cellOf(onSphere(1, 1 - eps, 0))).toBeLessThan(n * n);
    expect(Math.floor(grid.cellOf(onSphere(1 - eps, 1, 0)) / (n * n))).toBe(2);
    // Exact ties go to x, then y, then z, each with its sign.
    expect(faceOf(1, 1, 0)).toBe(0);
    expect(faceOf(0, 1, 1)).toBe(2);
    expect(faceOf(-1, 1, 1)).toBe(1);
    expect(faceOf(1, -1, -1)).toBe(0);
    expect(faceOf(0, 0, -1)).toBe(5);
    for (const [x, y, z] of [
      [1, 1, 1],
      [-1, -1, -1],
      [1, -1, 1],
      [-1, 1, -1],
    ] as const) {
      const c = grid.cellOf(onSphere(x, y, z));
      expect(dist(grid.cellCenter(c), onSphere(x, y, z))).toBeLessThan(0.3);
    }
  });

  it('gives every cell 8 neighbors (7 at a cube corner), symmetric and adjacent', () => {
    for (const n of [6, 32]) {
      const grid = openGrid(n);
      const out = new Int32Array(8);
      const back = new Int32Array(8);
      let corners = 0;
      const edgeCell = (Math.PI * R) / 2 / n;
      for (let c = 0; c < grid.cellCount; c++) {
        const k = grid.neighbors(c, out);
        if (k === 7) corners += 1;
        else expect(k).toBe(8);
        const pc = grid.cellCenter(c);
        for (let q = 0; q < k; q++) {
          const nb = out[q]!;
          expect(nb).not.toBe(c);
          const m = grid.neighbors(nb, back);
          expect(Array.from(back.subarray(0, m))).toContain(c);
          const d = dist(pc, grid.cellCenter(nb));
          expect(d).toBeGreaterThan(0.2 * edgeCell);
          expect(d).toBeLessThan(2.2 * edgeCell);
        }
      }
      expect(corners).toBe(24);
    }
  });

  it('keeps the rim neighbors of the full-size grid symmetric', () => {
    const grid = openGrid(320);
    const n = grid.n;
    const out = new Int32Array(8);
    const back = new Int32Array(8);
    for (let f = 0; f < 6; f++) {
      for (let j = 0; j < n; j++) {
        for (const i of j === 0 || j === n - 1 ? [...Array(n).keys()] : [0, n - 1]) {
          const c = f * n * n + j * n + i;
          const k = grid.neighbors(c, out);
          for (let q = 0; q < k; q++) {
            const m = grid.neighbors(out[q]!, back);
            expect(Array.from(back.subarray(0, m))).toContain(c);
          }
        }
      }
    }
  });
});

describe('the great-circle traversal', () => {
  it('never skips a cell the arc passes through, across faces', () => {
    const grid = openGrid(64);
    const rng = new Rng(7);
    for (let trial = 0; trial < 60; trial++) {
      const a = randomPoint(rng);
      const b = toward(a, randomPoint(rng), rng.range(1, 160));
      const cells = grid.cellsAlong(a, b);
      const set = new Set(cells);
      expect(cells[0]).toBe(grid.cellOf(a));
      expect(cells[cells.length - 1]).toBe(grid.cellOf(b));
      // Each step moves to a neighbor.
      const out = new Int32Array(8);
      for (let k = 1; k < cells.length; k++) {
        const m = grid.neighbors(cells[k - 1]!, out);
        expect(Array.from(out.subarray(0, m))).toContain(cells[k]);
      }
      // Dense sampling along the arc finds no cell the walk missed.
      const steps = 4000;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p = onSphere(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
        if (dist(a, b) > 1e-6) expect(set.has(grid.cellOf(p))).toBe(true);
      }
    }
  });

  it('stops a line of walk at a blocked cell, wherever it sits on the arc', () => {
    const grid = openGrid(320);
    const a = onSphere(1, 0.05, 0.3);
    const b = onSphere(0.3, 0.05, 1);
    expect(grid.lineOfWalk(a, b)).toBe(true);
    const mid = onSphere(a.x + b.x, a.y + b.y, a.z + b.z);
    grid.blockCircle(mid, 0.3);
    expect(grid.lineOfWalk(a, b)).toBe(false);
    expect(grid.lineOfWalk(b, a)).toBe(false);
  });

  it('walks arcs longer than a quarter turn', () => {
    const grid = openGrid(128);
    const a = onSphere(1, 0.2, 0.1);
    const b = onSphere(-1, 0.25, 0.2);
    const cells = grid.cellsAlong(a, b);
    expect(cells.length).toBeGreaterThan(100);
    expect(cells[cells.length - 1]).toBe(grid.cellOf(b));
    expect(new Set(cells).size).toBe(cells.length);
  });
});

describe('blockers', () => {
  it('counts blockers so overlapping circles unblock cleanly, and snapshots them', () => {
    const grid = openGrid(320);
    const p = onSphere(0.3, 1, -0.2);
    const before = grid.snapshotBlockers();
    grid.blockCircle(p, 2);
    grid.blockCircle(toward(p, onSphere(1, 0, 0), 1), 2);
    expect(grid.isWalkableAt(p)).toBe(false);
    const both = grid.snapshotBlockers();
    grid.unblockCircle(p, 2);
    expect(grid.isWalkableAt(p)).toBe(false);
    grid.unblockCircle(toward(p, onSphere(1, 0, 0), 1), 2);
    expect(grid.isWalkableAt(p)).toBe(true);
    expect(grid.snapshotBlockers()).toEqual(before);
    grid.restoreBlockers(both);
    expect(grid.isWalkableAt(p)).toBe(false);
  });

  it('blocks exactly the cells whose centers lie within the radius, across faces', () => {
    const grid = openGrid(320);
    const corner = onSphere(1, 1, 1);
    grid.blockCircle(corner, 3);
    let blocked = 0;
    let wrong = 0;
    for (let c = 0; c < grid.cellCount; c++) {
      const inside = dist(grid.cellCenter(c), corner) <= 3;
      if (grid.isWalkableCell(c) === inside) wrong += 1;
      if (inside) blocked += 1;
    }
    expect(wrong).toBe(0);
    // Three faces share the corner; a 3 m disc there covers cells on all.
    expect(blocked).toBeGreaterThan(300);
  });

  it('snaps a blocked point to the nearest open cell, across a face edge', () => {
    const grid = openGrid(320);
    const edge = onSphere(1, 0.2, 1);
    grid.blockCircle(edge, 2);
    const near = grid.nearestWalkable(edge)!;
    expect(grid.isWalkableAt(near)).toBe(true);
    expect(dist(near, edge)).toBeGreaterThan(1.9);
    expect(dist(near, edge)).toBeLessThan(2.6);
    expect(Math.abs(len(near) - R)).toBeLessThan(1e-9);
  });
});

describe('heights', () => {
  it('reads a cell height in meters, and a blocked cell its open neighbor', () => {
    const n = 64;
    const heights = new Int16Array(6 * n * n).fill(1500);
    const grid0 = openGrid(n);
    const p = onSphere(0.2, 0.3, 1);
    const c = grid0.cellOf(p);
    heights[c] = -32768;
    const grid = new SphereNavGrid({
      radius: R,
      cellsPerFace: n,
      heightScale: 0.001,
      blockedValue: -32768,
      heights,
    });
    expect(grid.isWalkableCell(c)).toBe(false);
    expect(grid.heightAt(p)).toBeCloseTo(1.5, 9);
    expect(grid.heightAt(grid.cellCenter(c + 1))).toBeCloseTo(1.5, 9);
  });

  it('decodes an export and refuses a short one', () => {
    const n = 4;
    const buf = new ArrayBuffer(6 * n * n * 2);
    const view = new DataView(buf);
    view.setInt16(2, 1234, true);
    view.setInt16(4, -32768, true);
    const spec = {
      version: 1,
      radius: 80,
      cellsPerFace: n,
      heightScale: 0.001,
      blockedValue: -32768,
    };
    const data = decodeSphereNav(spec, buf);
    expect(data.heights[1]).toBe(1234);
    const grid = new SphereNavGrid(data);
    expect(grid.isWalkableCell(2)).toBe(false);
    expect(grid.isWalkableCell(1)).toBe(true);
    expect(() => decodeSphereNav(spec, buf.slice(2))).toThrow();
    expect(() => decodeSphereNav({ ...spec, version: 2 }, buf)).toThrow();
  });
});

describe('path search on the sphere', () => {
  it('bounds the great circle from below, tightly', () => {
    for (const c of [0, 0.01, 0.5, 3, 20, 80, 113, 150, 159.99, 160]) {
      const exact = 2 * R * Math.asin(Math.min(1, c / (2 * R)));
      const lower = arcLowerBound(c, R);
      expect(lower).toBeLessThanOrEqual(exact + 1e-12);
      expect(lower).toBeGreaterThanOrEqual(exact * (1 - 2e-5) - 1e-12);
      expect(lower).toBeGreaterThanOrEqual(c - 1e-12);
    }
  });

  it('crosses face edges around a wall', () => {
    const grid = openGrid(320);
    const from = onSphere(1, 0.1, 0.6);
    const to = onSphere(0.6, 0.1, 1);
    // A wall straddling the +X/+Z edge, across the straight way.
    const edge = onSphere(1, 0.1, 1);
    for (let k = -8; k <= 8; k++) grid.blockCircle(toward(edge, onSphere(0, 1, 0), k * 0.8), 0.8);
    expect(grid.lineOfWalk(from, to)).toBe(false);
    const path = findSpherePath(grid, from, to);
    expect(path.length).toBeGreaterThan(1);
    expectWalkablePath(grid, from, path);
    expect(dist(path[path.length - 1]!, to)).toBeLessThan(1e-9);
    expect(pathLength(from, path)).toBeGreaterThan(dist(from, to));
  });

  it('walks around the spire at the north pole and the monolith at the south', () => {
    const grid = openGrid(320);
    const north = { x: 0, y: R, z: 0 };
    const south = { x: 0, y: -R, z: 0 };
    grid.blockCircle(north, 4);
    grid.blockCircle(south, 4);
    for (const [pole, from, to] of [
      [north, toward(north, onSphere(1, 0, 0.1), 9), toward(north, onSphere(-1, 0, -0.1), 9)],
      [south, toward(south, onSphere(0, 0, 1), 7), toward(south, onSphere(0.05, 0, -1), 7)],
    ] as const) {
      const path = findSpherePath(grid, from, to);
      expect(path.length).toBeGreaterThan(1);
      expectWalkablePath(grid, from, path);
      for (const p of path) expect(dist(p, pole)).toBeGreaterThan(4);
      const straight = dist(from, to);
      expect(pathLength(from, path)).toBeGreaterThan(straight);
      expect(pathLength(from, path)).toBeLessThan(straight * 1.6);
    }
  });

  it('snaps a blocked goal to its nearest walkable point', () => {
    const grid = openGrid(320);
    const goal = onSphere(-0.4, 0.2, -1);
    grid.blockCircle(goal, 1.5);
    const path = findSpherePath(grid, onSphere(-0.5, 0.25, -1), goal);
    const last = path[path.length - 1]!;
    expect(grid.isWalkableAt(last)).toBe(true);
    expect(dist(last, goal)).toBeLessThan(2.2);
  });

  it('finds the same path every time, on a fresh grid too', () => {
    const build = () => {
      const grid = openGrid(320);
      const rng = new Rng(42);
      for (let k = 0; k < 400; k++) grid.blockCircle(randomPoint(rng), rng.range(0.5, 3));
      return grid;
    };
    const g1 = build();
    const g2 = build();
    const rng = new Rng(3);
    for (let k = 0; k < 8; k++) {
      const a = randomPoint(rng);
      const b = toward(a, randomPoint(rng), 60);
      const p1 = findSpherePath(g1, a, b);
      expect(findSpherePath(g1, a, b)).toEqual(p1);
      expect(findSpherePath(g2, a, b)).toEqual(p1);
    }
  });
});

describe('the shipped planet', () => {
  const folder = new URL('../public/map/planet/', import.meta.url);
  const planet = assemblePlanet(JSON.parse(readFileSync(new URL('layout.json', folder), 'utf8')));
  const bin = readFileSync(new URL('navigation.bin', folder));
  const data = decodeSphereNav(
    planet.nav,
    bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer,
  );

  it('finds long near-antipodal paths within the search budget', () => {
    const grid = new SphereNavGrid(data);
    const spots = planet.caches.map((c) => c.at);
    const pairs: [SpherePoint, SpherePoint][] = [];
    for (let k = 0; k < 24; k++) {
      const a = spots[(k * 37) % spots.length]!;
      let far = a;
      for (const b of spots) if (dist(a, b) > dist(a, far)) far = b;
      pairs.push([a, far]);
    }
    findSpherePath(grid, pairs[0]![0], pairs[0]![1]);
    const times: number[] = [];
    for (const [a, b] of pairs) {
      const t0 = performance.now();
      const path = findSpherePath(grid, a, b);
      times.push(performance.now() - t0);
      expect(path.length).toBeGreaterThan(0);
      expectWalkablePath(grid, a, path);
      const walked = pathLength(a, path);
      // About half the planet's circumference, never a wild detour.
      expect(walked).toBeGreaterThan(200);
      expect(walked).toBeLessThan(330);
    }
    times.sort((x, y) => x - y);
    const median = times[times.length >> 1]!;
    const worst = times[times.length - 1]!;
    console.log(
      `planet paths of about 250 m: median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`,
    );
    // Measured at about 2 ms median and 11 ms worst on the build box; the
    // bound is loose so a loaded CI runner does not fail it for being slow.
    expect(median).toBeLessThan(15);
    expect(worst).toBeLessThan(80);
  });
});
