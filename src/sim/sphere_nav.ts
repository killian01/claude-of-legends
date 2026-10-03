// The walkability grid of a planet: a cube projected on a sphere (the
// battle royale planet, docs/planet.md). Six faces of n x n gnomonic cells,
// a ground height per cell for the presentation, blocked cells for water,
// cliffs and everything solid. A sim position is a point on the sphere of
// `radius`; heights only lift what the renderer draws.
//
// The conventions are a contract with the layout generator
// (scripts/planet/sphere.mjs): face f has an outward normal N and tangent
// axes U, V with U x V = N; cell (f, i, j) has i along U and j along V, its
// center at normalize(N + u U + v V) with u = (2i + 1) / n - 1; its index is
// f n^2 + j n + i. A point's face is the axis of its largest component with
// that component's sign, ties broken in the order x, y, z.
//
// Only the four operations and the square root (ADR 0019): the same grid,
// the same paths, the same bits on every engine.

export interface SpherePoint {
  x: number;
  y: number;
  z: number;
}

export interface SphereNavSpec {
  version: number;
  radius: number;
  cellsPerFace: number;
  // Height units per stored integer (0.001 for millimeters).
  heightScale: number;
  // The stored value that marks a blocked cell.
  blockedValue: number;
}

export interface SphereNavData {
  radius: number;
  cellsPerFace: number;
  heightScale: number;
  blockedValue: number;
  // One per cell in index order; blocked cells hold `blockedValue`.
  heights: Int16Array;
}

// Decodes an exported navigation buffer (little-endian int16 per cell).
// Throws on a spec or buffer that cannot be a planet grid.
export function decodeSphereNav(spec: SphereNavSpec, buffer: ArrayBuffer): SphereNavData {
  const n = spec.cellsPerFace;
  if (
    spec.version !== 1 ||
    !Number.isInteger(n) ||
    n < 2 ||
    n > 2048 ||
    !Number.isFinite(spec.radius) ||
    spec.radius <= 0 ||
    !Number.isFinite(spec.heightScale) ||
    spec.heightScale <= 0 ||
    !Number.isInteger(spec.blockedValue) ||
    buffer.byteLength !== 6 * n * n * 2
  ) {
    throw new Error('planet navigation export is invalid or incomplete');
  }
  const view = new DataView(buffer);
  const heights = new Int16Array(6 * n * n);
  for (let c = 0; c < heights.length; c++) heights[c] = view.getInt16(c * 2, true);
  return {
    radius: spec.radius,
    cellsPerFace: n,
    heightScale: spec.heightScale,
    blockedValue: spec.blockedValue,
    heights,
  };
}

// N, U, V of the six faces, flat.
const FN = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
const FU = [0, 0, -1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0];
const FV = [0, 1, 0, 0, 1, 0, 0, 0, -1, 0, 0, 1, 0, 1, 0, 0, 1, 0];

// The 8 neighbor steps (di, dj), in the fixed order every search uses:
// the four straight ones, then the diagonals.
const STEP_I = [1, -1, 0, 0, 1, 1, -1, -1];
const STEP_J = [0, 0, 1, -1, 1, -1, 1, -1];
// For each diagonal slot, the two straight slots beside it.
const SIDE_A = [-1, -1, -1, -1, 0, 0, 1, 1];
const SIDE_B = [-1, -1, -1, -1, 2, 3, 2, 3];

export function faceOf(x: number, y: number, z: number): number {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const az = z < 0 ? -z : z;
  if (ax >= ay && ax >= az) return x >= 0 ? 0 : 1;
  if (ay >= az) return y >= 0 ? 2 : 3;
  return z >= 0 ? 4 : 5;
}

