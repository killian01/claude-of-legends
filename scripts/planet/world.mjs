// The layout as it is being placed: the blocking footprints (circles and
// boxes), the keep-out zones (paths, plazas, landing zones), the bushes and
// the dressing. Every blocking prop goes through canPlace(), which keeps
// the rule that makes the planet walkable without thin traps: two solid
// footprints either touch (one mass) or leave at least GAP meters between
// them, and nothing solid lands on a path, a plaza or the water's edge.

import { PointHash } from './spatial.mjs';
import {
  add,
  cross,
  dot,
  faceOf,
  normalize,
  polar,
  RADIUS,
  scale,
  slerp,
  tangentFrame,
  travel,
} from './sphere.mjs';

export const GAP = 2.9;

export class World {
  constructor(terrain, grid) {
    this.terrain = terrain;
    this.grid = grid;
    this.circles = [];
    this.boxes = [];
    this.paths = [];
    this.plazas = [];
    this.bushes = [];
    this.decor = [];
    this.special = { bridges: [], ramps: [], waters: [], gates: [] };
    this.footHash = new PointHash(5);
    this.pathHash = new PointHash(4);
    this.plazaHash = new PointHash(12);
    this.bushHash = new PointHash(6);
    this.decorHash = new PointHash(4);
    this.masses = [];
    this.massHash = new PointHash(16);
    this.fields = [];
    this.groupSeq = 0;
  }

  newGroup() {
    this.groupSeq += 1;
    return this.groupSeq;
  }

  // ---- solid masses: deep woods, schist massifs, crags, hedges, rubble ---

  addMass(shape, kind, height, extra = {}) {
    const mass = { shape, kind, height, ...extra };
    this.masses.push(mass);
    this.massHash.insert(shape.center, mass);
    this.terrain.addSolid((d) => shape.sd(d), kind, height, shape.center, shape.rmax);
    return mass;
  }

  // A carved mass over a whole face: solid wherever the ground is farther
  // than a noisy margin from every open feature (deep woods, crag walls).
  addField(field) {
    this.fields.push(field);
    this.terrain.addSolid((d) => field.sd(d), field.kind, field.height, null, 0);
    return field;
  }

  // Meters from d to the nearest plaza's rim (negative inside one).
  plazaEdgeDistance(d, within = 12) {
    let best = within;
    this.plazaHash.query(d, within + 30, (p, m) => {
      const e = m - p.r;
      if (e < best) best = e;
    });
    return best;
  }

  // Signed distance to the nearest solid mass (negative inside).
  massSd(d, within = 30) {
    let best = within;
    this.massHash.query(d, within + 40, (m) => {
      const s = m.shape.sd(d);
      if (s < best) best = s;
    });
    for (const f of this.fields) {
      const s = f.sd(d);
      if (s < best) best = s;
    }
    return best;
  }

  // Whether a mass of the given shape fits: its rim clear of paths, plazas,
  // water, cliffs, other masses and footprints by `gap` meters.
  canPlaceMass(shape, opts = {}) {
    const gap = opts.gap ?? GAP + 0.4;
    const pathMargin = opts.pathMargin ?? 1.2;
    const plazaMargin = opts.plazaMargin ?? 1.5;
    const c = shape.center;
    const rmax = shape.rmax;
    if (this.inPlaza(c, 0)) return false;
    let rim = null;
    const plazaHit = (p, dist) => {
      if (dist - rmax >= p.r + plazaMargin) return false;
      if (shape.sd(p.at) < 0) return true;
      rim = rim ?? shape.outline(1);
      for (const q of rim) {
        const dx = q[0] - p.at[0];
        const dy = q[1] - p.at[1];
        const dz = q[2] - p.at[2];
        if (RADIUS * Math.sqrt(dx * dx + dy * dy + dz * dz) < p.r + plazaMargin) return true;
      }
      return false;
    };
    if (this.plazaHash.any(c, rmax + 40, plazaHit)) return false;
    let hit = false;
    this.footHash.query(c, rmax + gap + 2, (e) => {
      if (hit) return;
      hit = shape.sd(e.d ?? c) < e.r + gap;
    });
    if (hit) return false;
    const others = [];
    this.massHash.query(c, rmax + 40, (m, dist) => {
      if (dist < rmax + m.shape.rmax + gap) others.push(m);
    });
    for (const p of shape.outline(1.5)) {
      if (this.pathEdgeDistance(p, pathMargin + 1) < pathMargin) return false;
      if (this.inPlaza(p, plazaMargin)) return false;
      if (this.terrainBusy(p)) return false;
      for (const m of others) if (m.shape.sd(p) < gap) return false;
      if (!opts.ignoreFields) for (const f of this.fields) if (f.sd(p) < gap) return false;
      const frame = tangentFrame(p);
      for (let k = 0; k < 4; k++) {
        if (this.terrainBusy(polar(p, frame, gap, (k * Math.PI) / 2))) return false;
      }
    }
    return true;
  }

