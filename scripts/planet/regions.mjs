// The six regions, one per cube face. Each has two passes: `ground` shapes
// the terrain and reserves what must stay open (the heart, the creature
// arenas, the camps, the golden caches, the ring roads) before the path
// network is drawn; `dress` places what stands on it once the paths, the
// pads and the gates are known.

import { heart, heartFrame, P } from './network.mjs';
import {
  carveField,
  fillSolid,
  scatterBushes,
  scatterDecor,
  scatterMasses,
  scatterSolids,
} from './scatter.mjs';
import {
  arcMeters,
  cross,
  dot,
  faceEdgeDistance,
  faceOf,
  headingTo,
  normalize,
  polar,
  RADIUS,
  slerp,
  tangentFrame,
  travel,
} from './sphere.mjs';
import { ringShape, roundedBox, wobblyDisc, wobblyEllipse } from './terrain.mjs';
import { GAP, ringPoints } from './world.mjs';

const CAMP_KINDS = ['spinecrest', 'brackenlings', 'barkmaw'];
export const CAMP_RADIUS = 7;
const DEG = Math.PI / 180;

function golden(world, ctx, d) {
  ctx.golden.push(d);
  world.addPlaza(d, 1.8, 'golden');
}

function camp(world, ctx, d, face) {
  const kind = CAMP_KINDS[(ctx.camps.length + face) % 3];
  ctx.camps.push({ at: d, kind, face });
  world.addPlaza(d, CAMP_RADIUS + 1.2, 'camp', 'camp');
  world.terrain.addFlat(d, 5, 2.5);
}

function arena(world, ctx, id, d, r) {
  ctx.creatures[id] = { at: d, r };
  world.addPlaza(d, r + 1.2, 'arena', 'arena');
}

// The nearest spot to `target` (spiral search) whose disc of `radius` is
// open terrain inside `face`, clear of masses, footprints and other plazas.
export function findOpenSpot(world, face, target, radius, opts = {}) {
  const frame = tangentFrame(target);
  for (let ring = 0; ring <= (opts.maxRings ?? 14); ring++) {
    const count = ring === 0 ? 1 : ring * 6;
    for (let k = 0; k < count; k++) {
      const d = ring === 0 ? target : polar(target, frame, ring * 2, (2 * Math.PI * k) / count);
      if (faceOf(d) !== face || faceEdgeDistance(d, face) < radius + 2) continue;
      if (spotOpen(world, d, radius, opts)) return d;
    }
  }
  throw new Error(`no open spot of ${radius} m near the target on face ${face}`);
}

export function spotOpen(world, d, radius, opts = {}) {
  if (world.inPlaza(d, radius + (opts.plazaGap ?? 1))) return false;
  if (opts.pathClear !== undefined && world.pathEdgeDistance(d, 30) < opts.pathClear) return false;
  if (world.massSd(d, radius + 4) < radius + 1) return false;
  for (const c of world.circles) if (arcMeters(c.at, d) < radius + c.r + 1) return false;
  const frame = tangentFrame(d);
  for (const rr of [0, radius * 0.35, radius * 0.7, radius + 0.6]) {
    const n = rr === 0 ? 1 : 12;
    for (let k = 0; k < n; k++) {
      const p = polar(d, frame, rr, (2 * Math.PI * k) / n);
      if (world.terrainBusy(p)) return false;
      if (opts.maxSlope !== undefined) {
        const dh = Math.abs(world.terrain.heightAt(p) - world.terrain.heightAt(d));
        if (dh > opts.maxSlope) return false;
      }
    }
  }
  return true;
}

// A plain ring road around a heart.
function ringRoad(world, f, meters, halfWidth, paved = false) {
  world.addPath(ringPoints(heart(f), meters), halfWidth, 'ring', paved);
}

// ---- the Ruins (+X): walls, pillars and corners ---------------------------

