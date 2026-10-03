// What every region shares: the six hearts, the eight crossroads with their
// beacon and launch pad, the path network (each heart to its four corners
// and through a gate to its four neighbors), the gate arches where those
// paths cross a border, and the low ridges that mark the borders without
// closing them.

import {
  arcMeters,
  CORNERS,
  cross,
  dot,
  FACES,
  faceEdgeDistance,
  faceOf,
  headingTo,
  normalize,
  polar,
  slerp,
  tangentFrame,
  travel,
} from './sphere.mjs';
import { GAP, pathPoints } from './world.mjs';

export const REGIONS = [
  { id: 'ruins', name: 'The Ruins', face: 0 },
  { id: 'groves', name: 'The Cypress Groves', face: 1 },
  { id: 'sanctuary', name: 'The Sanctuary', face: 2 },
  { id: 'open', name: 'The Open Ground', face: 3 },
  { id: 'lakes', name: 'The Lakes', face: 4 },
  { id: 'cliffs', name: 'The Cliffs', face: 5 },
];

// How each region's paths are drawn: half width, sideways wobble, paving,
// and where the corner and gate paths stop short of the heart (a plaza or
// a ring road takes over from there).
export const PATH_STYLE = [
  { halfWidth: 2.4, wobble: 0, wavelength: 30, paved: true, diagEnd: 9.5, edgeEnd: 9.5 },
  { halfWidth: 1.95, wobble: 3.6, wavelength: 34, paved: false, diagEnd: 9.5, edgeEnd: 9.5 },
  { halfWidth: 2.5, wobble: 0, wavelength: 30, paved: true, diagEnd: 14.5, edgeEnd: 14.5 },
  { halfWidth: 2.1, wobble: 2.6, wavelength: 42, paved: false, diagEnd: 8.5, edgeEnd: 8.5 },
  { halfWidth: 2.2, wobble: 0, wavelength: 30, paved: false, diagEnd: 29, edgeEnd: 8.5 },
  { halfWidth: 2.2, wobble: 0, wavelength: 30, paved: false, diagEnd: 21, edgeEnd: 21 },
];

export const CROSSROADS_RADIUS = 9;
export const BEACON_RADIUS = 1.3;
export const PAD_RADIUS = 1.5;
export const PAD_OFFSET = 4.6;
export const THROW_METERS = 50;

// The heart of face f and its polar frame (bearing 0 along U, 90 along V).
export function heart(f) {
  return FACES[f].N.slice();
}

export function heartFrame(f) {
  return [FACES[f].U.slice(), FACES[f].V.slice()];
}

export function P(f, meters, degrees) {
  return polar(heart(f), heartFrame(f), meters, (degrees * Math.PI) / 180);
}

// The cube corners a face touches, and the edges between adjacent faces.
export function faceCorners(f) {
  return CORNERS.filter((c) => dot(c, FACES[f].N) > 0.5);
}

export function edges() {
  const out = [];
  for (let a = 0; a < 6; a++) {
    for (let b = a + 1; b < 6; b++) {
      if (Math.abs(dot(FACES[a].N, FACES[b].N)) > 0.5) continue;
      const shared = CORNERS.filter((c) => dot(c, FACES[a].N) > 0.5 && dot(c, FACES[b].N) > 0.5);
      out.push({
        a,
        b,
        mid: normalize(FACES[a].N.map((x, k) => x + FACES[b].N[k])),
        corners: shared,
      });
    }
  }
  return out;
}

export function addCrossroads(world, ctx) {
  ctx.crossroads = [];
  for (const c of CORNERS) {
    world.addPlaza(c, CROSSROADS_RADIUS, 'crossroads', 'crossroads');
    world.terrain.addFlat(c, CROSSROADS_RADIUS, 5);
    world.addCircle({
      kind: 'beacon',
      at: c,
      r: BEACON_RADIUS,
      height: 15,
      sight: true,
      group: world.newGroup(),
    });
    ctx.crossroads.push(c);
  }
}

export function addPaths(world, rng, _ctx) {
  for (let f = 0; f < 6; f++) {
    const st = PATH_STYLE[f];
    const h = heart(f);
    for (const c of faceCorners(f)) {
      const a = travel(c, headingTo(c, h), CROSSROADS_RADIUS - 1);
      const b = travel(h, headingTo(h, c), st.diagEnd);
      const pts = pathPoints(a, b, rng.fork(`diag${f}`), st.wobble, st.wavelength);
      world.addPath(pts, st.halfWidth, 'road', st.paved);
    }
  }
  for (const e of edges()) {
    for (const f of [e.a, e.b]) {
      const st = PATH_STYLE[f];
      const h = heart(f);
      const b = travel(h, headingTo(h, e.mid), st.edgeEnd);
      const pts = pathPoints(e.mid, b, rng.fork(`edge${e.a}${e.b}${f}`), st.wobble, st.wavelength);
      world.addPath(pts, st.halfWidth, 'road', st.paved);
    }
  }
}

