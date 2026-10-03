// Checks on the rasterized cells: the clearance of every walkable cell,
// the opening that removes passages narrower than a champion's path, the
// connected components (with the sim's no-corner-cutting rule), and the
// questions the gameplay placement asks ("is this disc open ground").

import { BLOCK } from './raster.mjs';

// The minimum width of anything walkable, in meters (docs/planet.md).
export const MIN_WIDTH = 2.5;

class Heap {
  constructor(cap) {
    this.f = new Float64Array(cap);
    this.i = new Int32Array(cap);
    this.size = 0;
  }

  push(idx, f) {
    if (this.size === this.f.length) {
      const nf = new Float64Array(this.f.length * 2);
      const ni = new Int32Array(this.i.length * 2);
      nf.set(this.f);
      ni.set(this.i);
      this.f = nf;
      this.i = ni;
    }
    let k = this.size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.f[p] <= f) break;
      this.f[k] = this.f[p];
      this.i[k] = this.i[p];
      k = p;
    }
    this.f[k] = f;
    this.i[k] = idx;
  }

  pop() {
    const top = this.i[0];
    const lf = this.f[--this.size];
    const li = this.i[this.size];
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= this.size) break;
      const r = l + 1;
      const m = r < this.size && this.f[r] < this.f[l] ? r : l;
      if (this.f[m] >= lf) break;
      this.f[k] = this.f[m];
      this.i[k] = this.i[m];
      k = m;
    }
    this.f[k] = lf;
    this.i[k] = li;
    return top;
  }
}

// Distance in meters from every cell in `domain` to the nearest seed cell
// center, by nearest-seed propagation over the neighbor graph.
export function distanceFrom(grid, isSeed, inDomain) {
  const dist = new Float32Array(grid.count).fill(Number.POSITIVE_INFINITY);
  const seed = new Int32Array(grid.count).fill(-1);
  const heap = new Heap(1 << 16);
  for (let c = 0; c < grid.count; c++) {
    if (isSeed(c)) {
      dist[c] = 0;
      seed[c] = c;
      heap.push(c, 0);
    }
  }
  while (heap.size > 0) {
    const c = heap.pop();
    const s = seed[c];
    for (let k = 0; k < 8; k++) {
      const nb = grid.nbr[c * 8 + k];
      if (nb < 0 || !inDomain(nb)) continue;
      const d = grid.chord(nb, s);
      if (d < dist[nb] - 1e-6) {
        dist[nb] = d;
        seed[nb] = s;
        heap.push(nb, d);
      }
    }
  }
  return dist;
}

// Morphological opening of the walkable cells by a disc of MIN_WIDTH: a
// walkable cell no disc of that width covers sits in a sliver or a pinch
// and becomes blocked. Returns how many cells it blocked.
export function openWalkable(grid) {
  const core = MIN_WIDTH / 2 + 0.15;
  const clear = distanceFrom(
    grid,
    (c) => grid.blocked[c] !== 0,
    () => true,
  );
  const isCore = (c) => grid.blocked[c] === 0 && clear[c] >= core;
  const cover = distanceFrom(grid, isCore, (c) => grid.blocked[c] === 0);
  let thin = 0;
  for (let c = 0; c < grid.count; c++) {
    if (grid.blocked[c] === 0 && !(cover[c] <= core + 0.05)) {
      grid.blocked[c] |= BLOCK.thin;
      thin += 1;
    }
  }
  return { thin, clear };
}

// Walk the sim's moves: straight neighbors, diagonals only when both
// straight cells beside them are open (src/sim/sphere_nav.ts).
export function moves(grid, c, fn) {
  const nbr = grid.nbr;
  const b = c * 8;
  for (let k = 0; k < 8; k++) {
    const nb = nbr[b + k];
    if (nb < 0 || grid.blocked[nb] !== 0) continue;
    if (k >= 4) {
      const sx = DIAG_SIDES[k][0];
      const sz = DIAG_SIDES[k][1];
      const a1 = nbr[b + sx];
      const a2 = nbr[b + sz];
      if (a1 < 0 || a2 < 0 || grid.blocked[a1] !== 0 || grid.blocked[a2] !== 0) continue;
    }
    fn(nb);
  }
}

// For each diagonal slot (STEPS order), the two straight slots beside it.
const DIAG_SIDES = [null, null, null, null, [0, 2], [0, 3], [1, 2], [1, 3]];

export function components(grid) {
  const label = new Int32Array(grid.count).fill(-1);
  const sizes = [];
  const stack = new Int32Array(grid.count);
  for (let c = 0; c < grid.count; c++) {
    if (grid.blocked[c] !== 0 || label[c] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    let top = 0;
    stack[top++] = c;
    label[c] = id;
    while (top > 0) {
      const cur = stack[--top];
      size += 1;
      moves(grid, cur, (nb) => {
        if (label[nb] < 0) {
          label[nb] = id;
          stack[top++] = nb;
        }
      });
    }
    sizes.push(size);
  }
  return { label, sizes };
}

// Blocks every walkable cell outside the largest component.
export function keepLargest(grid) {
  const { label, sizes } = components(grid);
  let main = 0;
  for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[main]) main = k;
  let removed = 0;
  for (let c = 0; c < grid.count; c++) {
    if (grid.blocked[c] === 0 && label[c] !== main) {
      grid.blocked[c] |= BLOCK.island;
      removed += 1;
    }
  }
  return { components: sizes.length, main: sizes[main] ?? 0, removed, sizes };
}

// Whether every cell within `meters` of d is walkable.
export function discOpen(grid, d, meters) {
  let ok = true;
  grid.near(d, meters, (c) => {
    if (grid.blocked[c] !== 0) ok = false;
  });
  return ok;
}

export function discOpenFraction(grid, d, meters) {
  let open = 0;
  let all = 0;
  grid.near(d, meters, (c) => {
    all += 1;
    if (grid.blocked[c] === 0) open += 1;
  });
  return all === 0 ? 0 : open / all;
}
