// The ground of the planet as one field over directions: a gentle relief
// per region, then the lakes, the plateaus and their ramps, then the
// flattened plazas. Every height the navigation grid stores and every
// vertex Blender displaces comes from heightAt(); the water comes from
// waterSd(). Heights are meters along the normal above the sim sphere.

import { Noise3 } from './random.mjs';
import {
  clamp,
  cross,
  dot,
  FACES,
  fromLocal,
  headingTo,
  lerp,
  local,
  normalize,
  RADIUS,
  slerp,
  smoothstep,
  tangentFrame,
} from './sphere.mjs';

export const WATER_LEVEL = -0.4;
const LAKE_BED = -1.9;
const SHORE = 3;
// Per region (by face) relief amplitude in meters: the Open ground rolls,
// the Sanctuary and the Ruins sit nearly level.
const RELIEF = [0.9, 1.7, 1.0, 2.4, 1.3, 0.9];
// How sharply one region's character gives way to the next at a cube edge.
export const REGION_SHARPNESS = 24;

export function regionWeights(d, out = new Float64Array(6)) {
  let sum = 0;
  for (let f = 0; f < 6; f++) {
    const w = Math.exp(REGION_SHARPNESS * (dot(d, FACES[f].N) - 1));
    out[f] = w;
    sum += w;
  }
  for (let f = 0; f < 6; f++) out[f] /= sum;
  return out;
}

// A star-shaped region around `center`: radiusAt(theta) meters at bearing
// theta in the local frame. sd(d) < 0 inside (radial distance to the rim,
// exact for discs and close for the gentle shapes used here).
export function radialShape(center, radiusAt, rmax) {
  const frame = tangentFrame(center);
  const reach = rmax + 8;
  const cosReach = Math.cos(reach / RADIUS);
  return {
    center,
    frame,
    rmax,
    radiusAt,
    sd(d) {
      if (dot(d, center) < cosReach) return reach;
      const [x, y] = local(center, frame, d);
      return Math.sqrt(x * x + y * y) - radiusAt(Math.atan2(y, x));
    },
    // The rim as directions, about `step` meters apart.
    outline(step = 1) {
      const count = Math.max(12, Math.ceil((2 * Math.PI * rmax) / step));
      const pts = [];
      for (let k = 0; k < count; k++) {
        const th = (2 * Math.PI * k) / count;
        const r = radiusAt(th);
        pts.push(fromLocal(center, frame, r * Math.cos(th), r * Math.sin(th)));
      }
      return pts;
    },
  };
}

// A wobbly disc: radius r0 modulated by a few harmonics.
export function wobblyDisc(center, r0, rng, amount = 0.14, harmonics = 3) {
  const terms = [];
  for (let k = 2; k < 2 + harmonics; k++) {
    terms.push({ k, a: rng.range(-amount, amount) / (k - 1), phi: rng.range(0, Math.PI * 2) });
  }
  let bound = 1;
  for (const t of terms) bound += Math.abs(t.a);
  const radiusAt = (theta) => {
    let r = 1;
    for (const t of terms) r += t.a * Math.cos(t.k * theta + t.phi);
    return r0 * r;
  };
  const s = radialShape(center, radiusAt, r0 * bound);
  s.r0 = r0;
  return s;
}

// A wobbly ellipse with semi-axes a (along `angle`) and b.
export function wobblyEllipse(center, a, b, angle, rng, amount = 0.08) {
  const phi = rng.range(0, Math.PI * 2);
  const radiusAt = (theta) => {
    const t = theta - angle;
    const c = Math.cos(t) / a;
    const s = Math.sin(t) / b;
    const wob = 1 + amount * Math.cos(3 * t + phi) + amount * 0.5 * Math.cos(5 * t + 2 * phi);
    return wob / Math.sqrt(c * c + s * s);
  };
  const s = radialShape(center, radiusAt, Math.max(a, b) * (1 + amount * 1.5));
  s.r0 = Math.sqrt(a * b);
  return s;
}

// A rounded rectangle (superellipse) of half sizes a x b turned by `angle`.
export function roundedBox(center, a, b, angle, power = 6) {
  const radiusAt = (theta) => {
    const t = theta - angle;
    const c = Math.abs(Math.cos(t)) / a;
    const s = Math.abs(Math.sin(t)) / b;
    return 1 / (c ** power + s ** power) ** (1 / power);
  };
  const s = radialShape(center, radiusAt, Math.sqrt(a * a + b * b));
  s.r0 = Math.sqrt(a * b);
  return s;
}

