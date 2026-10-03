// Generic placement passes the regions share: dart throwing inside a face
// with a density function, for masses, trees and rocks, bushes and the
// dressing. Every pass draws from its own forked stream, so a change to one
// pass never reshuffles another.

import { distanceFrom } from './analysis.mjs';
import { Noise3 } from './random.mjs';
import { PointHash } from './spatial.mjs';
import {
  arcMeters,
  cellOf,
  faceEdgeDistance,
  faceOf,
  polar,
  randomInFace,
  tangentFrame,
} from './sphere.mjs';
import { wobblyDisc } from './terrain.mjs';
import { GAP } from './world.mjs';

const always = () => 1;

// Solid masses (deep woods, massifs, crags, hedges) until `areaTarget`
// square meters are covered or the attempts run out.
export function scatterMasses(world, rng, face, o) {
  const where = o.where ?? always;
  let area = 0;
  let placed = 0;
  for (let k = 0; k < (o.attempts ?? 4000); k++) {
    if (area >= o.areaTarget || placed >= (o.maxCount ?? 1e9)) break;
    const d = randomInFace(rng, face);
    if (rng.next() > where(d)) continue;
    const r0 = rng.range(o.r[0], o.r[1]);
    if (faceEdgeDistance(d, face) < r0 * 1.3 + (o.edgeMargin ?? 3)) continue;
    const s = o.shape ? o.shape(d, r0, rng) : wobblyDisc(d, r0, rng, o.wobble ?? 0.16);
    if (!world.canPlaceMass(s, { gap: o.gap, pathMargin: o.pathMargin })) continue;
    if (!outlineInFace(s, face, o.edgeMargin ?? 3)) continue;
    world.addMass(s, o.kind, rng.range(o.height[0], o.height[1]), { region: face });
    area += Math.PI * s.r0 * s.r0;
    placed += 1;
  }
  return { area, placed };
}

// Solid round props (trees, rocks, pillars) with the gap rule.
export function scatterSolids(world, rng, face, o) {
  const where = o.where ?? always;
  let placed = 0;
  for (let k = 0; k < (o.attempts ?? 6000) && placed < o.target; k++) {
    const d = o.sample ? o.sample(rng) : randomInFace(rng, face);
    if (!d || faceOf(d) !== face) continue;
    if (rng.next() > where(d)) continue;
    if (faceEdgeDistance(d, face) < (o.edgeMargin ?? 1.5)) continue;
    const s = rng.range(o.scale[0], o.scale[1]);
    const r = o.radius(s);
    const c = world.tryCircle(
      {
        kind: typeof o.kind === 'function' ? o.kind(rng, d) : o.kind,
        at: d,
        r,
        height: o.height(s, rng),
        sight: o.sight ? o.sight(s) : true,
        sightR: o.sightR ? o.sightR(s) : r,
        scale: s,
        yaw: rng.range(0, Math.PI * 2),
        variant: rng.int(o.variants ?? 3),
      },
      {
        gap: o.gap ?? GAP,
        pathMargin: o.pathMargin,
        plazaMargin: o.plazaMargin,
        mergeMass: o.mergeMass,
        allowInMass: o.allowInMass,
      },
    );
    if (c) placed += 1;
  }
  return placed;
}

export function scatterBushes(world, rng, face, o) {
  const where = o.where ?? always;
  let placed = 0;
  for (let k = 0; k < (o.attempts ?? 20000) && placed < o.target; k++) {
    const d = o.sample ? o.sample(rng) : randomInFace(rng, face);
    if (!d || faceOf(d) !== face) continue;
    if (rng.next() > where(d)) continue;
    const r = rng.range(o.r?.[0] ?? 1.5, o.r?.[1] ?? 3.4);
    if (faceEdgeDistance(d, face) < r + 1) continue;
    if (!world.canBush(d, r)) continue;
    // Most of a bush must stand on open ground.
    const frame = tangentFrame(d);
    let open = 0;
    for (let b = 0; b < 8; b++) {
      const p = polar(d, frame, r * 0.8, (b * Math.PI) / 4);
      if (!world.terrainBusy(p) && world.massSd(p, 3) > 0.3) open += 1;
    }
    if (open < 6) continue;
    world.addBush(d, r, rng.int(3));
    placed += 1;
  }
  return placed;
}