function cellOfXYZ(x: number, y: number, z: number, n: number): number {
  const f = faceOf(x, y, z);
  const b = f * 3;
  const pn = x * FN[b]! + y * FN[b + 1]! + z * FN[b + 2]!;
  const u = (x * FU[b]! + y * FU[b + 1]! + z * FU[b + 2]!) / pn;
  const v = (x * FV[b]! + y * FV[b + 1]! + z * FV[b + 2]!) / pn;
  let i = Math.floor(((u + 1) * n) / 2);
  let j = Math.floor(((v + 1) * n) / 2);
  if (i < 0) i = 0;
  else if (i > n - 1) i = n - 1;
  if (j < 0) j = 0;
  else if (j > n - 1) j = n - 1;
  return f * n * n + j * n + i;
}

// Tables shared by every grid of one size: the cell coordinate of each
// column, the normalization of each (i, j), and the neighbors of the cells
// on a face's rim (the interior ones are index arithmetic).
interface Tables {
  n: number;
  coord: Float64Array;
  inv: Float64Array;
  rim: Int32Array;
  rimSlot: (i: number, j: number) => number;
}

const tablesBySize = new Map<number, Tables>();

function tablesFor(n: number): Tables {
  const known = tablesBySize.get(n);
  if (known) return known;
  const coord = new Float64Array(n);
  for (let i = 0; i < n; i++) coord[i] = (2 * i + 1) / n - 1;
  const inv = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      inv[j * n + i] = 1 / Math.sqrt(1 + coord[i]! * coord[i]! + coord[j]! * coord[j]!);
    }
  }
  const perFace = 4 * n - 4;
  // Rim slots: row j = 0, row j = n - 1, then columns i = 0 and i = n - 1
  // for j in 1..n-2.
  const rimSlot = (i: number, j: number): number => {
    if (j === 0) return i;
    if (j === n - 1) return n + i;
    if (i === 0) return 2 * n + (j - 1);
    return 3 * n - 2 + (j - 1);
  };
  const rim = new Int32Array(6 * perFace * 8);
  for (let f = 0; f < 6; f++) {
    const b = f * 3;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (i !== 0 && i !== n - 1 && j !== 0 && j !== n - 1) continue;
        const slot = (f * perFace + rimSlot(i, j)) * 8;
        const self = f * n * n + j * n + i;
        for (let k = 0; k < 8; k++) {
          const ni = i + STEP_I[k]!;
          const nj = j + STEP_J[k]!;
          let out: number;
          if (ni >= 0 && ni < n && nj >= 0 && nj < n) {
            out = f * n * n + nj * n + ni;
          } else if ((ni < 0 || ni >= n) && (nj < 0 || nj >= n)) {
            // Past a cube corner: no cell there.
            out = -1;
          } else {
            // One cell past the face's edge on its plane lands on the
            // adjacent face's matching row.
            const u = (2 * ni + 1) / n - 1;
            const v = (2 * nj + 1) / n - 1;
            out = cellOfXYZ(
              FN[b]! + u * FU[b]! + v * FV[b]!,
              FN[b + 1]! + u * FU[b + 1]! + v * FV[b + 1]!,
              FN[b + 2]! + u * FU[b + 2]! + v * FV[b + 2]!,
              n,
            );
          }
          rim[slot + k] = out === self ? -1 : out;
        }
      }
    }
  }
  const tables = { n, coord, inv, rim, rimSlot };
  tablesBySize.set(n, tables);
  return tables;
}

// Search radius, in meters, for the ground under a point on a blocked cell.
const HEIGHT_SNAP_RADIUS = 3;

export class SphereNavGrid {
  readonly radius: number;
  readonly n: number;
  readonly cellCount: number;
  private readonly blockers: Uint8Array;
  private readonly heights: Int16Array;
  private readonly heightScale: number;
  private readonly blockedValue: number;
  private readonly t: Tables;
  private readonly perFace: number;
  // Scratch for the floods (circles, nearest walkable): a generation mark
  // per cell, so nothing is cleared between calls.
  private readonly mark: Uint32Array;
  private markGen = 0;
  private readonly queue: Int32Array;
  private readonly row = new Int32Array(8);