  // ---- keep-outs ---------------------------------------------------------

  addPath(points, halfWidth, kind, paved = false) {
    const path = { points, halfWidth, kind, paved, region: faceOf(points[0]) };
    this.paths.push(path);
    for (const d of points) this.pathHash.insert(d, path);
    return path;
  }

  addPlaza(at, r, kind, paving = 'none') {
    const plaza = { at, r, kind, paving };
    this.plazas.push(plaza);
    this.plazaHash.insert(at, plaza);
    return plaza;
  }

  // Meters from d to the nearest path's edge (negative inside a path).
  pathEdgeDistance(d, within = 12) {
    let best = within;
    this.pathHash.query(d, within + 3.1, (path, m) => {
      const e = m - path.halfWidth;
      if (e < best) best = e;
    });
    return best;
  }

  nearestPath(d, within = 20) {
    let best = null;
    let bestM = within;
    this.pathHash.query(d, within, (path, m) => {
      if (m - path.halfWidth < bestM) {
        bestM = m - path.halfWidth;
        best = path;
      }
    });
    return best ? { path: best, edge: bestM } : null;
  }

  inPlaza(d, margin = 0, kinds = null) {
    return this.plazaHash.any(
      d,
      40,
      (p, m) => m < p.r + margin && (kinds === null || kinds.includes(p.kind)),
    );
  }

  // Terrain that already blocks: water, a cliff rim, a ramp's walkway.
  terrainBlocked(d) {
    const t = this.terrain;
    if (t.waterSd(d) < 0.3) return true;
    const { sd, plateau } = t.plateauAt(d);
    if (plateau && Math.abs(sd) < plateau.band / 2 + 0.6 && !t.onRamp(d, 0.5)) return true;
    return false;
  }

  terrainBusy(d) {
    return this.terrainBlocked(d) || this.terrain.onRamp(d, 2.2) !== null;
  }

  // ---- solid footprints --------------------------------------------------

  // Whether a solid circle (r meters) may stand at d.
  canPlace(d, r, opts = {}) {
    const gap = opts.gap ?? GAP;
    const group = opts.group ?? 0;
    if (!opts.ignoreReserves) {
      if (this.pathEdgeDistance(d, r + 3) < r + (opts.pathMargin ?? 0.7)) return false;
      if (this.inPlaza(d, r + (opts.plazaMargin ?? 0.8))) return false;
    }
    if (!opts.ignoreTerrain) {
      if (this.terrainBusy(d)) return false;
      const frame = tangentFrame(d);
      for (let k = 0; k < 8; k++) {
        const b = (k * Math.PI) / 4;
        const near = polar(d, frame, r + 0.25, b);
        const far = polar(d, frame, r + gap, b);
        if (this.terrainBusy(far) && !this.terrainBusy(near)) return false;
        if (this.terrainBusy(near) && !opts.allowTerrainTouch) return false;
      }
    }
    const ms = this.massSd(d, r + gap + 1);
    if (ms - r < gap && !(opts.allowInMass && ms < -r - 0.3)) {
      if (!(opts.mergeMass && ms - r < -0.3)) return false;
    }
    let ok = true;
    this.footHash.query(d, r + gap + 9, (e, m) => {
      if (!ok) return;
      const edge = m - r - e.r;
      if (edge >= gap) return;
      if (group !== 0 && e.group === group) return;
      if (opts.mergeAny && edge < -0.3) return;
      ok = false;
    });
    return ok;
  }

  addCircle(c) {
    const circle = {
      kind: c.kind,
      at: c.at,
      r: c.r,
      height: c.height ?? 2,
      sight: c.sight ?? true,
      sightR: c.sightR ?? c.r,
      scale: c.scale ?? 1,
      yaw: c.yaw ?? 0,
      variant: c.variant ?? 0,
      group: c.group ?? 0,
      prop: c.prop ?? true,
    };
    this.circles.push(circle);
    this.footHash.insert(c.at, { r: c.r, group: circle.group, d: c.at });
    return circle;
  }