const ruins = {
  face: 0,
  ground(world, _rng, ctx) {
    const f = 0;
    const h = heart(f);
    arena(world, ctx, 'pyrefang', h, 9);
    world.terrain.addFlat(h, 10, 4);
    golden(world, ctx, P(f, 14, 22.5));
    golden(world, ctx, P(f, 14, 202.5));
    ctx.ruinsSquares = [
      [33, 11],
      [-11, 33],
      [-33, -11],
    ];
    for (const [x, y] of ctx.ruinsSquares) {
      camp(world, ctx, P(f, Math.hypot(x, y), Math.atan2(y, x) / DEG), f);
    }
    // The street grid, every 22 m along both axes of the heart's frame.
    for (const k of [-66, -44, -22, 22, 44, 66]) {
      for (const axis of [0, 1]) {
        const pts = [];
        for (let s = -70; s <= 70; s += 1) {
          const x = axis === 0 ? k : s;
          const y = axis === 0 ? s : k;
          const d = P(f, Math.hypot(x, y), Math.atan2(y, x) / DEG);
          if (faceOf(d) === f && faceEdgeDistance(d, f) > 3 && arcMeters(d, h) > 12) pts.push(d);
          else if (pts.length > 1) {
            world.addPath(pts.splice(0), 1.8, 'street', true);
          } else pts.length = 0;
        }
        if (pts.length > 1) world.addPath(pts, 1.8, 'street', true);
      }
    }
  },
  dress(world, rng, ctx) {
    const f = 0;
    const h = heart(f);
    // The broken pillar ring around the arena.
    for (let k = 0; k < 8; k++) {
      const tall = rng.next() < 0.6;
      world.tryCircle(
        {
          kind: tall ? 'pillar' : 'pillar_broken',
          at: P(f, 11.9, 22.5 + 45 * k),
          r: 0.75,
          height: tall ? 6.5 : 2.6,
          variant: 1,
          group: world.newGroup(),
        },
        { pathMargin: 0.6, plazaMargin: -1.4 },
      );
    }
    for (let bx = -3; bx < 3; bx++) {
      for (let by = -3; by < 3; by++) {
        const x0 = bx * 22;
        const y0 = by * 22;
        const cx = x0 + 11;
        const cy = y0 + 11;
        if (ctx.ruinsSquares.some(([sx, sy]) => sx === cx && sy === cy)) continue;
        if (Math.hypot(cx, cy) < 20) continue;
        const inset = (c) => (c === 0 ? 4 : 3.3);
        building(
          world,
          rng.fork(`b${bx},${by}`),
          f,
          x0 + inset(x0),
          y0 + inset(y0),
          x0 + 22 - inset(x0 + 22),
          y0 + 22 - inset(y0 + 22),
        );
      }
    }
    // Rubble and overgrowth.
    scatterMasses(world, rng.fork('rubble'), f, {
      kind: 'rubble',
      r: [3, 5.5],
      height: [1.8, 2.8],
      areaTarget: 900,
      attempts: 2500,
      gap: GAP + 0.6,
      shape: (d, r0, s) => roundedBox(d, r0, r0 * s.range(0.6, 1), s.range(0, Math.PI), 4),
    });
    scatterSolids(world, rng.fork('rocks'), f, {
      kind: 'rock',
      target: 40,
      scale: [0.6, 1.3],
      radius: (s) => s,
      height: (s) => s * 1.3,
      sight: (s) => s > 1,
    });
    scatterSolids(world, rng.fork('trees'), f, {
      kind: 'cypress',
      target: 45,
      scale: [0.8, 1.2],
      radius: (s) => 0.45 * s,
      sightR: (s) => 1.1 * s,
      height: (s) => 7 * s,
      where: (d) => (arcMeters(d, h) > 25 ? 1 : 0),
    });
    scatterBushes(world, rng.fork('bushes'), f, {
      target: 32,
      where: (d) => (nearSolid(world, d, 4) ? 1 : 0.15),
    });
    scatterDecor(world, rng.fork('grass'), f, { kind: 'grass', target: 260, scale: [0.7, 1.3] });
    scatterDecor(world, rng.fork('moss'), f, {
      kind: 'pebbles',
      target: 120,
      scale: [0.6, 1.4],
      avoidPaths: false,
    });
  },
};

function nearSolid(world, d, meters) {
  let hit = false;
  world.footHash.query(d, meters + 3, (e, m) => {
    if (m < meters + e.r) hit = true;
  });
  return hit || world.massSd(d, meters + 2) < meters;
}

// One ruined building in the block whose wall centerlines run between
// (x0, y0) and (x1, y1) in the Ruins heart frame (meters).
function building(world, rng, f, x0, y0, x1, y1) {
  const at = (x, y) => P(f, Math.hypot(x, y), Math.atan2(y, x) / DEG);
  const group = world.newGroup();
  const roll = rng.next();
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const sides = [
    [x0, y0, x1, y0],
    [x1, y0, x1, y1],
    [x1, y1, x0, y1],
    [x0, y1, x0, y0],
  ];
  const tallH = () => rng.range(2.6, 4.8);
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  if (roll < 0.3) {
    // A hall still standing: a solid block, its painted facades intact.
    const c = at(cx, cy);
    const fr = tangentFrame(c);
    const ax = headingTo(c, at(cx + 1, cy));
    const angle = Math.atan2(dot(ax, fr[1]), dot(ax, fr[0]));
    const s = roundedBox(c, hw + 0.2, hh + 0.2, angle, 14);
    if (world.canPlaceMass(s, { gap: GAP, pathMargin: 0.6, plazaMargin: 0.8 })) {
      world.addMass(s, 'hall', rng.range(6, 9), {
        region: f,
        box: { a: hw + 0.2, b: hh + 0.2, forward: ax },
      });
    }
    return;
  }
  if (roll < 0.46) {
    // Collapsed: one rubble mound and a standing wall.
    const s = roundedBox(
      at(cx, cy),
      hw * 0.85,
      hh * rng.range(0.65, 0.85),
      rng.range(0, Math.PI),
      5,
    );
    if (world.canPlaceMass(s, { gap: GAP, pathMargin: 0.8 }))
      world.addMass(s, 'rubble', rng.range(2, 3), { region: f });
    return;
  }
  if (roll < 0.54) {
    // A round tower ruin with two walls in an L.
    world.tryCircle(
      { kind: 'tower_ruin', at: at(cx, cy), r: 2.6, height: rng.range(7, 10), group },
      { gap: GAP },
    );
    wallRun(world, rng, at, sides[0], tallH(), group, 0.5, 0);
    wallRun(world, rng, at, sides[3], tallH(), group, 0, 0.5);
    return;
  }
  if (roll < 0.66) {
    // A courtyard: low walls, tall corner pillars, a statue.
    const cornerPts = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    for (const [x, y] of cornerPts) {
      world.tryCircle(
        { kind: 'pillar', at: at(x, y), r: 0.7, height: 5.5, variant: 1, group },
        { gap: GAP },
      );
    }
    const doors = [rng.int(4), (rng.int(3) + 1 + rng.int(4)) % 4];
    sides.forEach((s, k) => {
      const d = doors.includes(k) ? 0.5 : -1;
      wallRun(world, rng, at, s, 1.1, group, 0.12, 0.12, d, 'wall_low');
    });
    world.tryCircle({ kind: 'statue', at: at(cx, cy), r: 1.1, height: 3.2, group }, { gap: GAP });
    return;
  }
  if (roll < 0.76) {
    // A corner: two tall walls in an L and a row of pillars.
    const k = rng.int(4);
    wallRun(world, rng, at, sides[k], tallH() + 0.6, group, 0, 0);
    wallRun(world, rng, at, sides[(k + 1) % 4], tallH() + 0.6, group, 0, 0.35);
    const opp = sides[(k + 2) % 4];
    for (const t of [0.2, 0.55, 0.9]) {
      const x = opp[0] + (opp[2] - opp[0]) * t;
      const y = opp[1] + (opp[3] - opp[1]) * t;
      world.tryCircle(
        {
          kind: rng.next() < 0.5 ? 'pillar' : 'pillar_broken',
          at: at(x, y),
          r: 0.65,
          height: 5,
          variant: 1,
          group,
        },
        { gap: GAP },
      );
    }
    return;
  }
  // A house: four walls, a door in at least two, a collapse here and there.
  const doorSides = new Set([rng.int(4)]);
  while (doorSides.size < 2 + rng.int(2)) doorSides.add(rng.int(4));
  sides.forEach((s, k) => {
    if (rng.next() < 0.08) return;
    const door = doorSides.has(k) ? rng.range(0.3, 0.7) : -1;
    const low = rng.next() < 0.22;
    wallRun(world, rng, at, s, low ? 1.2 : tallH(), group, 0, 0, door, low ? 'wall_low' : 'wall');
  });
  if (rng.next() < 0.55) {
    // A partition across the middle, with its own doorway.
    const horizontal = rng.next() < 0.5;
    const part = horizontal ? [x0, cy, x1, cy] : [cx, y0, cx, y1];
    wallRun(world, rng, at, part, tallH() * 0.85, group, 0, 0, rng.range(0.3, 0.7));
  }
  if (rng.next() < 0.7) {
    world.tryCircle(
      {
        kind: rng.next() < 0.5 ? 'rock' : 'pillar_broken',
        at: at(cx + rng.range(-1.5, 1.5), cy + rng.range(-1.5, 1.5)),
        r: rng.range(0.6, 1),
        height: 1.6,
        variant: 1,
        group,
      },
      { gap: GAP },
    );
  }
}

