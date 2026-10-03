// Turns the placed world into cells: the ground height of every cell, the
// water, the cliffs (any cell steeper than STEEP to a neighbor), every solid
// footprint and mass, and the bridge decks that carry walkers over water.
// Also the paint the Blender build mixes the ground materials with.

import {
  buildNeighbors,
  CELLS_PER_FACE,
  cellCenterDir,
  cellOf,
  clamp,
  dot,
  RADIUS,
  smoothstep,
} from './sphere.mjs';

export const STEEP = 1.0;
export const BLOCK = { water: 1, steep: 2, solid: 4, mass: 8, thin: 16, island: 32 };

export class Grid {
  constructor(n = CELLS_PER_FACE) {
    this.n = n;
    this.count = 6 * n * n;
    this.dirs = new Float64Array(this.count * 3);
    for (let c = 0; c < this.count; c++) {
      const d = cellCenterDir(c, n);
      this.dirs[c * 3] = d[0];
      this.dirs[c * 3 + 1] = d[1];
      this.dirs[c * 3 + 2] = d[2];
    }
    this.nbr = buildNeighbors(n);
    this.height = new Float32Array(this.count);
    this.waterSd = new Float32Array(this.count);
    this.blocked = new Uint8Array(this.count);
    this.bridge = new Int16Array(this.count).fill(-1);
    this.mark = new Uint32Array(this.count);
    this.gen = 0;
    this.area = new Float32Array(this.count);
    for (let c = 0; c < this.count; c++) {
      const r = c % (n * n);
      const i = r % n;
      const j = (r - i) / n;
      const u = (2 * i + 1) / n - 1;
      const v = (2 * j + 1) / n - 1;
      const w = 1 + u * u + v * v;
      this.area[c] = ((4 / (n * n)) * RADIUS * RADIUS) / (w * Math.sqrt(w));
    }
  }

  dir(c) {
    return [this.dirs[c * 3], this.dirs[c * 3 + 1], this.dirs[c * 3 + 2]];
  }