  tryCircle(c, opts = {}) {
    if (!this.canPlace(c.at, c.r, { ...opts, group: c.group })) return null;
    return this.addCircle(c);
  }

  // A wall: a box `length` x `thickness` centered at `at`, its long side
  // along the unit tangent `forward`.
  addBox(b) {
    const box = {
      kind: b.kind,
      at: b.at,
      forward: b.forward,
      length: b.length,
      thickness: b.thickness,
      height: b.height,
      sight: b.sight ?? b.height >= 1.6,
      group: b.group ?? 0,
      variant: b.variant ?? 0,
    };
    this.boxes.push(box);
    const r = b.thickness / 2;
    const steps = Math.max(1, Math.ceil(b.length / r));
    for (let s = 0; s <= steps; s++) {
      const off = -b.length / 2 + (b.length * s) / steps;
      const d = travel(b.at, b.forward, off);
      this.footHash.insert(d, { r, group: box.group, d });
    }
    return box;
  }

  canPlaceBox(at, forward, length, thickness, opts = {}) {
    const r = thickness / 2;
    const steps = Math.max(1, Math.ceil(length / r));
    for (let s = 0; s <= steps; s++) {
      const off = -length / 2 + (length * s) / steps;
      if (!this.canPlace(travel(at, forward, off), r, opts)) return false;
    }
    return true;
  }

  // ---- bushes and dressing ----------------------------------------------

  canBush(d, r) {
    if (this.terrainBusy(d)) return false;
    if (this.massSd(d, r + 2) < r * 0.75) return false;
    if (this.pathEdgeDistance(d, r + 3) < 0) return false;
    if (this.inPlaza(d, r + 0.6)) return false;
    let clear = true;
    this.footHash.query(d, r + 8, (e, m) => {
      if (m < e.r + 0.6) clear = false;
    });
    if (!clear) return false;
    return !this.bushHash.any(d, r + 8, (b, m) => m < r + b.r + 0.9);
  }

  addBush(d, r, variant = 0) {
    const bush = { at: d, r, variant };
    this.bushes.push(bush);
    this.bushHash.insert(d, bush);
    return bush;
  }

  addDecor(kind, at, scaleV = 1, yaw = 0, variant = 0, extra = {}) {
    const item = { kind, at, scale: scaleV, yaw, variant, ...extra };
    this.decor.push(item);
    this.decorHash.insert(at, item);
    return item;
  }

  canDecor(d, r = 0.5, avoidPaths = true) {
    if (this.terrain.waterSd(d) < 0.4) return false;
    if (this.terrainBusy(d)) return false;
    if (this.massSd(d, r + 2) < r + 0.2) return false;
    if (avoidPaths && this.pathEdgeDistance(d, 4) < 0.4) return false;
    if (this.inPlaza(d, 0.3)) return false;
    let clear = true;
    this.footHash.query(d, r + 8, (e, m) => {
      if (m < e.r + r) clear = false;
    });
    return clear;
  }
}

// A great-circle polyline from a to b sampled about every meter, pushed
// sideways by a smooth wobble that vanishes at both ends.
export function pathPoints(a, b, rng, wobble = 0, wavelength = 30) {
  const lengthM = RADIUS * Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  const steps = Math.max(2, Math.ceil(lengthM));
  const p1 = rng.range(0, Math.PI * 2);
  const p2 = rng.range(0, Math.PI * 2);
  const pts = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    let d = slerp(a, b, t);
    if (wobble > 0) {
      const env = Math.sin(Math.PI * t);
      const w =
        wobble *
        env *
        (0.65 * Math.sin((2 * Math.PI * t * lengthM) / wavelength + p1) +
          0.35 * Math.sin((2 * Math.PI * t * lengthM) / (wavelength * 0.47) + p2));
      const ahead = slerp(a, b, Math.min(1, t + 0.01));
      const fwd = normalize(add(ahead, scale(d, -dot(ahead, d))));
      const side = normalize(cross(d, fwd));
      if (Number.isFinite(side[0])) d = travel(d, side, w);
    }
    pts.push(d);
  }
  return pts;
}

// A closed circle of points at `meters` around center.
export function ringPoints(center, meters, from = 0, to = Math.PI * 2) {
  const frame = tangentFrame(center);
  const lengthM = meters * Math.abs(to - from);
  const steps = Math.max(8, Math.ceil(lengthM));
  const pts = [];
  for (let s = 0; s <= steps; s++)
    pts.push(polar(center, frame, meters, from + ((to - from) * s) / steps));
  return pts;
}