// A wall from one corner to another (meters in the heart frame), trimmed by
// t0 and t1 at its ends, with a 3.4 m doorway centered at `door` (0..1) if
// door >= 0. Pieces that would reach a path or a plaza are dropped.
function wallRun(world, rng, at, side, height, group, t0, t1, door = -1, kind = 'wall') {
  const [xa, ya, xb, yb] = side;
  const len = Math.hypot(xb - xa, yb - ya);
  const spans = [];
  const s0 = t0 * len;
  const s1 = len - t1 * len;
  if (door >= 0) {
    const dc = Math.max(s0 + 2.4, Math.min(s1 - 2.4, door * len));
    spans.push([s0, dc - 1.7], [dc + 1.7, s1]);
  } else spans.push([s0, s1]);
  for (const [a, b] of spans) {
    // Split into 1 m pieces, keep the runs that fit.
    let runStart = -1;
    const pieces = Math.max(1, Math.round(b - a));
    const step = (b - a) / pieces;
    const flush = (from, to) => {
      if (to - from < 1.4) return;
      const pa = at(xa + ((xb - xa) * from) / len, ya + ((yb - ya) * from) / len);
      const pb = at(xa + ((xb - xa) * to) / len, ya + ((yb - ya) * to) / len);
      const mid = slerp(pa, pb, 0.5);
      world.addBox({
        kind,
        at: mid,
        forward: headingTo(mid, pb),
        length: arcMeters(pa, pb) + 0.45,
        thickness: kind === 'wall_low' ? 0.75 : 0.9,
        height: height * rng.range(0.85, 1.1),
        group,
        variant: rng.int(3),
      });
    };
    for (let k = 0; k <= pieces; k++) {
      const s = a + step * k;
      const p = at(xa + ((xb - xa) * s) / len, ya + ((yb - ya) * s) / len);
      const ok =
        k < pieces &&
        faceEdgeDistance(p, faceOf(p)) > 4 &&
        world.canPlace(p, 0.5, { group, gap: GAP }) &&
        world.canPlace(
          at(xa + ((xb - xa) * (s + step)) / len, ya + ((yb - ya) * (s + step)) / len),
          0.5,
          { group, gap: GAP },
        );
      if (ok && runStart < 0) runStart = s;
      if (!ok && runStart >= 0) {
        flush(runStart, s);
        runStart = -1;
      }
    }
    if (runStart >= 0) flush(runStart, b);
  }
}

// ---- the Cypress groves (-X): dense trees, many bushes ---------------------