  constructor(data: SphereNavData) {
    this.radius = data.radius;
    this.n = data.cellsPerFace;
    this.cellCount = 6 * this.n * this.n;
    if (data.heights.length !== this.cellCount) throw new Error('planet grid size mismatch');
    this.heights = data.heights;
    this.heightScale = data.heightScale;
    this.blockedValue = data.blockedValue;
    this.t = tablesFor(this.n);
    this.perFace = 4 * this.n - 4;
    this.blockers = new Uint8Array(this.cellCount);
    for (let c = 0; c < this.cellCount; c++) {
      this.blockers[c] = data.heights[c] === data.blockedValue ? 1 : 0;
    }
    this.mark = new Uint32Array(this.cellCount);
    this.queue = new Int32Array(this.cellCount);
  }

  cellOf(p: SpherePoint): number {
    return cellOfXYZ(p.x, p.y, p.z, this.n);
  }

  cellCenter(c: number): SpherePoint {
    const n = this.n;
    const f = (c / (n * n)) | 0;
    const r = c - f * n * n;
    const j = (r / n) | 0;
    const i = r - j * n;
    const u = this.t.coord[i]!;
    const v = this.t.coord[j]!;
    const s = this.t.inv[j * n + i]! * this.radius;
    const b = f * 3;
    return {
      x: (FN[b]! + u * FU[b]! + v * FV[b]!) * s,
      y: (FN[b + 1]! + u * FU[b + 1]! + v * FV[b + 1]!) * s,
      z: (FN[b + 2]! + u * FU[b + 2]! + v * FV[b + 2]!) * s,
    };
  }

  // The center of cell c into out[o..o+2], without allocating.
  centerInto(c: number, out: Float64Array, o: number): void {
    const n = this.n;
    const f = (c / (n * n)) | 0;
    const r = c - f * n * n;
    const j = (r / n) | 0;
    const i = r - j * n;
    const u = this.t.coord[i]!;
    const v = this.t.coord[j]!;
    const s = this.t.inv[j * n + i]! * this.radius;
    const b = f * 3;
    out[o] = (FN[b]! + u * FU[b]! + v * FV[b]!) * s;
    out[o + 1] = (FN[b + 1]! + u * FU[b + 1]! + v * FV[b + 1]!) * s;
    out[o + 2] = (FN[b + 2]! + u * FU[b + 2]! + v * FV[b + 2]!) * s;
  }

  isWalkableCell(c: number): boolean {
    return c >= 0 && c < this.cellCount && this.blockers[c] === 0;
  }

  isWalkableAt(p: SpherePoint): boolean {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false;
    return this.blockers[this.cellOf(p)] === 0;
  }

  // The neighbor of c in slot k (STEP order), or -1 past a cube corner.
  neighbor(c: number, k: number): number {
    const n = this.n;
    const f = (c / (n * n)) | 0;
    const r = c - f * n * n;
    const j = (r / n) | 0;
    const i = r - j * n;
    if (i > 0 && i < n - 1 && j > 0 && j < n - 1) return c + STEP_I[k]! + STEP_J[k]! * n;
    return this.t.rim[(f * this.perFace + this.t.rimSlot(i, j)) * 8 + k]!;
  }

  // All 8 neighbor slots of c into out[0..7] (-1 past a cube corner).
  neighborRow(c: number, out: Int32Array): void {
    const n = this.n;
    const f = (c / (n * n)) | 0;
    const r = c - f * n * n;
    const j = (r / n) | 0;
    const i = r - j * n;
    if (i > 0 && i < n - 1 && j > 0 && j < n - 1) {
      out[0] = c + 1;
      out[1] = c - 1;
      out[2] = c + n;
      out[3] = c - n;
      out[4] = c + 1 + n;
      out[5] = c + 1 - n;
      out[6] = c - 1 + n;
      out[7] = c - 1 - n;
      return;
    }
    const base = (f * this.perFace + this.t.rimSlot(i, j)) * 8;
    for (let k = 0; k < 8; k++) out[k] = this.t.rim[base + k]!;
  }

