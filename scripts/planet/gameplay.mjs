// What the layout records for the sim once the cells are final: the bushes
// that survived, the caches (Poisson-disc, denser in the Sanctuary and at
// every region heart), the checks on pads, camps and arenas, and the sight
// blockers approximating every tall solid thing.

import { discOpen, discOpenFraction } from './analysis.mjs';
import { CAMP_RADIUS } from './regions.mjs';
import { PointHash } from './spatial.mjs';
import { arcMeters, cellOf, dot, FACES, faceOf, RADIUS, travel } from './sphere.mjs';

export const CACHE_GAP = 6;
export const CACHE_TARGET = 250;

export function keepBushes(grid, world, ctx) {
  const kept = [];
  const dropped = { blocked: 0, covered: 0, pad: 0 };
  for (const b of world.bushes) {
    if (grid.blocked[cellOf(b.at)] !== 0) {
      dropped.blocked += 1;
      continue;
    }
    if (discOpenFraction(grid, b.at, b.r) < 0.8) {
      dropped.covered += 1;
      continue;
    }
    if (
      ctx.pads.some((p) => arcMeters(p.at, b.at) < b.r + 2.6 || arcMeters(p.to, b.at) < b.r + 3.5)
    ) {
      dropped.pad += 1;
      continue;
    }
    kept.push(b);
  }
  ctx.report.bushes = { planned: world.bushes.length, dropped };
  world.bushes = kept;
  return kept;
}

// Cache density: the Sanctuary is the hot drop, every heart draws loot,
// the Open ground stays lean.
const REGION_DENSITY = [0.5, 0.45, 1.0, 0.24, 0.45, 0.48];

function cacheDensity(d) {
  const f = faceOf(d);
  const toHeart = RADIUS * Math.acos(Math.min(1, dot(d, FACES[f].N)));
  const boost = Math.exp(-(toHeart * toHeart) / (2 * 24 * 24));
  return REGION_DENSITY[f] * (0.3 + 0.7 * boost);
}

function cacheSpotOk(grid, world, ctx, d) {
  if (grid.blocked[cellOf(d)] !== 0) return false;
  if (!discOpen(grid, d, 1.1)) return false;
  for (const b of world.bushes) if (arcMeters(b.at, d) < b.r + 0.9) return false;
  for (const p of ctx.pads) if (arcMeters(p.at, d) < 4 || arcMeters(p.to, d) < 4.5) return false;
  for (const c of ctx.camps) if (arcMeters(c.at, d) < CAMP_RADIUS + 1) return false;
  for (const a of Object.values(ctx.creatures)) if (arcMeters(a.at, d) < a.r + 1) return false;
  return true;
}

export function placeCaches(grid, world, ctx, rng) {
  const hash = new PointHash(8);
  const caches = [];
  for (const g of ctx.golden) {
    if (!cacheSpotOk(grid, world, ctx, g))
      throw new Error('a golden cache spot is not open ground');
    caches.push({ at: g, golden: true });
    hash.insert(g, true);
  }
  for (let k = 0; k < 400000 && caches.length < CACHE_TARGET; k++) {
    const z = rng.range(-1, 1);
    const phi = rng.range(0, Math.PI * 2);
    const s = Math.sqrt(1 - z * z);
    const d = [s * Math.cos(phi), z, s * Math.sin(phi)];
    if (rng.next() > cacheDensity(d)) continue;
    if (hash.any(d, CACHE_GAP, () => true)) continue;
    if (!cacheSpotOk(grid, world, ctx, d)) continue;
    caches.push({ at: d, golden: false });
    hash.insert(d, true);
  }
  return caches;
}