const groves = {
  face: 1,
  ground(world, rng, ctx) {
    const f = 1;
    const h = heart(f);
    world.addPlaza(h, 10, 'heart');
    world.terrain.addFlat(h, 10, 5);
    golden(world, ctx, P(f, 5.5, 22.5));
    golden(world, ctx, P(f, 5.5, 202.5));
    for (let k = 0; k < 4; k++)
      camp(world, ctx, findOpenSpot(world, f, P(f, 45, 22.5 + 90 * k), 8.5), f);
    ringRoad(world, f, 31, 1.9);
    wobblyRing(world, rng.fork('outer'), f, 54, 3, 1.8);
  },
  afterPaths(world, rng, _ctx) {
    const f = 1;
    const h = heart(f);
    // Clearings in the deep wood, each joined to the nearest path.
    const cr = rng.fork('clearings');
    for (let k = 0, made = 0; k < 600 && made < 9; k++) {
      const d = polar(h, heartFrame(f), cr.range(18, 66), cr.range(0, Math.PI * 2));
      const r = cr.range(5, 7.5);
      if (world.pathEdgeDistance(d, 14) < r + 2.5 || world.inPlaza(d, r + 7)) continue;
      if (faceEdgeDistance(d, f) < r + 9) continue;
      world.addPlaza(d, r, 'clearing');
      trailToRoad(world, d, r);
      made += 1;
    }
    carveField(world, f, {
      kind: 'deepwood',
      height: 8,
      wMin: 0.4,
      wMax: 2.5,
      noiseMeters: 9,
      edgeFade: 6,
      seed: 0x6a09e667,
    });
  },
  dress(world, rng, ctx) {
    const f = 1;
    const h = heart(f);
    world.addCircle({
      kind: 'elder_cypress',
      at: h,
      r: 1.6,
      height: 17,
      sightR: 3,
      group: world.newGroup(),
    });
    const field = world.fields.find((x) => x.face === f);
    ctx.report.grovesWoodTrees = fillSolid(world, rng.fork('woodfill'), f, (d) => field.sd(d), {
      kind: (s) => (s.next() < 0.1 ? 'cypress_fruit' : s.next() < 0.3 ? 'round_tree' : 'cypress'),
      spacing: 2.5,
      depth: 0.5,
      scale: [0.9, 1.5],
      attempts: 60000,
    });
    fillSolid(world, rng.fork('undergrowth'), f, (d) => field.sd(d), {
      kind: 'undergrowth',
      spacing: 2.2,
      depth: 0.2,
      maxDepth: 1.6,
      scale: [0.8, 1.4],
      attempts: 30000,
    });
    scatterSolids(world, rng.fork('trees'), f, {
      kind: (s) => (s.next() < 0.14 ? 'cypress_fruit' : 'cypress'),
      target: 160,
      attempts: 9000,
      scale: [0.85, 1.35],
      radius: (s) => 0.45 * s,
      sightR: (s) => 1.15 * s,
      height: (s) => 7.5 * s,
      pathMargin: 0.6,
      mergeMass: true,
    });
    scatterBushes(world, rng.fork('bushes'), f, { target: 54, r: [1.5, 3.2], attempts: 60000 });
    scatterDecor(world, rng.fork('ferns'), f, { kind: 'fern', target: 360, scale: [0.7, 1.4] });
    scatterDecor(world, rng.fork('mush'), f, {
      kind: 'flowers',
      target: 60,
      scale: [0.6, 1.0],
      variants: 2,
    });
  },
};

// A closed ring trail at `meters` from the heart, wobbling sideways.
function wobblyRing(world, rng, f, meters, amp, halfWidth) {
  const h = heart(f);
  const frame = heartFrame(f);
  const p1 = rng.range(0, 6.28);
  const p2 = rng.range(0, 6.28);
  const pts = [];
  const steps = Math.ceil(2 * Math.PI * meters);
  for (let s = 0; s <= steps; s++) {
    const th = (2 * Math.PI * s) / steps;
    const r = meters + amp * (0.6 * Math.sin(5 * th + p1) + 0.4 * Math.sin(9 * th + p2));
    pts.push(polar(h, frame, r, th));
  }
  // Keep only the stretches inside the face, well off its edges.
  let run = [];
  for (const d of pts) {
    if (faceOf(d) === f && faceEdgeDistance(d, f) > halfWidth + 6) run.push(d);
    else {
      if (run.length > 8) world.addPath(run, halfWidth, 'trail');
      run = [];
    }
  }
  if (run.length > 8) world.addPath(run, halfWidth, 'trail');
}

// A short trail from a clearing's rim to the nearest path.
function trailToRoad(world, d, r) {
  const near = world.nearestPath(d, 40);
  if (!near) return;
  let best = near.path.points[0];
  for (const q of near.path.points) if (arcMeters(q, d) < arcMeters(best, d)) best = q;
  const from = travel(d, headingTo(d, best), Math.max(0, r - 1));
  const n = Math.max(2, Math.ceil(arcMeters(from, best)));
  const pts = [];
  for (let k = 0; k <= n; k++) pts.push(slerp(from, best, k / n));
  world.addPath(pts, 1.8, 'trail');
}

// ---- the Sanctuary (+Y): the hot drop around the spire --------------------