  chord(a, b) {
    const dx = this.dirs[a * 3] - this.dirs[b * 3];
    const dy = this.dirs[a * 3 + 1] - this.dirs[b * 3 + 1];
    const dz = this.dirs[a * 3 + 2] - this.dirs[b * 3 + 2];
    return RADIUS * Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  metersTo(c, d) {
    const dx = this.dirs[c * 3] - d[0];
    const dy = this.dirs[c * 3 + 1] - d[1];
    const dz = this.dirs[c * 3 + 2] - d[2];
    return RADIUS * Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  walkable(c) {
    return this.blocked[c] === 0;
  }

  // Every cell whose center lies within `meters` (chord) of d, by a flood
  // from d's cell, so it crosses face edges like the sim does.
  near(d, meters, fn) {
    const start = cellOf(d, this.n);
    const gen = ++this.gen;
    const stack = [start];
    this.mark[start] = gen;
    const reach = meters + 0.8;
    while (stack.length > 0) {
      const c = stack.pop();
      const m = this.metersTo(c, d);
      if (m <= meters) fn(c, m);
      for (let k = 0; k < 8; k++) {
        const nb = this.nbr[c * 8 + k];
        if (nb < 0 || this.mark[nb] === gen) continue;
        this.mark[nb] = gen;
        if (this.metersTo(nb, d) <= reach) stack.push(nb);
      }
    }
  }
}

export function rasterize(grid, world) {
  const t = world.terrain;
  const { count } = grid;
  for (let c = 0; c < count; c++) {
    const d = grid.dir(c);
    grid.height[c] = t.heightAt(d);
    const sd = t.waterSd(d);
    grid.waterSd[c] = sd;
    if (sd < 0) grid.blocked[c] |= BLOCK.water;
  }
  // Bridge decks: walkable over the water, at the deck's height.
  world.special.bridges.forEach((b, index) => {
    const half = b.width / 2;
    grid.near(b.mid, b.length / 2 + half + 1, (c) => {
      const d = grid.dir(c);
      const along = RADIUS * dot(d, b.e);
      const lat = RADIUS * dot(d, b.q);
      if (Math.abs(along) > b.length / 2 || Math.abs(lat) > half) return;
      const s = along / b.length + 0.5;
      grid.bridge[c] = index;
      grid.blocked[c] &= ~BLOCK.water;
      grid.height[c] = b.h0 + (b.h1 - b.h0) * s + b.arch * 4 * s * (1 - s);
    });
  });
  // Cliffs: too steep to a neighbor (bridges excepted).
  for (let c = 0; c < count; c++) {
    if (grid.bridge[c] >= 0) continue;
    for (let k = 0; k < 8; k++) {
      const nb = grid.nbr[c * 8 + k];
      if (nb < 0 || grid.bridge[nb] >= 0) continue;
      const slope = Math.abs(grid.height[c] - grid.height[nb]) / grid.chord(c, nb);
      if (slope > STEEP) {
        grid.blocked[c] |= BLOCK.steep;
        break;
      }
    }
  }
  for (const circle of world.circles) {
    grid.near(circle.at, circle.r, (c) => {
      grid.blocked[c] |= BLOCK.solid;
    });
  }
  for (const box of world.boxes) {
    const side = [
      box.at[1] * box.forward[2] - box.at[2] * box.forward[1],
      box.at[2] * box.forward[0] - box.at[0] * box.forward[2],
      box.at[0] * box.forward[1] - box.at[1] * box.forward[0],
    ];
    const reach = Math.sqrt(box.length * box.length + box.thickness * box.thickness) / 2;
    grid.near(box.at, reach, (c) => {
      const d = grid.dir(c);
      const x = RADIUS * dot(d, box.forward);
      const y = RADIUS * dot(d, side);
      if (Math.abs(x) <= box.length / 2 && Math.abs(y) <= box.thickness / 2)
        grid.blocked[c] |= BLOCK.solid;
    });
  }
  for (const mass of world.masses) {
    grid.near(mass.shape.center, mass.shape.rmax + 0.5, (c) => {
      if (mass.shape.sd(grid.dir(c)) < 0) grid.blocked[c] |= BLOCK.mass;
    });
  }
  for (const field of world.fields) {
    const first = field.face * grid.n * grid.n;
    for (let c = first; c < first + grid.n * grid.n; c++) {
      if (field.sd(grid.dir(c)) < 0) grid.blocked[c] |= BLOCK.mass;
    }
  }
}

// The paint channels per cell, 0..255 each: worn path, paving, shore sand,
// bare rock, lush ground, camp floor.
export const PAINT_CHANNELS = ['path', 'paving', 'shore', 'rock', 'lush', 'camp'];

export function paint(grid, world) {
  const C = PAINT_CHANNELS.length;
  const out = new Uint8Array(grid.count * C);
  const put = (c, ch, v) => {
    const k = c * C + ch;
    const q = Math.round(clamp(v, 0, 1) * 255);
    if (q > out[k]) out[k] = q;
  };
  for (let c = 0; c < grid.count; c++) {
    const d = grid.dir(c);
    let pathV = 0;
    let paveV = 0;
    world.pathHash.query(d, 7, (path, m) => {
      const e = m - path.halfWidth;
      const v = 1 - smoothstep(-0.5, 0.45, e);
      if (path.paved) paveV = Math.max(paveV, v);
      else pathV = Math.max(pathV, v);
    });
    if (pathV > 0) put(c, 0, pathV);
    if (paveV > 0) put(c, 1, paveV);
    const sd = grid.waterSd[c];
    if (sd < 2.6) put(c, 2, 1 - smoothstep(1.2, 2.6, sd));
    if (grid.blocked[c] & BLOCK.steep) put(c, 3, 1);
    if (grid.bridge[c] >= 0) put(c, 1, 1);
  }
  for (const plaza of world.plazas) {
    if (plaza.paving === 'none') continue;
    const ch = plaza.paving === 'camp' ? 5 : 1;
    grid.near(plaza.at, plaza.r + 0.6, (c, m) =>
      put(c, ch, 1 - smoothstep(plaza.r - 0.6, plaza.r + 0.6, m)),
    );
  }
  for (const mass of world.masses) {
    const ch = mass.kind === 'deepwood' || mass.kind === 'hedge' ? 4 : 3;
    grid.near(mass.shape.center, mass.shape.rmax + 2.5, (c) => {
      const s = mass.shape.sd(grid.dir(c));
      put(c, ch, 1 - smoothstep(0, 2.2, s));
    });
  }
  for (const field of world.fields) {
    const ch = field.kind === 'deepwood' ? 4 : 3;
    const first = field.face * grid.n * grid.n;
    for (let c = first; c < first + grid.n * grid.n; c++) {
      const s = field.sd(grid.dir(c));
      if (s < 2.2) put(c, ch, 1 - smoothstep(0, 2.2, s));
    }
  }
  for (const circle of world.circles) {
    const isTree = /cypress|tree/.test(circle.kind);
    const ch = isTree ? 4 : 3;
    const reach = circle.r + (isTree ? 1.6 : 0.7);
    grid.near(circle.at, reach, (c, m) =>
      put(c, ch, (1 - smoothstep(circle.r * 0.6, reach, m)) * (isTree ? 0.8 : 0.9)),
    );
  }
  return out;
}