  // The blocker count of a cell (0 is open), for the hot loops.
  blockerAt(c: number): number {
    return this.blockers[c]!;
  }

  // Up to 8 distinct neighbors of c, in the fixed slot order; returns how
  // many were written to out.
  neighbors(c: number, out: Int32Array): number {
    let count = 0;
    for (let k = 0; k < 8; k++) {
      const nb = this.neighbor(c, k);
      if (nb < 0) continue;
      let dup = false;
      for (let q = 0; q < count; q++) if (out[q] === nb) dup = true;
      if (!dup) out[count++] = nb;
    }
    return count;
  }

  // Whether a step from c into slot k is allowed: the target is open and a
  // diagonal never squeezes between two blocked straight neighbors.
  canStep(c: number, k: number): number {
    const nb = this.neighbor(c, k);
    if (nb < 0 || this.blockers[nb] !== 0) return -1;
    if (k >= 4) {
      const a = this.neighbor(c, SIDE_A[k]!);
      const b = this.neighbor(c, SIDE_B[k]!);
      if (a < 0 || b < 0 || this.blockers[a] !== 0 || this.blockers[b] !== 0) return -1;
    }
    return nb;
  }

  // The blocker counts as they stand, copied, for a world checkpoint.
  snapshotBlockers(): Uint8Array {
    return new Uint8Array(this.blockers);
  }

  restoreBlockers(blockers: Uint8Array): void {
    this.blockers.set(blockers);
  }

  // Adds one blocker to every cell whose center lies within r (chord).
  blockCircle(p: SpherePoint, r: number): void {
    this.forEachCellInCircle(p, r, (c) => {
      if (this.blockers[c]! < 255) this.blockers[c]!++;
    });
  }

  // Removes one blocker from every cell whose center lies within r. Must
  // mirror a prior blockCircle with the same shape.
  unblockCircle(p: SpherePoint, r: number): void {
    this.forEachCellInCircle(p, r, (c) => {
      if (this.blockers[c]! > 0) this.blockers[c]!--;
    });
  }

  private nextMark(): number {
    if (this.markGen >= 0xfffffffe) {
      this.mark.fill(0);
      this.markGen = 0;
    }
    return ++this.markGen;
  }