const sanctuary = {
  face: 2,
  ground(world, _rng, ctx) {
    const f = 2;
    const h = heart(f);
    world.addCircle({ kind: 'spire', at: h, r: 4, height: 34, group: world.newGroup() });
    world.addPlaza(h, 15, 'heart', 'sanctuary');
    world.terrain.addFlat(h, 15, 6);
    for (let k = 0; k < 6; k++) golden(world, ctx, P(f, 7.6, 52.5 + 60 * k));
    arena(world, ctx, 'warden', P(f, 19, 22.5), 10);
    ringRoad(world, f, 38, 2.0, true);
    for (const b of [67.5, 157.5, 247.5])
      camp(world, ctx, findOpenSpot(world, f, P(f, 56, b), 8.5), f);
  },
  afterPaths(world, _rng, _ctx) {
    const f = 2;
    const h = heart(f);
    carveField(world, f, {
      kind: 'deepwood',
      height: 7,
      wMin: 3.4,
      wMax: 7,
      noiseMeters: 12,
      edgeFade: 7,
      seed: 0x3c6ef372,
      extraOpen: (d) => Math.max(0, arcMeters(d, h) - 44),
    });
  },
  dress(world, rng, _ctx) {
    const f = 2;
    const h = heart(f);
    // The colonnade.
    for (let k = 0; k < 40; k++) {
      world.tryCircle(
        { kind: 'pillar', at: P(f, 30, 9 * k + 4.5), r: 0.7, height: 6.5, group: world.newGroup() },
        { pathMargin: 0.8, plazaMargin: 0.4 },
      );
    }
    // Four shrines facing the spire.
    for (let k = 0; k < 4; k++) shrine(world, rng.fork(`shrine${k}`), P(f, 47, 22.5 + 90 * k), h);
    // Formal hedges between the roads, tangential to the rings.
    const hr = rng.fork('hedges');
    for (let k = 0; k < 8; k++) {
      for (const dist of [23.5, 43.5]) {
        if (dist > 30 && k % 2 === 0) continue;
        const bearing = 45 * k + 22.5 + hr.range(-3, 3);
        const c = P(f, dist, bearing);
        const tangent = normalize(cross(c, headingTo(c, h)));
        const frame = tangentFrame(c);
        const angle = Math.atan2(dot(tangent, frame[1]), dot(tangent, frame[0]));
        const s = roundedBox(c, dist < 30 ? 4.4 : 6, dist < 30 ? 1.4 : 1.5, angle, 6);
        if (world.canPlaceMass(s, { gap: GAP, pathMargin: 1.1, ignoreFields: true }))
          world.addMass(s, 'hedge', 1.9, { region: f });
      }
    }
    // Cypress alleys along the eight roads.
    for (let k = 0; k < 8; k++) {
      const bearing = 45 * k;
      for (let s = 18; s <= 60; s += 7) {
        const p = P(f, s, bearing);
        const side = normalize(cross(p, headingTo(p, h)));
        for (const sgn of [-1, 1]) {
          const t = travel(p, side, sgn * 4.7);
          world.tryCircle(
            { kind: 'cypress', at: t, r: 0.45, height: 8, sightR: 1.1, scale: 1.05, group: 0 },
            { pathMargin: 0.4 },
          );
        }
      }
    }
    // Braziers at the plaza's rim, obelisks further out.
    for (let k = 0; k < 8; k++) {
      world.tryCircle(
        { kind: 'brazier', at: P(f, 16.6, 22.5 + 45 * k), r: 0.55, height: 1.7, sight: false },
        { pathMargin: 0.5, plazaMargin: -1.2 },
      );
    }
    const woods = world.fields.find((x) => x.face === f);
    fillSolid(world, rng.fork('woodfill'), f, (d) => woods.sd(d), {
      kind: (s) => (s.next() < 0.25 ? 'round_tree' : 'cypress'),
      spacing: 2.6,
      depth: 0.5,
      scale: [0.9, 1.4],
      attempts: 30000,
    });
    fillSolid(world, rng.fork('undergrowth'), f, (d) => woods.sd(d), {
      kind: 'undergrowth',
      spacing: 2.3,
      depth: 0.2,
      maxDepth: 1.5,
      scale: [0.8, 1.3],
      attempts: 15000,
    });
    scatterMasses(world, rng.fork('massifs'), f, {
      kind: 'massif',
      r: [3, 6],
      height: [2.5, 4.5],
      areaTarget: 1000,
      gap: GAP + 1,
      where: (d) => (arcMeters(d, h) > 60 ? 1 : 0),
    });
    scatterSolids(world, rng.fork('trees'), f, {
      kind: 'cypress',
      target: 50,
      scale: [0.9, 1.3],
      radius: (s) => 0.45 * s,
      sightR: (s) => 1.1 * s,
      height: (s) => 7.5 * s,
      where: (d) => (arcMeters(d, h) > 40 ? 1 : 0),
    });
    scatterSolids(world, rng.fork('rocks'), f, {
      kind: 'rock',
      target: 30,
      scale: [0.6, 1.2],
      radius: (s) => s,
      height: (s) => s * 1.2,
      sight: (s) => s > 1,
      where: (d) => (arcMeters(d, h) > 45 ? 1 : 0),
    });
    for (let k = 0; k < 8; k++) {
      const p = P(f, 15.8, 45 * k);
      const side = normalize(cross(p, headingTo(p, h)));
      for (const sgn of [-1, 1]) {
        const at = travel(p, side, sgn * 3.3);
        if (!world.inPlaza(at, 1, ['arena'])) world.addDecor('banner', at, 1, 0, k % 2);
      }
    }
    scatterBushes(world, rng.fork('bushes'), f, {
      target: 26,
      where: (d) => (arcMeters(d, h) > 20 ? 1 : 0),
    });
    scatterDecor(world, rng.fork('flowers'), f, {
      kind: 'flowers',
      target: 220,
      scale: [0.7, 1.2],
      where: (d) => (arcMeters(d, h) > 17 ? 1 : 0),
    });
    scatterDecor(world, rng.fork('grass'), f, { kind: 'grass', target: 160, scale: [0.6, 1.0] });
  },
};