// Gate arches where the heart-to-heart paths cross a border.
export function addGates(world) {
  for (const e of edges()) {
    const heading = headingTo(e.mid, FACES[e.a].N);
    const along = normalize(cross(e.mid, heading));
    const group = world.newGroup();
    for (const side of [-1, 1]) {
      world.addCircle({
        kind: 'gate_pillar',
        at: travel(e.mid, along, side * 3.9),
        r: 0.9,
        height: 7,
        sight: true,
        group,
        prop: false,
      });
    }
    world.special.gates.push({ at: e.mid, forward: along, span: 7.8, a: e.a, b: e.b });
  }
}

// Two low ridges of rock on every border, leaving the gate stretch and the
// crossroads open: the borders read on the ground and stay passable along
// most of their length.
export function addBorderRidges(world, rng) {
  for (const e of edges()) {
    const [c1, c2] = e.corners;
    for (const [s0, s1] of [
      [0.21, 0.33],
      [0.67, 0.79],
    ]) {
      const lenM = arcMeters(slerp(c1, c2, s0), slerp(c1, c2, s1));
      const group = world.newGroup();
      const steps = Math.ceil(lenM / 1.35);
      const r0 = rng.fork(`ridge${e.a}${e.b}${s0}`);
      for (let k = 0; k <= steps; k++) {
        const d0 = slerp(c1, c2, s0 + ((s1 - s0) * k) / steps);
        const side = normalize(cross(d0, headingTo(d0, c2)));
        const d = travel(d0, side, r0.range(-0.5, 0.5));
        const r = r0.range(1.0, 1.65) * (k === 0 || k === steps ? 0.8 : 1);
        world.tryCircle(
          {
            kind: 'border_rock',
            at: d,
            r,
            height: r0.range(1.6, 3.0),
            sight: true,
            group,
            yaw: r0.range(0, Math.PI * 2),
            variant: r0.int(3),
          },
          { gap: GAP },
        );
      }
    }
  }
}

// The pads: one per crossroads, thrown toward a region heart, plus the ones
// a region adds (ctx.extraPads). A landing must be open ground: the throw
// heading turns a few degrees at a time until it is.
const CROSSROADS_THROWS = [
  // CORNERS order: (+,+,+) (+,+,-) (+,-,+) (+,-,-) (-,+,+) (-,+,-) (-,-,+) (-,-,-)
  2, 5, 0, 3, 4, 2, 1, 5,
];

export function landingOk(world, ctx, d) {
  if (world.terrain.waterSd(d) < 4) return false;
  const frame = tangentFrame(d);
  for (const rr of [0, 1.5, 3, 4.5]) {
    for (let k = 0; k < (rr === 0 ? 1 : 12); k++) {
      const p = polar(d, frame, rr, (k * Math.PI) / 6);
      if (world.terrainBlocked(p) || world.massSd(p, 2) < 0.4) return false;
    }
  }
  if (world.inPlaza(d, 2, ['arena', 'camp', 'landing'])) return false;
  for (const c of world.circles) if (arcMeters(c.at, d) < c.r + 4) return false;
  if (faceEdgeDistance(d, faceOf(d)) < 2 && world.inPlaza(d, 0, ['crossroads'])) return false;
  for (const g of ctx.golden) if (arcMeters(g, d) < 4) return false;
  return true;
}

export function addPads(world, ctx) {
  ctx.pads = [];
  CORNERS.forEach((c, k) => {
    const target = heart(CROSSROADS_THROWS[k]);
    const base = headingTo(c, target);
    const at = travel(c, base, PAD_OFFSET);
    ctx.pads.push(throwFrom(world, ctx, at, headingTo(at, target), `crossroads${k}`));
  });
  for (const extra of ctx.extraPads ?? []) {
    const e = extra.find ? { ...extra, ...extra.find() } : extra;
    ctx.pads.push(throwFrom(world, ctx, e.at, e.heading, e.name, e.fixed));
  }
  for (const pad of ctx.pads) {
    world.addPlaza(pad.at, PAD_RADIUS + 1.5, 'pad', 'pad');
    world.addPlaza(pad.to, 4, 'landing');
  }
}

function throwFrom(world, ctx, at, heading, name, fixed = false) {
  const n = normalize(at);
  const side = normalize(cross(n, heading));
  for (let k = 0; k < 40; k++) {
    const deg = fixed ? 0 : (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 4;
    const a = (deg * Math.PI) / 180;
    const h = normalize(heading.map((x, i) => x * Math.cos(a) + side[i] * Math.sin(a)));
    const to = travel(n, h, THROW_METERS);
    if (landingOk(world, ctx, to)) return { name, at: n, to, heading: h, turned: deg };
    if (fixed) break;
  }
  throw new Error(`pad ${name}: no open landing within 80 degrees of its heading`);
}