// Non-solid dressing (grass, flowers, ferns, reeds): never on paths or
// plazas unless asked, never inside a solid footprint.
export function scatterDecor(world, rng, face, o) {
  const where = o.where ?? always;
  let placed = 0;
  for (let k = 0; k < (o.attempts ?? o.target * 6) && placed < o.target; k++) {
    const d = o.sample ? o.sample(rng) : randomInFace(rng, face);
    if (!d || faceOf(d) !== face) continue;
    if (rng.next() > where(d)) continue;
    if (!(o.test ? o.test(d) : world.canDecor(d, o.clear ?? 0.4, o.avoidPaths ?? true))) continue;
    world.addDecor(
      o.kind,
      d,
      rng.range(o.scale[0], o.scale[1]),
      rng.range(0, Math.PI * 2),
      rng.int(o.variants ?? 3),
    );
    placed += 1;
  }
  return placed;
}

// Decorative trees filling a deep-wood mass (the mass itself blocks).
export function fillWood(world, rng, mass, spacing = 2.7) {
  const s = mass.shape;
  const frame = s.frame;
  const R = s.rmax;
  for (let x = -R; x <= R; x += spacing) {
    for (let y = -R; y <= R; y += spacing * 0.87) {
      const ox = x + ((Math.round(y / (spacing * 0.87)) & 1) * spacing) / 2;
      const jx = ox + rng.range(-0.6, 0.6);
      const jy = y + rng.range(-0.6, 0.6);
      const rho = Math.sqrt(jx * jx + jy * jy);
      const edge = s.radiusAt(Math.atan2(jy, jx));
      if (rho > edge - 0.9) continue;
      const d = polar(s.center, frame, rho, Math.atan2(jy, jx));
      const sc = rng.range(0.9, 1.45);
      world.addDecor(mass.treeKind ?? 'cypress', d, sc, rng.range(0, 6.283), rng.int(3), {
        inMass: true,
      });
    }
  }
}

export function outlineInFace(shape, face, margin) {
  for (const p of shape.outline(3)) {
    if (faceOf(p) !== face || faceEdgeDistance(p, face) < margin) return false;
  }
  return true;
}

export function distanceToAny(points, d) {
  let best = 1e9;
  for (const p of points) {
    const m = arcMeters(p, d);
    if (m < best) best = m;
  }
  return best;
}

// A carved field over one face: solid where the ground is farther than a
// noisy margin (wMin..wMax meters) from every path, plaza and `extraOpen`
// feature, fading out near the face's edges so the borders stay open. The
// distance to the paths and plazas is measured once, on the cells, when the
// field is made: everything open on that face must exist by then.
export function carveField(world, face, o) {
  const grid = world.grid;
  const n = grid.n;
  const first = face * n * n;
  const last = first + n * n;
  const seed = new Uint8Array(grid.count);
  for (const p of world.paths) {
    if (!p.points.some((d) => faceOf(d) === face || faceEdgeDistance(d, faceOf(d)) < 4)) continue;
    for (const d of p.points) grid.near(d, p.halfWidth, (c) => (seed[c] = 1));
  }
  for (const p of world.plazas) grid.near(p.at, p.r, (c) => (seed[c] = 1));
  const dist = distanceFrom(
    grid,
    (c) => c >= first && c < last && seed[c] === 1,
    (c) => c >= first && c < last,
  );
  const noise = new Noise3(o.seed);
  return world.addField({
    face,
    kind: o.kind,
    height: o.height,
    dist,
    sd(d) {
      if (faceOf(d) !== face) return 50;
      const fe = faceEdgeDistance(d, face);
      let open = dist[cellOf(d, n)];
      if (o.extraOpen) open = Math.min(open, o.extraOpen(d));
      const k = 0.5 + 0.5 * Math.max(-1, Math.min(1, noise.fbm(d, o.noiseMeters ?? 12, 3)));
      const w = o.wMin + (o.wMax - o.wMin) * k;
      const fade = Math.max(0, (o.edgeFade ?? 8) - fe) * 1.6;
      return w + fade - open;
    },
  });
}

// Dressing scattered over the inside of a solid field or mass (trees in a
// deep wood, rocks on a crag), `spacing` meters apart, at least `depth`
// meters in from the rim.
export function fillSolid(world, rng, face, sd, o) {
  const hash = new PointHash(4);
  let placed = 0;
  const attempts = o.attempts ?? 20000;
  for (let k = 0; k < attempts && placed < (o.max ?? 1e9); k++) {
    const d = o.sample ? o.sample(rng) : randomInFace(rng, face);
    const s = sd(d);
    if (s > -(o.depth ?? 0.8) || s < -(o.maxDepth ?? 1e9)) continue;
    if (hash.any(d, o.spacing, () => true)) continue;
    hash.insert(d, true);
    const kind = typeof o.kind === 'function' ? o.kind(rng, d, s) : o.kind;
    world.addDecor(
      kind,
      d,
      rng.range(o.scale[0], o.scale[1]),
      rng.range(0, Math.PI * 2),
      rng.int(o.variants ?? 3),
      {
        inMass: true,
      },
    );
    placed += 1;
  }
  return placed;
}