// An annulus with radial dry gaps (isthmuses) at given bearings.
export function ringShape(center, rin, rout, gaps, rng) {
  const p1 = rng.range(0, 6.28);
  const p2 = rng.range(0, 6.28);
  const frame = tangentFrame(center);
  const reach = rout * 1.15 + 8;
  const cosReach = Math.cos(reach / RADIUS);
  const sdLocal = (x, y) => {
    const rho = Math.sqrt(x * x + y * y);
    const th = Math.atan2(y, x);
    const ri = rin * (1 + 0.06 * Math.cos(3 * th + p1));
    const ro = rout * (1 + 0.07 * Math.cos(4 * th + p2) + 0.04 * Math.cos(7 * th + p1));
    let sd = Math.max(ri - rho, rho - ro);
    for (const g of gaps) {
      const gx = Math.cos(g.bearing);
      const gy = Math.sin(g.bearing);
      const along = x * gx + y * gy;
      if (along <= 0) continue;
      const lat = Math.abs(-x * gy + y * gx);
      sd = Math.max(sd, g.halfWidth - lat);
    }
    return sd;
  };
  return {
    center,
    frame,
    rmax: rout * 1.15,
    sd(d) {
      if (dot(d, center) < cosReach) return reach;
      const [x, y] = local(center, frame, d);
      return sdLocal(x, y);
    },
  };
}

export class Terrain {
  constructor(seed) {
    this.noise = new Noise3(seed);
    this.detail = new Noise3(seed ^ 0x5bd1e995);
    this.lakes = [];
    this.plateaus = [];
    this.ramps = [];
    this.flats = [];
    this.solids = [];
    this.weights = new Float64Array(6);
  }

  // A solid mass lifts the ground it covers (presentation only: the cells
  // are blocked): rock walls rise steeply from the rim, woods sit on a low
  // mound of undergrowth, rubble heaps round off.
  addSolid(sd, kind, height, center, rmax) {
    this.solids.push({
      sd,
      kind,
      height,
      center,
      cosReach: center ? Math.cos((rmax + 1) / RADIUS) : -2,
    });
  }

  applySolids(d, h) {
    for (const s of this.solids) {
      if (s.center && dot(d, s.center) < s.cosReach) continue;
      const sd = s.sd(d);
      if (sd >= 0) continue;
      const k = s.kind;
      if (k === 'deepwood') h += 0.35 * smoothstep(0, 2, -sd);
      else if (k === 'hedge' || k === 'hall') h += 0;
      else if (k === 'rubble')
        h += s.height * smoothstep(0, 3, -sd) * (0.8 + 0.2 * this.detail.fbm(d, 3, 2));
      else {
        const rise = smoothstep(0, k === 'crag' ? 2.4 : 1.8, -sd);
        const n = 0.7 + 0.3 * clamp(this.noise.fbm(d, 7, 3), -1, 1);
        const top = k === 'crag' ? s.height * n * smoothstep(0, 9, -sd + 3) : s.height * n;
        h += top * Math.sqrt(rise);
      }
    }
    return h;
  }

  baseHeight(d) {
    const w = regionWeights(d, this.weights);
    let amp = 0;
    for (let f = 0; f < 6; f++) amp += w[f] * RELIEF[f];
    const n = clamp(this.noise.fbm(d, 30, 4), -1, 1);
    const fine = this.detail.fbm(d, 8, 2) * 0.12;
    return clamp(amp * (0.5 + 0.5 * n) + fine, 0, 2.5);
  }

  waterSd(d) {
    let sd = 1e9;
    for (const l of this.lakes) {
      const s = l.sd(d);
      if (s < sd) sd = s;
    }
    return sd;
  }

  // Signed distance to the nearest plateau's rim (negative on top) and that
  // plateau, for the cliff dressing and the paint.
  plateauAt(d) {
    let best = null;
    let sd = 1e9;
    for (const p of this.plateaus) {
      const s = p.shape.sd(d);
      if (s < sd) {
        sd = s;
        best = p;
      }
    }
    return { sd, plateau: best };
  }

