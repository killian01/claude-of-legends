// The cube-sphere conventions the planet is built on, the generator's own
// copy of the contract src/sim/sphere_nav.ts implements (docs/planet.md).
// Face f has an outward normal N and tangent axes U, V with U x V = N; a
// cell (f, i, j) has i along U and j along V; a point's face is the axis
// of its largest component with that component's sign, ties broken in the
// order x, y, z. The generator may use the engine's trigonometry (it runs
// once, offline, and its output is the shipped data); the cell lookup
// itself only divides, so it rounds exactly like the sim's.

export const RADIUS = 80;
export const CELLS_PER_FACE = 320;

export const FACES = [
  { N: [1, 0, 0], U: [0, 0, -1], V: [0, 1, 0] },
  { N: [-1, 0, 0], U: [0, 0, 1], V: [0, 1, 0] },
  { N: [0, 1, 0], U: [1, 0, 0], V: [0, 0, -1] },
  { N: [0, -1, 0], U: [1, 0, 0], V: [0, 0, 1] },
  { N: [0, 0, 1], U: [1, 0, 0], V: [0, 1, 0] },
  { N: [0, 0, -1], U: [-1, 0, 0], V: [0, 1, 0] },
];

// Vectors are plain [x, y, z] arrays in the generator.
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a) => Math.sqrt(dot(a, a));
export const normalize = (a) => scale(a, 1 / length(a));
export const chord = (a, b) => length(sub(a, b));
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Angle between two directions, robust near 0 and PI.
export function angleBetween(a, b) {
  return Math.atan2(length(cross(a, b)), dot(a, b));
}

// Great-circle distance in meters on the planet between two directions.
export function arcMeters(a, b) {
  return RADIUS * angleBetween(a, b);
}

export function faceOf(p) {
  const ax = Math.abs(p[0]);
  const ay = Math.abs(p[1]);
  const az = Math.abs(p[2]);
  if (ax >= ay && ax >= az) return p[0] >= 0 ? 0 : 1;
  if (ay >= az) return p[1] >= 0 ? 2 : 3;
  return p[2] >= 0 ? 4 : 5;
}

export function faceUV(f, p) {
  const F = FACES[f];
  const pn = dot(p, F.N);
  return [dot(p, F.U) / pn, dot(p, F.V) / pn];
}

export function cellOf(p, n = CELLS_PER_FACE) {
  const f = faceOf(p);
  const [u, v] = faceUV(f, p);
  const i = clamp(Math.floor(((u + 1) * n) / 2), 0, n - 1);
  const j = clamp(Math.floor(((v + 1) * n) / 2), 0, n - 1);
  return f * n * n + j * n + i;
}

export function cellFIJ(index, n = CELLS_PER_FACE) {
  const f = Math.floor(index / (n * n));
  const r = index - f * n * n;
  const j = Math.floor(r / n);
  return [f, r - j * n, j];
}

// Unit direction of a point given in face coordinates.
export function faceDir(f, u, v) {
  const F = FACES[f];
  return normalize([
    F.N[0] + u * F.U[0] + v * F.V[0],
    F.N[1] + u * F.U[1] + v * F.V[1],
    F.N[2] + u * F.U[2] + v * F.V[2],
  ]);
}

export function cellCenterDir(index, n = CELLS_PER_FACE) {
  const [f, i, j] = cellFIJ(index, n);
  return faceDir(f, (2 * i + 1) / n - 1, (2 * j + 1) / n - 1);
}

// The 8 neighbor steps, in the sim's fixed order (src/sim/sphere_nav.ts).
export const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// Neighbor table: for every cell, 8 slots in STEPS order, -1 where a cube
// corner leaves no cell. Off-face steps are found by extending the face's
// plane one cell and looking the point up, which lands on the adjacent
// face's matching row (the gnomonic grids agree along every cube edge).
export function buildNeighbors(n = CELLS_PER_FACE) {
  const count = 6 * n * n;
  const table = new Int32Array(count * 8);
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const index = f * n * n + j * n + i;
        for (let k = 0; k < 8; k++) {
          const [di, dj] = STEPS[k];
          const ni = i + di;
          const nj = j + dj;
          let out;
          if (ni >= 0 && ni < n && nj >= 0 && nj < n) {
            out = f * n * n + nj * n + ni;
          } else {
            const F = FACES[f];
            const u = (2 * ni + 1) / n - 1;
            const v = (2 * nj + 1) / n - 1;
            const p = [
              F.N[0] + u * F.U[0] + v * F.V[0],
              F.N[1] + u * F.U[1] + v * F.V[1],
              F.N[2] + u * F.U[2] + v * F.V[2],
            ];
            out = cellOf(p, n);
            // Past a cube corner both steps leave the face and the lookup
            // lands on a cell one of the straight steps already reaches.
            if (di !== 0 && dj !== 0 && (ni < 0 || ni >= n) && (nj < 0 || nj >= n)) out = -1;
          }
          if (out === index) out = -1;
          table[index * 8 + k] = out;
        }
      }
    }
  }
  return table;
}