// A small temple: four columns, two side columns, a back wall, open to the
// spire, its floor a paved plaza.
function shrine(world, _rng, c, toward) {
  const fwd = headingTo(c, toward);
  const side = normalize(cross(c, fwd));
  const group = world.newGroup();
  const at = (x, y) => travel(travel(c, side, x), fwd, y);
  world.addPlaza(c, 4.6, 'shrine', 'sanctuary');
  for (const [x, y] of [
    [-3.4, 3.4],
    [3.4, 3.4],
    [-3.4, -3.4],
    [3.4, -3.4],
  ]) {
    world.addCircle({ kind: 'pillar', at: at(x, y), r: 0.65, height: 5.4, group, prop: false });
  }
  world.addBox({
    kind: 'wall',
    at: at(0, -3.4),
    forward: side,
    length: 7.4,
    thickness: 0.9,
    height: 4.2,
    group,
    prop: false,
  });
  world.special.shrines = world.special.shrines ?? [];
  world.special.shrines.push({ at: c, forward: fwd });
}

// ---- the Open ground (-Y): sparse cover around the monolith ----------------

const open = {
  face: 3,
  ground(world, _rng, ctx) {
    const f = 3;
    const h = heart(f);
    world.addCircle({ kind: 'monolith', at: h, r: 4, height: 15, group: world.newGroup() });
    world.addPlaza(h, 9, 'heart');
    world.terrain.addFlat(h, 9, 5);
    golden(world, ctx, P(f, 7, 22.5));
    golden(world, ctx, P(f, 7, 202.5));
    for (let k = 0; k < 4; k++)
      camp(world, ctx, findOpenSpot(world, f, P(f, 46, 22.5 + 90 * k), 8.5, { maxSlope: 0.8 }), f);
  },
  dress(world, rng, _ctx) {
    const f = 3;
    const h = heart(f);
    for (let k = 0; k < 8; k++) {
      world.tryCircle(
        {
          kind: 'menhir',
          at: P(f, 12.5, 22.5 + 45 * k),
          r: 0.75,
          height: 4.6,
          group: world.newGroup(),
          yaw: k,
        },
        { plazaMargin: -4, pathMargin: 0.6 },
      );
    }
    scatterMasses(world, rng.fork('massifs'), f, {
      kind: 'massif',
      r: [4, 11],
      height: [3, 7],
      areaTarget: 4200,
      attempts: 12000,
      gap: 4,
      where: (d) => (arcMeters(d, h) > 18 ? 1 : 0),
    });
    scatterSolids(world, rng.fork('boulders'), f, {
      kind: 'boulder',
      target: 26,
      scale: [1.5, 2.6],
      radius: (s) => s,
      height: (s) => s * 1.1,
    });
    scatterSolids(world, rng.fork('rocks'), f, {
      kind: 'rock',
      target: 60,
      scale: [0.6, 1.3],
      radius: (s) => s,
      height: (s) => s * 1.2,
      sight: (s) => s > 1,
    });
    scatterSolids(world, rng.fork('trees'), f, {
      kind: (s) => (s.next() < 0.7 ? 'round_tree' : 'cypress'),
      target: 34,
      scale: [0.8, 1.3],
      radius: (s) => 0.5 * s,
      sightR: (s) => 1.4 * s,
      height: (s) => 6 * s,
    });
    scatterBushes(world, rng.fork('bushes'), f, { target: 20 });
    scatterDecor(world, rng.fork('grass'), f, {
      kind: 'tallgrass',
      target: 520,
      scale: [0.7, 1.4],
    });
    scatterDecor(world, rng.fork('flowers'), f, { kind: 'flowers', target: 70, scale: [0.6, 1.0] });
  },
};

// ---- the Lakes (+Z): water, bridges and isthmuses -------------------------