  // A flood from p's cell through every cell whose center lies within
  // r plus a cell of p; fn sees those within r, in flood order.
  private forEachCellInCircle(p: SpherePoint, r: number, fn: (c: number) => void): void {
    if (!(r >= 0) || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))
      return;
    const q = this.onSphere(p);
    const reach = r + (2.5 * this.radius) / this.n;
    const r2 = r * r;
    const reach2 = reach * reach;
    const gen = this.nextMark();
    const start = this.cellOf(q);
    let head = 0;
    let tail = 0;
    this.queue[tail++] = start;
    this.mark[start] = gen;
    const s = new Float64Array(3);
    while (head < tail) {
      const c = this.queue[head++]!;
      this.centerInto(c, s, 0);
      const dx = s[0]! - q.x;
      const dy = s[1]! - q.y;
      const dz = s[2]! - q.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r2) fn(c);
      if (d2 > reach2) continue;
      for (let k = 0; k < 8; k++) {
        const nb = this.neighbor(c, k);
        if (nb < 0 || this.mark[nb] === gen) continue;
        this.mark[nb] = gen;
        this.queue[tail++] = nb;
      }
    }
  }

  // p moved radially onto the sphere.
  onSphere(p: SpherePoint): SpherePoint {
    const l = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    if (!(l > 0)) return { x: this.radius, y: 0, z: 0 };
    const s = this.radius / l;
    return { x: p.x * s, y: p.y * s, z: p.z * s };
  }

  // The closest walkable point to p: p itself (on the sphere) when its cell
  // is open, else the nearest open cell's center, searched ring by ring of
  // neighbors. Deterministic scan order. Null only if everything within
  // maxRadiusCells rings is blocked.
  nearestWalkable(p: SpherePoint, maxRadiusCells = 25): SpherePoint | null {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
    const q = this.onSphere(p);
    const start = this.cellOf(q);
    if (this.blockers[start] === 0) return q;
    const gen = this.nextMark();
    let head = 0;
    let tail = 0;
    this.queue[tail++] = start;
    this.mark[start] = gen;
    const s = new Float64Array(3);
    for (let ring = 1; ring <= maxRadiusCells; ring++) {
      const end = tail;
      let best = -1;
      let bestD = Number.POSITIVE_INFINITY;
      while (head < end) {
        const c = this.queue[head++]!;
        for (let k = 0; k < 8; k++) {
          const nb = this.neighbor(c, k);
          if (nb < 0 || this.mark[nb] === gen) continue;
          this.mark[nb] = gen;
          this.queue[tail++] = nb;
          if (this.blockers[nb] !== 0) continue;
          this.centerInto(nb, s, 0);
          const dx = s[0]! - q.x;
          const dy = s[1]! - q.y;
          const dz = s[2]! - q.z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = nb;
          }
        }
      }
      if (best >= 0) return this.cellCenter(best);
      if (head === tail) break;
    }
    return null;
  }

  // Ground height under p, in meters: its cell's, or the nearest walkable
  // cell's within a few meters, else 0.
  heightAt(p: SpherePoint): number {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return 0;
    const c = this.cellOf(p);
    if (this.blockers[c] === 0) return this.cellHeight(c);
    const rings = Math.ceil((HEIGHT_SNAP_RADIUS * this.n) / (2 * this.radius)) + 1;
    const near = this.nearestWalkable(p, rings);
    return near ? this.cellHeight(this.cellOf(near)) : 0;
  }

  private cellHeight(c: number): number {
    const raw = this.heights[c] ?? this.blockedValue;
    return raw === this.blockedValue ? 0 : raw * this.heightScale;
  }

  // Calls visit(c) for every cell the great-circle arc from a to b passes
  // through, in order, until visit returns false. The arc is the chord a +
  // t (b - a) seen from the center, which every face projects to a straight
  // line: the walk is an exact cell traversal (a grid DDA per face), so no
  // cell the arc touches is ever skipped, at any length. A pass exactly
  // through a cell corner visits the diagonal cell and both straight ones.
  // Returns false when a visit refused, true otherwise.
  traverse(a: SpherePoint, b: SpherePoint, visit: (c: number) => boolean): boolean {
    if (![a.x, a.y, a.z, b.x, b.y, b.z].every(Number.isFinite)) return false;
    const dotAB = a.x * b.x + a.y * b.y + a.z * b.z;
    if (dotAB <= 0) {
      // Past a quarter turn, split at the midpoint: the chord would pass
      // too near the center for the projection to stay well conditioned.
      const mx = a.x + b.x;
      const my = a.y + b.y;
      const mz = a.z + b.z;
      const ml = Math.sqrt(mx * mx + my * my + mz * mz);
      if (!(ml > 1e-9 * this.radius)) return false;
      const s = this.radius / ml;
      const m = { x: mx * s, y: my * s, z: mz * s };
      let last = -1;
      const first = this.traverse(a, m, (c) => {
        last = c;
        return visit(c);
      });
      if (!first) return false;
      return this.traverse(m, b, (c) => (c === last ? true : visit(c)));
    }
    const n = this.n;
    const goal = this.cellOf(b);
    let cur = this.cellOf(a);
    if (!visit(cur)) return false;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const limit = 16 * n;
    const row = this.row;
    let face = -1;
    let an = 0;
    let dn = 0;
    let au = 0;
    let du = 0;
    let av = 0;
    let dv = 0;
    let su = 0;
    let sv = 0;
    // The arc's parameter where it entered the current cell.
    let tCur = 0;
    for (let step = 0; cur !== goal; step++) {
      // A walk this long has lost its way to rounding: refuse it.
      if (step >= limit) return false;
      const f = (cur / (n * n)) | 0;
      const r = cur - f * n * n;
      const j = (r / n) | 0;
      const i = r - j * n;
      if (f !== face) {
        // u(t) = (au + t du) / (an + t dn) moves one way along the face.
        face = f;
        const o = f * 3;
        an = a.x * FN[o]! + a.y * FN[o + 1]! + a.z * FN[o + 2]!;
        dn = dx * FN[o]! + dy * FN[o + 1]! + dz * FN[o + 2]!;
        au = a.x * FU[o]! + a.y * FU[o + 1]! + a.z * FU[o + 2]!;
        du = dx * FU[o]! + dy * FU[o + 1]! + dz * FU[o + 2]!;
        av = a.x * FV[o]! + a.y * FV[o + 1]! + a.z * FV[o + 2]!;
        dv = dx * FV[o]! + dy * FV[o + 1]! + dz * FV[o + 2]!;
        su = du * an - au * dn;
        sv = dv * an - av * dn;
      }
      // The arc leaves the cell through the boundary ahead of it.
      let tu = Number.POSITIVE_INFINITY;
      let tv = Number.POSITIVE_INFINITY;
      if (su !== 0) {
        const g = (2 * (su > 0 ? i + 1 : i)) / n - 1;
        tu = (g * an - au) / (du - g * dn);
      }
      if (sv !== 0) {
        const g = (2 * (sv > 0 ? j + 1 : j)) / n - 1;
        tv = (g * an - av) / (dv - g * dn);
      }
      // A crossing behind the entry is the line's extension, not the arc;
      // one a hair behind it is rounding, and happens now.
      if (!(tu >= tCur - 1e-9)) tu = Number.POSITIVE_INFINITY;
      else if (tu < tCur) tu = tCur;
      if (!(tv >= tCur - 1e-9)) tv = Number.POSITIVE_INFINITY;
      else if (tv < tCur) tv = tCur;
      const tNext = tu < tv ? tu : tv;
      // The arc ends inside this cell (the goal's, short of rounding).
      if (tNext > 1) break;
      this.neighborRow(cur, row);
      const slotU = su > 0 ? 0 : 1;
      const slotV = sv > 0 ? 2 : 3;
      let next: number;
      if (Math.abs(tu - tv) <= 1e-12) {
        // Through a corner: both straight neighbors are on the arc's way.
        const nu = row[slotU]!;
        const nv = row[slotV]!;
        if (nu < 0 || nv < 0) {
          next = nu >= 0 ? nu : nv;
        } else {
          if (!visit(nu) || !visit(nv)) return false;
          const diag = row[(su > 0 ? 0 : 2) + (sv > 0 ? 4 : 5)]!;
          next = diag >= 0 ? diag : nu;
        }
      } else {
        next = row[tu < tv ? slotU : slotV]!;
      }
      if (next < 0) return false;
      cur = next;
      tCur = tNext;
      if (!visit(cur)) return false;
    }
    return true;
  }

  // True when the great-circle arc from a to b stays on walkable cells.
  lineOfWalk(a: SpherePoint, b: SpherePoint): boolean {
    return this.traverse(a, b, (c) => this.blockers[c] === 0);
  }

  // The cells the arc from a to b passes through, in order (for checks).
  cellsAlong(a: SpherePoint, b: SpherePoint): number[] {
    const out: number[] = [];
    this.traverse(a, b, (c) => {
      out.push(c);
      return true;
    });
    return out;
  }
}