// A tangent frame at a direction: e1 roughly along the face's U, e2 = n x e1.
export function tangentFrame(d) {
  const f = faceOf(d);
  const U = FACES[f].U;
  const e1 = normalize(sub(U, scale(d, dot(U, d))));
  const e2 = cross(d, e1);
  return [e1, e2];
}

// The point `meters` away from `d` along the tangent direction `t` (a unit
// tangent at d): the exponential map of the sphere.
export function travel(d, t, meters) {
  const a = meters / RADIUS;
  return normalize(add(scale(d, Math.cos(a)), scale(t, Math.sin(a))));
}

// Polar placement around a center: bearing in radians from the frame's e1
// toward e2, distance in meters along the great circle.
export function polar(center, frame, meters, bearing) {
  const t = add(scale(frame[0], Math.cos(bearing)), scale(frame[1], Math.sin(bearing)));
  return travel(center, t, meters);
}

// Inverse of polar: [meters, bearing] of p seen from center.
export function toPolar(center, frame, p) {
  const meters = arcMeters(center, p);
  const bearing = Math.atan2(dot(p, frame[1]), dot(p, frame[0]));
  return [meters, bearing];
}

// Local tangent-plane coordinates in meters (orthographic onto the plane at
// center, scaled so small shapes keep their size).
export function local(center, frame, p) {
  const pc = dot(p, center);
  return [(RADIUS * dot(p, frame[0])) / pc, (RADIUS * dot(p, frame[1])) / pc];
}

// The unit tangent at `from` pointing along the great circle toward `to`.
export function headingTo(from, to) {
  const t = sub(to, scale(from, dot(to, from)));
  return normalize(t);
}

// Spherical interpolation between two directions.
export function slerp(a, b, t) {
  const ang = angleBetween(a, b);
  if (ang < 1e-9) return a;
  const s = Math.sin(ang);
  return normalize(add(scale(a, Math.sin((1 - t) * ang) / s), scale(b, Math.sin(t * ang) / s)));
}

export const toPoint = (d, r = RADIUS) => ({
  x: round6(d[0] * r),
  y: round6(d[1] * r),
  z: round6(d[2] * r),
});

export function round6(x) {
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

// Corners of the cube as directions, ordered by sign pattern.
export const CORNERS = [];
for (const sx of [1, -1]) {
  for (const sy of [1, -1]) {
    for (const sz of [1, -1]) CORNERS.push(normalize([sx, sy, sz]));
  }
}

// Arc distance in meters from d to the nearest edge of face f (positive
// inside the face).
export function faceEdgeDistance(d, f) {
  const F = FACES[f];
  const dn = dot(d, F.N);
  const du = dot(d, F.U);
  const dv = dot(d, F.V);
  const s = Math.SQRT1_2;
  const m = Math.min((dn - du) * s, (dn + du) * s, (dn - dv) * s, (dn + dv) * s);
  return RADIUS * Math.asin(clamp(m, -1, 1));
}

// A direction drawn uniformly by area inside face f.
export function randomInFace(rng, f) {
  for (;;) {
    const u = rng.range(-1, 1);
    const v = rng.range(-1, 1);
    const w = 1 + u * u + v * v;
    if (rng.next() <= 1 / (w * Math.sqrt(w))) return faceDir(f, u, v);
  }
}

// Inverse of local(): the direction at tangent-plane coordinates (meters).
export function fromLocal(center, frame, x, y) {
  return normalize([
    center[0] + (x / RADIUS) * frame[0][0] + (y / RADIUS) * frame[1][0],
    center[1] + (x / RADIUS) * frame[0][1] + (y / RADIUS) * frame[1][1],
    center[2] + (x / RADIUS) * frame[0][2] + (y / RADIUS) * frame[1][2],
  ]);
}
