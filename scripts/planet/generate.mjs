// The planet's layout generator (docs/planet.md): one fixed seed, one
// deterministic pass, the single source of the battle royale planet.
//
//   node scripts/planet/generate.mjs [--debug <dir>]
//
// writes public/map/planet/navigation.bin and layout.json (what the sim
// reads) and art_src/planet/scene.json (what scripts/planet/build_planet.py
// dresses in Blender). The navigation grid is derived from the same
// placements the scene lists, never the other way round. With --debug it
// also writes a map of the six faces as a PNG.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keepLargest, openWalkable } from './analysis.mjs';
import { keepBushes, placeCaches, sightBlockers, validate } from './gameplay.mjs';
import {
  addBorderRidges,
  addCrossroads,
  addGates,
  addPads,
  addPaths,
  heart,
  REGIONS,
} from './network.mjs';
import { BLOCKED_VALUE, debugMap, navigationBuffer, packBase64 } from './output.mjs';
import { Stream } from './random.mjs';
import { BLOCK, Grid, PAINT_CHANNELS, paint, rasterize } from './raster.mjs';
import { REGION_DESIGNS } from './regions.mjs';
import {
  arcMeters,
  CELLS_PER_FACE,
  cross,
  dot,
  faceDir,
  headingTo,
  normalize,
  RADIUS,
  round6,
  slerp,
  tangentFrame,
  toPoint,
} from './sphere.mjs';
import { REGION_SHARPNESS, Terrain, WATER_LEVEL } from './terrain.mjs';
import { World } from './world.mjs';

export const SEED = 0x50_1a_4e_7;
export const MESH_CELLS_PER_FACE = 160;
const POLE_RADIUS = 4;
const BRIDGE_WIDTH = 3.8;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Every stretch of path over water becomes a bridge, from firm ground to
// firm ground, straight along the great circle.
function addBridges(world) {
  const t = world.terrain;
  for (const p of world.paths) {
    const pts = p.points;
    const wet = pts.map((d) => t.waterSd(d) < 0.3);
    for (let i = 0; i < pts.length; i++) {
      if (!wet[i]) continue;
      let j = i;
      while (j + 1 < pts.length && wet[j + 1]) j++;
      let a = i;
      while (a > 0 && t.waterSd(pts[a]) < 1.8) a--;
      let b = j;
      while (b < pts.length - 1 && t.waterSd(pts[b]) < 1.8) b++;
      const A = pts[a];
      const B = pts[b];
      const mid = slerp(A, B, 0.5);
      const e = headingTo(mid, B);
      world.special.bridges.push({
        a: A,
        b: B,
        mid,
        e,
        q: normalize(cross(mid, e)),
        length: arcMeters(A, B),
        width: BRIDGE_WIDTH,
        h0: t.heightAt(A),
        h1: t.heightAt(B),
        arch: 0.45,
      });
      i = b;
    }
  }
}

// Loose rocks along the rims of the rock masses and rubble heaps, so the
// raised ground reads as stone from above (dressing only: inside the mass).
function dressMasses(world, rng) {
  for (const m of world.masses) {
    if (!['massif', 'rubble', 'crag'].includes(m.kind)) continue;
    const rim = m.shape.outline(2.4);
    for (const d of rim) {
      if (rng.next() < 0.25) continue;
      const toward = headingTo(d, m.shape.center);
      const inside = slerp(d, m.shape.center, Math.min(0.5, 0.7 / Math.max(1, m.shape.r0)));
      world.addDecor(
        m.kind === 'rubble' ? 'rubble_stone' : 'rock',
        inside,
        rng.range(0.8, 1.7),
        rng.range(0, 6.283),
        rng.int(3),
        { inMass: true, toward },
      );
    }
  }
}

function pt(d, extra = {}) {
  return { ...toPoint(d), ...extra };
}

const r3 = (x) => Math.round(x * 1000) / 1000;

function yawForward(d, yaw) {
  const [e1, e2] = tangentFrame(d);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s];
}

function forwardYaw(d, fwd) {
  const [e1, e2] = tangentFrame(d);
  return Math.atan2(dot(fwd, e2), dot(fwd, e1));
}