  addLake(s) {
    this.lakes.push(s);
  }

  // A raised plateau with a flat top `top` meters above the sim sphere and
  // a cliff `band` meters wide at its rim.
  addPlateau(s, top, band = 1.3) {
    const p = { shape: s, top, band };
    this.plateaus.push(p);
    return p;
  }

  // A ramp from `a` (foot, outside) to `b` (head, on top), `width` meters.
  addRamp(a, b, width, plateau) {
    const m = slerp(a, b, 0.5);
    const e = headingTo(m, b);
    const q = normalize(cross(m, e));
    const lengthM = RADIUS * Math.acos(clamp(dot(a, b), -1, 1));
    const ramp = { a, b, m, e, q, width, length: lengthM, plateau, bottom: 0, top: plateau.top };
    ramp.bottom = this.heightBefore(a, 'ramps');
    this.ramps.push(ramp);
    return ramp;
  }

  addFlat(center, r, falloff = 4) {
    const target = this.heightBefore(center, 'flats');
    const f = { center, r, falloff, target, cosReach: Math.cos((r + falloff) / RADIUS) };
    this.flats.push(f);
    return f;
  }

  heightBefore(d, stage) {
    let h = this.baseHeight(d);
    h = this.applyLakes(d, h);
    h = this.applyPlateaus(d, h);
    if (stage === 'ramps') return h;
    h = this.applyRamps(d, h);
    return h;
  }

  applyLakes(d, h) {
    const sd = this.waterSd(d);
    if (sd >= SHORE) return h;
    if (sd >= 0) return lerp(WATER_LEVEL + 0.12, h, smoothstep(0, SHORE, sd));
    return lerp(WATER_LEVEL + 0.12, LAKE_BED, smoothstep(0, 2.6, -sd));
  }

  applyPlateaus(d, h) {
    for (const p of this.plateaus) {
      const sd = p.shape.sd(d);
      if (sd > p.band) continue;
      const s = smoothstep(-p.band / 2, p.band / 2, -sd);
      const top = p.top + 0.12 * this.detail.fbm(d, 6, 2);
      h = lerp(h, top, s);
    }
    return h;
  }

  rampLocal(r, d) {
    const along = RADIUS * dot(d, r.e);
    const lat = RADIUS * dot(d, r.q);
    return [along, lat];
  }

  applyRamps(d, h) {
    for (const r of this.ramps) {
      if (dot(d, r.m) < Math.cos((r.length / 2 + r.width + 3) / RADIUS)) continue;
      const [along, lat] = this.rampLocal(r, d);
      const t = clamp(along / r.length + 0.5, 0, 1);
      const beyond = Math.max(0, Math.abs(along) - r.length / 2);
      const mLong = 1 - smoothstep(0, 1.6, beyond);
      const mLat = 1 - smoothstep(r.width / 2, r.width / 2 + 0.7, Math.abs(lat));
      const m = mLong * mLat;
      if (m <= 0) continue;
      const hr = lerp(r.bottom, r.top, t);
      h = lerp(h, hr, m);
    }
    return h;
  }

  applyFlats(d, h) {
    for (const f of this.flats) {
      const c = dot(d, f.center);
      if (c < f.cosReach) continue;
      const dist = RADIUS * Math.acos(clamp(c, -1, 1));
      const m = 1 - smoothstep(f.r, f.r + f.falloff, dist);
      h = lerp(h, f.target, m);
    }
    return h;
  }

  // Inside a ramp's walkway (for the cliff rule: a ramp is never a wall).
  onRamp(d, margin = 0) {
    for (const r of this.ramps) {
      if (dot(d, r.m) < Math.cos((r.length / 2 + r.width + 3) / RADIUS)) continue;
      const [along, lat] = this.rampLocal(r, d);
      if (Math.abs(along) <= r.length / 2 + margin && Math.abs(lat) <= r.width / 2 + margin)
        return r;
    }
    return null;
  }

  heightAt(d) {
    let h = this.baseHeight(d);
    h = this.applyLakes(d, h);
    h = this.applyPlateaus(d, h);
    h = this.applyRamps(d, h);
    h = this.applyFlats(d, h);
    h = this.applySolids(d, h);
    return h;
  }
}