const lakes = {
  face: 4,
  ground(world, rng, ctx) {
    const f = 4;
    const h = heart(f);
    const t = world.terrain;
    const r = rng.fork('lakes');
    t.addLake(
      ringShape(
        h,
        12.5,
        23.5,
        [
          { bearing: 0, halfWidth: 2.9 },
          { bearing: Math.PI, halfWidth: 2.9 },
        ],
        r,
      ),
    );
    const across = (c, toward) => {
      const hd = headingTo(c, toward);
      const fr = tangentFrame(c);
      return Math.atan2(dot(hd, fr[1]), dot(hd, fr[0])) + Math.PI / 2;
    };
    for (const b of [45, 225]) {
      const c = P(f, 47, b);
      t.addLake(wobblyEllipse(c, 14, 6.2, across(c, h), r, 0.07));
    }
    for (const b of [135, 315]) {
      const c = P(f, 49, b);
      const side = normalize(cross(c, headingTo(c, h)));
      for (const sgn of [-1, 1]) t.addLake(wobblyDisc(travel(c, side, sgn * 11.8), 7.6, r, 0.1));
    }
    // Ponds in the open sectors.
    for (const [dist, b, rr] of [
      [40, 0 + 22, 3.6],
      [44, 180 - 20, 4.2],
      [52, 270 + 18, 3.4],
      [38, 90 + 24, 3.2],
    ]) {
      t.addLake(wobblyDisc(P(f, dist, b), rr, r, 0.12));
    }
    world.addPlaza(h, 8.5, 'heart', 'lakes');
    t.addFlat(h, 8.5, 2.2);
    golden(world, ctx, P(f, 5, 45));
    golden(world, ctx, P(f, 5, 225));
    ringRoad(world, f, 29, 2.0);
    for (const b of [22.5, 112.5, 247.5])
      camp(world, ctx, findOpenSpot(world, f, P(f, 40, b), 8.5), f);
    // The pad across the lakes: on the outer shore, thrown over the ring
    // lake onto the island; its spot is kept open before the woods grow.
    let padAt = null;
    for (let k = 0; k < 40 && !padAt; k++) {
      const b = 292.5 + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 2.5;
      const at = P(f, 55, b);
      if (spotOpen(world, at, 2.8, { plazaGap: 0.5 })) padAt = at;
    }
    if (!padAt) throw new Error('no shore for the lakes pad');
    world.addPlaza(padAt, 3.2, 'padsite');
    ctx.extraPads.push({ name: 'lakes', fixed: true, at: padAt, heading: headingTo(padAt, h) });
  },
  afterPaths(world, _rng, _ctx) {
    const f = 4;
    const t = world.terrain;
    carveField(world, f, {
      kind: 'deepwood',
      height: 7,
      wMin: 1.8,
      wMax: 5,
      noiseMeters: 12,
      edgeFade: 7,
      seed: 0xa54ff53a,
      extraOpen: (d) => Math.max(0, t.waterSd(d) - 3.5),
    });
  },
  dress(world, rng, _ctx) {
    const f = 4;
    const _h = heart(f);
    scatterSolids(world, rng.fork('trees'), f, {
      kind: (s) => (s.next() < 0.5 ? 'round_tree' : 'cypress'),
      target: 90,
      scale: [0.8, 1.3],
      radius: (s) => 0.5 * s,
      sightR: (s) => 1.3 * s,
      height: (s) => 6.5 * s,
    });
    scatterSolids(world, rng.fork('rocks'), f, {
      kind: 'rock',
      target: 40,
      scale: [0.6, 1.3],
      radius: (s) => s,
      height: (s) => s * 1.1,
      sight: (s) => s > 1,
    });
    const woods = world.fields.find((x) => x.face === f);
    fillSolid(world, rng.fork('woodfill'), f, (d) => woods.sd(d), {
      kind: (s) => (s.next() < 0.5 ? 'round_tree' : 'cypress'),
      spacing: 2.6,
      depth: 0.5,
      scale: [0.9, 1.4],
      attempts: 30000,
    });
    fillSolid(world, rng.fork('undergrowth'), f, (d) => woods.sd(d), {
      kind: 'undergrowth',
      spacing: 2.3,
      depth: 0.2,
      maxDepth: 1.5,
      scale: [0.8, 1.3],
      attempts: 15000,
    });
    scatterBushes(world, rng.fork('bushes'), f, {
      target: 24,
      where: (d) => (world.terrain.waterSd(d) < 7 ? 1 : 0.25),
    });
    scatterDecor(world, rng.fork('reeds'), f, {
      kind: 'reeds',
      target: 260,
      scale: [0.7, 1.3],
      where: (d) => {
        const s = world.terrain.waterSd(d);
        return s > 0.4 && s < 2.6 ? 1 : 0;
      },
      test: (d) =>
        world.pathEdgeDistance(d, 4) > 0.3 && !world.inPlaza(d, 0.3) && !world.terrainBusy(d),
    });
    scatterDecor(world, rng.fork('lilies'), f, {
      kind: 'lily',
      target: 90,
      scale: [0.7, 1.3],
      where: (d) => (world.terrain.waterSd(d) < -1.5 ? 1 : 0),
      test: (d) => world.terrain.waterSd(d) < -1.5,
    });
    scatterDecor(world, rng.fork('grass'), f, { kind: 'grass', target: 260, scale: [0.7, 1.2] });
    scatterDecor(world, rng.fork('flowers'), f, { kind: 'flowers', target: 90, scale: [0.6, 1.0] });
  },
};

// ---- the Cliffs (-Z): plateaus, cliff walls, ramps ------------------------