// ---- path search -------------------------------------------------------

// Expansions before a search gives up (a goal walled off by blockers).
const NODE_CAP = 120000;
// The heuristic is inflated by this weight (weighted A*): the path found
// costs at most this factor over the best one, and in practice the smoothed
// path is within a fraction of a percent of it, while the search expands a
// tiny fraction of the cells. On an 8-neighbor grid the plain lower bound
// leaves every cell within an ellipse of the straight line about as good as
// the next: a 250 m search on the planet expanded about 95 000 cells (70 ms
// median) and now expands about 3 600 (2 ms median, 11 ms at worst), which
// is what fifty bots repathing can afford (tests/sphere_nav.test.ts).
export const HEURISTIC_WEIGHT = 1.2;

// Scratch shared by every search on grids of one size, as in
// src/sim/pathfind.ts: generation-stamped, so nothing is cleared between
// searches; the heap is two typed arrays swapped by hand.
let scratchCells = -1;
let generation = 0;
let seen = new Uint32Array(0);
let gScore = new Float64Array(0);
let came = new Int32Array(0);
let closedAt = new Uint32Array(0);
let heapF = new Float64Array(0);
let heapI = new Int32Array(0);

function scratchFor(cells: number): void {
  if (scratchCells === cells && generation < 0xfffffffe) return;
  scratchCells = cells;
  generation = 0;
  seen = new Uint32Array(cells);
  gScore = new Float64Array(cells);
  came = new Int32Array(cells);
  closedAt = new Uint32Array(cells);
  heapF = new Float64Array(1 << 16);
  heapI = new Int32Array(1 << 16);
}