export function generate() {
  const started = performance.now();
  const rng = new Stream(SEED);
  const terrain = new Terrain(SEED ^ 0x2545f491);
  const grid = new Grid(CELLS_PER_FACE);
  const world = new World(terrain, grid);
  const ctx = { golden: [], camps: [], creatures: {}, extraPads: [], report: {} };

  addCrossroads(world, ctx);
  for (const r of REGION_DESIGNS) r.ground(world, rng.fork(`ground${r.face}`), ctx);
  addPaths(world, rng.fork('paths'), ctx);
  for (const r of REGION_DESIGNS) r.afterPaths?.(world, rng.fork(`after${r.face}`), ctx);
  addBridges(world);
  addPads(world, ctx);
  addGates(world);
  addBorderRidges(world, rng.fork('ridges'));
  for (const r of REGION_DESIGNS) r.dress(world, rng.fork(`dress${r.face}`), ctx);
  dressMasses(world, rng.fork('massrims'));
  const planned = performance.now();

  rasterize(grid, world);
  const opening = openWalkable(grid);
  const comps = keepLargest(grid);
  const bushes = keepBushes(grid, world, ctx);
  const caches = placeCaches(grid, world, ctx, rng.fork('caches'));
  const problems = validate(grid, ctx, caches, bushes);
  const blockers = sightBlockers(world, rng.fork('sight'));
  const paintBytes = paint(grid, world);
  const rastered = performance.now();

  // ---- the sim's records -------------------------------------------------
  const layout = {
    version: 1,
    radius: RADIUS,
    cellsPerFace: CELLS_PER_FACE,
    heightScale: 0.001,
    blockedValue: BLOCKED_VALUE,
    seed: SEED,
    waterLevel: WATER_LEVEL,
    regions: REGIONS.map((r) => ({
      id: r.id,
      name: r.name,
      face: r.face,
      heart: pt(heart(r.face)),
    })),
    poles: {
      north: pt([0, 1, 0], { r: POLE_RADIUS }),
      south: pt([0, -1, 0], { r: POLE_RADIUS }),
    },
    crossroads: ctx.crossroads.map((c) => pt(c)),
    pads: ctx.pads.map((p) => ({ at: pt(p.at), to: pt(p.to) })),
    caches: caches.map((c) => ({ at: pt(c.at), golden: c.golden })),
    camps: ctx.camps.map((c) => ({ at: pt(c.at), kind: c.kind })),
    creatures: Object.fromEntries(
      ['warden', 'pyrefang', 'voidmaul'].map((id) => [
        id,
        { at: pt(ctx.creatures[id].at), r: ctx.creatures[id].r },
      ]),
    ),
    bushes: bushes.map((b) => ({ at: pt(b.at), r: r3(b.r) })),
    sightBlockers: blockers.map((b) => ({ at: pt(b.at), r: r3(b.r) })),
  };

  // ---- what Blender dresses ---------------------------------------------
  const M = MESH_CELLS_PER_FACE;
  const vertHeights = new Int16Array(6 * (M + 1) * (M + 1));
  for (let f = 0; f < 6; f++) {
    for (let b = 0; b <= M; b++) {
      for (let a = 0; a <= M; a++) {
        const d = faceDir(f, (2 * a) / M - 1, (2 * b) / M - 1);
        vertHeights[f * (M + 1) * (M + 1) + b * (M + 1) + a] = Math.round(
          terrain.heightAt(d) * 1000,
        );
      }
    }
  }
  const ground = (d) => r3(terrain.heightAt(d));
  const unit = (v) => ({ x: round6(v[0]), y: round6(v[1]), z: round6(v[2]) });
  const props = [];
  for (const c of world.circles) {
    if (c.prop === false) continue;
    props.push({
      kind: c.kind,
      at: pt(c.at),
      h: ground(c.at),
      r: r3(c.r),
      height: r3(c.height),
      scale: r3(c.scale),
      yaw: r3(c.yaw),
      forward: unit(yawForward(c.at, c.yaw)),
      variant: c.variant,
      blocks: true,
    });
  }
  for (const d of world.decor) {
    props.push({
      kind: d.kind,
      at: pt(d.at),
      h: ground(d.at),
      scale: r3(d.scale),
      yaw: r3(d.yaw),
      forward: unit(yawForward(d.at, d.yaw)),
      variant: d.variant,
      blocks: false,
    });
  }

  const scene = {
    version: 1,
    seed: SEED,
    radius: RADIUS,
    waterLevel: WATER_LEVEL,
    axes: 'three.js world axes, y up; Blender takes (x, -z, y) and its glTF export gives them back',
    regionBlend: { sharpness: REGION_SHARPNESS, faces: REGIONS.map((r) => r.id) },
    terrain: {
      meshCellsPerFace: M,
      heightScale: 0.001,
      order:
        'face, then row b along V, then column a along U; vertex (f, a, b) at u = 2a/M - 1, v = 2b/M - 1',
      encoding: 'int16le, zlib, base64',
      heights: packBase64(vertHeights),
    },
    paint: {
      cellsPerFace: CELLS_PER_FACE,
      channels: PAINT_CHANNELS,
      order: 'cell index order (f * n * n + j * n + i), channels interleaved',
      encoding: 'uint8, zlib, base64',
      data: packBase64(paintBytes),
    },
    props,
    walls: world.boxes.map((b) => ({
      kind: b.kind,
      at: pt(b.at),
      h: ground(b.at),
      forward: unit(b.forward),
      length: r3(b.length),
      thickness: r3(b.thickness),
      height: r3(b.height),
      variant: b.variant,
    })),
    masses: world.masses.map((m) => ({
      kind: m.kind,
      center: pt(m.shape.center),
      h: ground(m.shape.center),
      height: r3(m.height),
      radius: r3(m.shape.r0),
      box: m.box ? { a: r3(m.box.a), b: r3(m.box.b), forward: unit(m.box.forward) } : undefined,
      outline: m.shape.outline(1.2).map((d) => pt(d, { h: ground(d) })),
    })),
    cliffs: terrain.plateaus.map((p) => ({
      top: p.top,
      band: p.band,
      center: pt(p.shape.center),
      outline: p.shape.outline(1.0).map((d) => pt(d, { h: ground(d) })),
    })),
    ramps: terrain.ramps.map((r) => ({
      a: pt(r.a),
      b: pt(r.b),
      width: r.width,
      bottom: r3(r.bottom),
      top: r3(r.top),
    })),
    bridges: world.special.bridges.map((b) => ({
      a: pt(b.a),
      b: pt(b.b),
      width: b.width,
      h0: r3(b.h0),
      h1: r3(b.h1),
      arch: b.arch,
      length: r3(b.length),
    })),
    water: {
      level: WATER_LEVEL,
      note: 'flat caps at radius + level over every terrain vertex below the level',
    },
    gates: world.special.gates.map((g) => ({
      at: pt(g.at),
      h: ground(g.at),
      forward: unit(g.forward),
      span: g.span,
    })),
    shrines: (world.special.shrines ?? []).map((s) => ({
      at: pt(s.at),
      h: ground(s.at),
      forward: unit(s.forward),
    })),
    pads: ctx.pads.map((p) => ({
      at: pt(p.at),
      h: ground(p.at),
      to: pt(p.to),
      forward: unit(p.heading),
      yaw: r3(forwardYaw(p.at, p.heading)),
    })),
    crossroads: ctx.crossroads.map((c) => pt(c, { h: ground(c) })),
    caches: caches.map((c) => ({ at: pt(c.at), h: ground(c.at), golden: c.golden })),
    camps: ctx.camps.map((c) => ({ at: pt(c.at), h: ground(c.at), kind: c.kind })),
    arenas: Object.entries(ctx.creatures).map(([id, a]) => ({
      id,
      at: pt(a.at),
      h: ground(a.at),
      r: a.r,
    })),
    bushes: bushes.map((b) => ({ at: pt(b.at), h: ground(b.at), r: r3(b.r), variant: b.variant })),
    plazas: world.plazas
      .filter((p) => p.paving !== 'none')
      .map((p) => ({ kind: p.kind, paving: p.paving, at: pt(p.at), h: ground(p.at), r: p.r })),
  };

  // ---- the report ----------------------------------------------------------
  let walkCells = 0;
  let walkArea = 0;
  let allArea = 0;
  const why = { water: 0, steep: 0, solid: 0, mass: 0, thin: 0, island: 0 };
  const perFace = [0, 0, 0, 0, 0, 0].map(() => ({ walk: 0, all: 0 }));
  for (let c = 0; c < grid.count; c++) {
    const f = Math.floor(c / (CELLS_PER_FACE * CELLS_PER_FACE));
    allArea += grid.area[c];
    perFace[f].all += grid.area[c];
    const b = grid.blocked[c];
    if (b === 0) {
      walkCells += 1;
      walkArea += grid.area[c];
      perFace[f].walk += grid.area[c];
    } else {
      for (const [k, bit] of Object.entries(BLOCK)) if (b & bit) why[k] += 1;
    }
  }
  const report = {
    walkableCells: walkCells,
    walkableCellFraction: walkCells / grid.count,
    walkableArea: walkArea,
    walkableAreaFraction: walkArea / allArea,
    walkablePerRegion: perFace.map(
      (p, f) => `${REGIONS[f].id} ${((100 * p.walk) / p.all).toFixed(1)}%`,
    ),
    blockedCellsBy: why,
    thinCellsBlocked: opening.thin,
    componentsBeforeKeep: comps.components,
    islandCellsBlocked: comps.removed,
    counts: {
      pads: layout.pads.length,
      caches: caches.length,
      golden: caches.filter((c) => c.golden).length,
      camps: layout.camps.length,
      bushes: layout.bushes.length,
      sightBlockers: layout.sightBlockers.length,
      props: props.length,
      walls: scene.walls.length,
      masses: scene.masses.length,
      bridges: scene.bridges.length,
      ramps: scene.ramps.length,
    },
    cachesPerRegion: REGIONS.map((r) => {
      const n = caches.filter(
        (c) =>
          dot(c.at, heart(r.face)) >=
          Math.max(...[0, 1, 2, 3, 4, 5].map((f) => dot(c.at, heart(f)))),
      ).length;
      return `${r.id} ${n}`;
    }),
    padTurns: ctx.pads.map((p) => `${p.name} ${p.turned}`),
    notes: ctx.report,
    problems,
    ms: { plan: Math.round(planned - started), raster: Math.round(rastered - planned) },
  };
  return {
    layout,
    scene,
    nav: navigationBuffer(grid),
    report,
    grid,
    world,
    ctx,
    caches,
    paintBytes,
  };
}