const cliffs = {
  face: 5,
  ground(world, rng, ctx) {
    const f = 5;
    const h = heart(f);
    const t = world.terrain;
    const r = rng.fork('plateaus');
    const mesa = t.addPlateau(wobblyDisc(h, 14.5, r, 0.05), 2.6);
    for (const b of [30, 150, 270]) addRampAt(world, mesa, b * DEG, heartFrame(f));
    arena(world, ctx, 'voidmaul', h, 9);
    t.addFlat(h, 9.5, 1.5);
    golden(world, ctx, P(f, 11.3, 90));
    golden(world, ctx, P(f, 11.3, 210));
    ringRoad(world, f, 21.5, 2.0);
    const tops = [3.2, 3.6, 4.0, 3.4];
    ctx.cliffPlateaus = [];
    for (let k = 0; k < 4; k++) {
      const c = P(f, 44, 22.5 + 90 * k);
      const p = t.addPlateau(wobblyDisc(c, 11, r, 0.09), tops[k]);
      ctx.cliffPlateaus.push(p);
    }
    // Camps on two plateaus, the third on low ground.
    camp(world, ctx, ctx.cliffPlateaus[0].shape.center, f);
    camp(world, ctx, ctx.cliffPlateaus[1].shape.center, f);
    camp(world, ctx, findOpenSpot(world, f, P(f, 34, 315), 8.5, { maxSlope: 0.8 }), f);
    ctx.cliffsPadTop = ctx.cliffPlateaus[2].shape.center;
  },
  // Ramps are placed once the paths exist, toward the nearest road.
  afterPaths(world, _rng, ctx) {
    for (const p of ctx.cliffPlateaus) {
      const c = p.shape.center;
      const frame = p.shape.frame;
      const scored = [];
      for (let b = 0; b < 360; b += 10) {
        const foot = polar(c, frame, p.shape.radiusAt(b * DEG) + 6, b * DEG);
        if (world.terrainBusy(foot) || faceOf(foot) !== 5) continue;
        const edge = world.pathEdgeDistance(foot, 25);
        scored.push({ b, edge });
      }
      scored.sort((x, y) => x.edge - y.edge || x.b - y.b);
      const chosen = [];
      for (const s of scored) {
        if (chosen.every((c0) => Math.abs(((s.b - c0.b + 540) % 360) - 180) > 100)) chosen.push(s);
        if (chosen.length === 2) break;
      }
      for (const s of chosen) {
        const ramp = addRampAt(world, p, s.b * DEG, frame);
        // A short trail from the ramp's foot to the road.
        const foot = ramp.a;
        const near = world.nearestPath(foot, 30);
        if (near && near.edge > 0.5) {
          let best = near.path.points[0];
          for (const q of near.path.points)
            if (arcMeters(q, foot) < arcMeters(best, foot)) best = q;
          const pts = [];
          const n = Math.max(2, Math.ceil(arcMeters(foot, best)));
          for (let k = 0; k <= n; k++) pts.push(slerp(foot, best, k / n));
          world.addPath(pts, 1.9, 'trail', false);
        }
      }
    }
    // The pad up the cliffs lands on the highest plateau; its foot is kept
    // open before the crags are carved.
    const pad = padOntoPlateau(world, 5, ctx.cliffsPadTop, heart(5));
    world.addPlaza(pad.at, 3.6, 'padsite');
    ctx.extraPads.push(pad);
    const t = world.terrain;
    const plateaus = t.plateaus.filter((p) => faceOf(p.shape.center) === 5);
    carveField(world, 5, {
      kind: 'crag',
      height: 9,
      wMin: 1.8,
      wMax: 4.6,
      noiseMeters: 13,
      edgeFade: 7,
      seed: 0x510e527f,
      extraOpen: (d) => {
        let best = 1e9;
        for (const p of plateaus) best = Math.min(best, Math.max(0, p.shape.sd(d) - 4.5));
        for (const r of t.ramps) {
          if (dot(d, r.m) < Math.cos((r.length + 12) / RADIUS)) continue;
          const [along, lat] = t.rampLocal(r, d);
          const out = Math.max(Math.abs(along) - r.length / 2, Math.abs(lat) - r.width / 2, 0);
          best = Math.min(best, Math.max(0, out - 2.5));
        }
        return best;
      },
    });
  },
  dress(world, rng, _ctx) {
    const f = 5;
    const h = heart(f);
    const crags = world.fields.find((x) => x.face === f);
    fillSolid(world, rng.fork('cragrocks'), f, (d) => crags.sd(d), {
      kind: 'rock',
      spacing: 3.2,
      depth: 0.3,
      maxDepth: 1.6,
      scale: [1.0, 2.2],
      attempts: 20000,
    });
    scatterSolids(world, rng.fork('rocks'), f, {
      kind: 'rock',
      target: 60,
      scale: [0.6, 1.4],
      radius: (s) => s,
      height: (s) => s * 1.3,
      sight: (s) => s > 1,
    });
    scatterSolids(world, rng.fork('trees'), f, {
      kind: 'cypress',
      target: 40,
      scale: [0.8, 1.2],
      radius: (s) => 0.45 * s,
      sightR: (s) => 1.1 * s,
      height: (s) => 7 * s,
    });
    scatterBushes(world, rng.fork('bushes'), f, { target: 20 });
    scatterDecor(world, rng.fork('grass'), f, { kind: 'grass', target: 220, scale: [0.6, 1.1] });
    scatterDecor(world, rng.fork('pebbles'), f, {
      kind: 'pebbles',
      target: 120,
      scale: [0.6, 1.4],
      avoidPaths: false,
    });
    void h;
  },
};

function addRampAt(world, plateau, bearing, frame) {
  const c = plateau.shape.center;
  const rim = plateau.shape.radiusAt(
    Math.atan2(
      dot(polar(c, frame, 1, bearing), plateau.shape.frame[1]),
      dot(polar(c, frame, 1, bearing), plateau.shape.frame[0]),
    ),
  );
  const a = polar(c, frame, rim + 5.5, bearing);
  const b = polar(c, frame, rim - 4.5, bearing);
  const ramp = world.terrain.addRamp(a, b, 4.6, plateau);
  world.special.ramps.push(ramp);
  return ramp;
}

function padOntoPlateau(world, f, landing, h) {
  const frame = tangentFrame(landing);
  let best = null;
  for (let b = 0; b < 360; b += 3) {
    const at = polar(landing, frame, 50, b * DEG);
    if (faceOf(at) !== f || faceEdgeDistance(at, f) < 6) continue;
    if (!spotOpen(world, at, 3.5)) continue;
    if (world.terrain.heightAt(at) > 1.6) continue;
    const score = arcMeters(at, h);
    if (!best || score < best.score) best = { at, score };
  }
  if (!best) throw new Error('no foot for the cliffs pad');
  return { name: 'cliffs', at: best.at, heading: headingTo(best.at, landing), fixed: true };
}

export const REGION_DESIGNS = [ruins, groves, sanctuary, open, lakes, cliffs];