function growHeap(): void {
  const f = new Float64Array(heapF.length * 2);
  const i = new Int32Array(heapI.length * 2);
  f.set(heapF);
  i.set(heapI);
  heapF = f;
  heapI = i;
}

// A lower bound of the great-circle distance between two points of a
// sphere of radius R whose chord is c, from the four operations and square
// roots only: two half-angle steps bring the angle under PI / 8, where the
// leading terms of the arcsine series (all positive, so the sum is a lower
// bound) are exact to a few parts in a million. Admissible for chord costs
// up to that margin, which HEURISTIC_SCALE takes back.
const HEURISTIC_SCALE = 0.99999;

export function arcLowerBound(c: number, radius: number): number {
  let s = c / (2 * radius);
  if (s >= 1) s = 1;
  // sin(x / 2) from sin(x), twice (x below PI / 2 throughout).
  let k = 1;
  for (let step = 0; step < 2; step++) {
    const cos = Math.sqrt(1 - s * s);
    s = s / Math.sqrt(2 * (1 + cos));
    k *= 2;
  }
  const s2 = s * s;
  const asin = s * (1 + s2 * (1 / 6 + s2 * (3 / 40 + s2 * (15 / 336))));
  return 2 * k * asin * radius;
}

// A* over the sphere grid (8 neighbors, no corner cutting, chord costs, a
// great-circle lower bound of the chord as the heuristic, weighted by
// HEURISTIC_WEIGHT), then greedy line-of-walk smoothing. Waypoints are on the sphere and exclude the start; a blocked
// goal snaps to its nearest walkable point. Deterministic: fixed neighbor
// order, no randomness. Empty when no path exists within the node cap.
export function findSpherePath(
  grid: SphereNavGrid,
  from: SpherePoint,
  to: SpherePoint,
): SpherePoint[] {
  const start = grid.nearestWalkable(from);
  const goal = grid.nearestWalkable(to);
  if (!start || !goal) return [];
  if (grid.lineOfWalk(start, goal)) return [{ x: goal.x, y: goal.y, z: goal.z }];

  const R = grid.radius;
  const sIdx = grid.cellOf(start);
  const gIdx = grid.cellOf(goal);
  const gp = new Float64Array(3);
  grid.centerInto(gIdx, gp, 0);
  const gx = gp[0]!;
  const gy = gp[1]!;
  const gz = gp[2]!;
  const here = new Float64Array(3);
  const there = new Float64Array(3);
  const row = new Int32Array(8);

  scratchFor(grid.cellCount);
  const gen = ++generation;
  let size = 0;

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
  const heuristic = (x: number, y: number, z: number): number => {
    const dx = x - gx;
    const dy = y - gy;
    const dz = z - gz;
    return (
      HEURISTIC_WEIGHT * HEURISTIC_SCALE * arcLowerBound(Math.sqrt(dx * dx + dy * dy + dz * dz), R)
    );
  };

  seen[sIdx] = gen;
  gScore[sIdx] = 0;
  came[sIdx] = -1;
  grid.centerInto(sIdx, here, 0);
  push(sIdx, heuristic(here[0]!, here[1]!, here[2]!));
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
    grid.centerInto(cur, here, 0);
    const gCur = gScore[cur]!;
    grid.neighborRow(cur, row);
    for (let k = 0; k < 8; k++) {
      const ni = row[k]!;
      if (ni < 0 || grid.blockerAt(ni) !== 0 || closedAt[ni] === gen) continue;
      if (k >= 4) {
        const sa = row[SIDE_A[k]!]!;
        const sb = row[SIDE_B[k]!]!;
        if (sa < 0 || sb < 0 || grid.blockerAt(sa) !== 0 || grid.blockerAt(sb) !== 0) continue;
      }
      grid.centerInto(ni, there, 0);
      const ex = there[0]! - here[0]!;
      const ey = there[1]! - here[1]!;
      const ez = there[2]! - here[2]!;
      const ng = gCur + Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (seen[ni] !== gen || ng < gScore[ni]!) {
        seen[ni] = gen;
        gScore[ni] = ng;
        came[ni] = cur;
        push(ni, ng + heuristic(there[0]!, there[1]!, there[2]!));
      }
    }
  }

  if (!found) return [];

  const cells: number[] = [];
  for (let c = gIdx; c !== -1; c = came[c]!) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => grid.cellCenter(c));
  pts[pts.length - 1] = { x: goal.x, y: goal.y, z: goal.z };
  return smooth(grid, start, pts);
}