function main() {
  const args = process.argv.slice(2);
  const debugDir = args.includes('--debug') ? args[args.indexOf('--debug') + 1] : null;
  const t0 = performance.now();
  const out = generate();
  const pub = path.join(root, 'public/map/planet');
  const art = path.join(root, 'art_src/planet');
  mkdirSync(pub, { recursive: true });
  mkdirSync(art, { recursive: true });
  writeFileSync(path.join(pub, 'navigation.bin'), out.nav);
  writeFileSync(path.join(pub, 'layout.json'), `${JSON.stringify(out.layout)}\n`);
  writeFileSync(path.join(art, 'scene.json'), `${JSON.stringify(out.scene)}\n`);
  if (debugDir) {
    mkdirSync(debugDir, { recursive: true });
    const dirs = {
      campsDirs: out.ctx.camps.map((c) => c.at),
      arenasDirs: Object.values(out.ctx.creatures),
      cachesDirs: out.caches,
      padsDirs: out.ctx.pads,
    };
    writeFileSync(
      path.join(debugDir, 'planet-map.png'),
      debugMap(out.grid, out.world, dirs, out.paintBytes, PAINT_CHANNELS.length),
    );
  }
  out.report.ms.total = Math.round(performance.now() - t0);
  console.log(JSON.stringify(out.report, null, 2));
  if (out.report.problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