export function validate(grid, ctx, caches, bushes) {
  const problems = [];
  for (const p of ctx.pads) {
    if (!discOpen(grid, p.at, PAD_CLEAR)) problems.push(`pad ${p.name} stands on blocked ground`);
    if (!discOpen(grid, p.to, 3)) problems.push(`pad ${p.name} lands without 3 m of open ground`);
    const arc = arcMeters(p.at, p.to);
    if (Math.abs(arc - 50) > 0.01) problems.push(`pad ${p.name} throws ${arc.toFixed(3)} m`);
  }
  for (const c of ctx.camps) {
    if (!discOpen(grid, c.at, CAMP_RADIUS))
      problems.push(`camp ${c.kind} on face ${c.face} is not 7 m open`);
  }
  for (const [id, a] of Object.entries(ctx.creatures)) {
    if (!discOpen(grid, a.at, a.r)) problems.push(`the ${id} arena is not open`);
  }
  for (let i = 0; i < caches.length; i++) {
    for (let j = i + 1; j < caches.length; j++) {
      if (arcMeters(caches[i].at, caches[j].at) < CACHE_GAP - 1e-6)
        problems.push('two caches closer than 6 m');
    }
  }
  for (const b of bushes) {
    for (const c of caches) if (arcMeters(b.at, c.at) < b.r) problems.push('a cache inside a bush');
  }
  return problems;
}

const PAD_CLEAR = 1.5;

// Circles approximating every tall solid object, for line of sight.
export function sightBlockers(world, rng) {
  const out = [];
  // Carved fields: discs over their inside, each reaching the rim.
  for (const field of world.fields) {
    const hash = new PointHash(4);
    const grid = world.grid;
    const first = field.face * grid.n * grid.n;
    const order = [];
    for (let c = first; c < first + grid.n * grid.n; c++) order.push(c);
    for (let k = order.length - 1; k > 0; k--) {
      const j = rng.int(k + 1);
      const t = order[k];
      order[k] = order[j];
      order[j] = t;
    }
    for (const c of order) {
      const d = grid.dir(c);
      const s = field.sd(d);
      if (s > -0.9) continue;
      if (hash.any(d, 3.4, () => true)) continue;
      hash.insert(d, true);
      out.push({ at: d, r: Math.min(2.8, -s + 0.4) });
    }
  }
  for (const c of world.circles) if (c.sight) out.push({ at: c.at, r: c.sightR });
  for (const b of world.boxes) {
    if (!b.sight) continue;
    const r = Math.max(0.55, b.thickness / 2 + 0.1);
    const steps = Math.max(1, Math.ceil(b.length / r));
    for (let s = 0; s <= steps; s++) {
      const off = -b.length / 2 + (b.length * s) / steps;
      out.push({ at: travel(b.at, b.forward, off * 0.98), r });
    }
  }
  for (const m of world.masses) {
    if (m.height < 1.6) continue;
    const s = m.shape;
    const step = Math.max(1.4, Math.min(3, s.r0 * 0.45));
    const rim = s.outline(step);
    for (const p of rim) {
      // A circle just inside the rim, sized to the local half width.
      const toward = travel(p, unitToward(p, s.center), Math.min(step, s.r0 * 0.4));
      out.push({ at: toward, r: Math.min(step, s.r0 * 0.4) + 0.25 });
    }
    if (s.r0 > 2.5) out.push({ at: s.center, r: s.r0 * 0.62 });
    if (s.r0 > 6) {
      for (let k = 0; k < 6; k++) {
        const b = (k * Math.PI) / 3;
        const q = travel(s.center, rotate(s.frame, b), s.r0 * 0.55);
        out.push({ at: q, r: s.r0 * 0.36 });
      }
    }
  }
  return out;
}

function unitToward(from, to) {
  const k = dot(to, from);
  const t = [to[0] - from[0] * k, to[1] - from[1] * k, to[2] - from[2] * k];
  const l = Math.sqrt(t[0] * t[0] + t[1] * t[1] + t[2] * t[2]);
  return [t[0] / l, t[1] / l, t[2] / l];
}

function rotate(frame, b) {
  const c = Math.cos(b);
  const s = Math.sin(b);
  return [
    frame[0][0] * c + frame[1][0] * s,
    frame[0][1] * c + frame[1][1] * s,
    frame[0][2] * c + frame[1][2] * s,
  ];
}