// How far ahead, in waypoints, smoothing looks for a shortcut from each
// anchor; long straight runs chain through several anchors.
const SMOOTH_WINDOW = 128;
const SECOND_PASS_WINDOW = 6;

// Greedy smoothing: from each anchor, jump to a far waypoint still in line
// of walk (found by doubling the reach, then halving back between the last
// clear and the first blocked one), dropping the grid staircase between;
// then a short pass over the shortened list for the shortcuts the first one
// missed. Every jump is a checked line of walk.
function smooth(
  grid: SphereNavGrid,
  from: SpherePoint,
  pts: readonly SpherePoint[],
): SpherePoint[] {
  const first: SpherePoint[] = [];
  let anchor = from;
  let i = 0;
  while (i < pts.length) {
    const last = Math.min(pts.length - 1, i + SMOOTH_WINDOW);
    let good = i;
    let bad = last + 1;
    for (let reach = 1; i + reach <= last; reach *= 2) {
      if (grid.lineOfWalk(anchor, pts[i + reach]!)) good = i + reach;
      else {
        bad = i + reach;
        break;
      }
    }
    if (bad === last + 1 && good < last && grid.lineOfWalk(anchor, pts[last]!)) good = last;
    else {
      while (bad - good > 1) {
        const mid = (good + bad) >> 1;
        if (grid.lineOfWalk(anchor, pts[mid]!)) good = mid;
        else bad = mid;
      }
    }
    const p = pts[good]!;
    first.push({ x: p.x, y: p.y, z: p.z });
    anchor = p;
    i = good + 1;
  }
  const out: SpherePoint[] = [];
  anchor = from;
  i = 0;
  while (i < first.length) {
    let j = i;
    for (let k = Math.min(first.length - 1, i + SECOND_PASS_WINDOW); k > i; k--) {
      if (grid.lineOfWalk(anchor, first[k]!)) {
        j = k;
        break;
      }
    }
    out.push(first[j]!);
    anchor = first[j]!;
    i = j + 1;
  }
  return out;
}
