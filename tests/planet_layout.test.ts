// The shipped battle royale planet (public/map/planet/, docs/planet.md)
// checked against its own navigation grid: everything gameplay stands on
// is open ground, the walkable surface is one connected piece, and the
// counts are what the design promised. The generator
// (scripts/planet/generate.mjs) runs the same checks before it writes; this
// pins the files as they ship.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMP_KINDS } from '../src/sim/content/camps';
import { assemblePlanet, planetRegionOf } from '../src/sim/content/planet';
import {
  arcLowerBound,
  decodeSphereNav,
  SphereNavGrid,
  type SpherePoint,
} from '../src/sim/sphere_nav';

const folder = new URL('../public/map/planet/', import.meta.url);
const record = JSON.parse(readFileSync(new URL('layout.json', folder), 'utf8'));
const planet = assemblePlanet(record);
const bin = readFileSync(new URL('navigation.bin', folder));
const data = decodeSphereNav(
  planet.nav,
  bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer,
);
const grid = new SphereNavGrid(data);
const R = planet.radius;
const n = grid.n;

const dist = (a: SpherePoint, b: SpherePoint) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
const arc = (a: SpherePoint, b: SpherePoint) => arcLowerBound(dist(a, b), R);

// Every cell whose center lies within `meters` of p (a flood over the
// neighbors, so it crosses face edges).
function cellsWithin(p: SpherePoint, meters: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>([grid.cellOf(p)]);
  const stack = [grid.cellOf(p)];
  const row = new Int32Array(8);
  while (stack.length > 0) {
    const c = stack.pop()!;
    const d = dist(grid.cellCenter(c), p);
    if (d <= meters) out.push(c);
    if (d > meters + 1) continue;
    grid.neighborRow(c, row);
    for (const nb of row) {
      if (nb >= 0 && !seen.has(nb)) {
        seen.add(nb);
        stack.push(nb);
      }
    }
  }
  return out;
}
const openDisc = (p: SpherePoint, meters: number) =>
  cellsWithin(p, meters).every((c) => grid.isWalkableCell(c));

// The walkable component of the first open cell, with the sim's moves.
function component(): Uint8Array {
  const inMain = new Uint8Array(grid.cellCount);
  let start = 0;
  while (!grid.isWalkableCell(start)) start++;
  const stack = new Int32Array(grid.cellCount);
  let top = 0;
  stack[top++] = start;
  inMain[start] = 1;
  while (top > 0) {
    const c = stack[--top]!;
    for (let k = 0; k < 8; k++) {
      const nb = grid.canStep(c, k);
      if (nb >= 0 && inMain[nb] === 0) {
        inMain[nb] = 1;
        stack[top++] = nb;
      }
    }
  }
  return inMain;
}

function cellArea(c: number): number {
  const r = c % (n * n);
  const i = r % n;
  const j = (r - i) / n;
  const u = (2 * i + 1) / n - 1;
  const v = (2 * j + 1) / n - 1;
  const w = 1 + u * u + v * v;
  return ((4 / (n * n)) * R * R) / (w * Math.sqrt(w));
}

describe('the planet layout record', () => {
  it('assembles, every point on the sphere', () => {
    expect(planet.radius).toBe(80);
    expect(grid.n).toBe(320);
    const raw: SpherePoint[] = [
      ...record.crossroads,
      ...record.pads.flatMap((p: { at: SpherePoint; to: SpherePoint }) => [p.at, p.to]),
      ...record.caches.map((c: { at: SpherePoint }) => c.at),
      ...record.camps.map((c: { at: SpherePoint }) => c.at),
      ...record.bushes.map((b: { at: SpherePoint }) => b.at),
      ...record.sightBlockers.map((b: { at: SpherePoint }) => b.at),
      ...record.regions.map((r: { heart: SpherePoint }) => r.heart),
    ];
    for (const p of raw)
      expect(Math.abs(Math.sqrt(p.x ** 2 + p.y ** 2 + p.z ** 2) - R)).toBeLessThan(1e-5);
    expect(planet.regions.map((r) => r.id)).toEqual([
      'ruins',
      'groves',
      'sanctuary',
      'open',
      'lakes',
      'cliffs',
    ]);
    for (const r of planet.regions) expect(planetRegionOf(planet, r.heart)).toBe(r);
  });

  it('holds the promised counts', () => {
    expect(planet.crossroads).toHaveLength(8);
    expect(planet.pads.length).toBeGreaterThanOrEqual(9);
    expect(planet.pads.length).toBeLessThanOrEqual(12);
    expect(planet.caches.length).toBeGreaterThanOrEqual(220);
    expect(planet.caches.length).toBeLessThanOrEqual(280);
    expect(planet.camps.length).toBeGreaterThanOrEqual(18);
    expect(planet.camps.length).toBeLessThanOrEqual(24);
    expect(planet.bushes.length).toBeGreaterThanOrEqual(140);
    expect(planet.bushes.length).toBeLessThanOrEqual(200);
    expect(planet.sightBlockers.length).toBeGreaterThan(500);
    for (const b of planet.bushes) {
      expect(b.r).toBeGreaterThanOrEqual(1.5);
      expect(b.r).toBeLessThanOrEqual(3.5);
    }
  });
});

describe('the planet against its navigation grid', () => {
  const main = component();
  const inMain = (p: SpherePoint) => main[grid.cellOf(p)] === 1;

  it('is one connected walkable surface of about 70 percent', () => {
    let walkable = 0;
    let connected = 0;
    let walkArea = 0;
    let allArea = 0;
    for (let c = 0; c < grid.cellCount; c++) {
      const a = cellArea(c);
      allArea += a;
      if (!grid.isWalkableCell(c)) continue;
      walkable += 1;
      walkArea += a;
      if (main[c] === 1) connected += 1;
    }
    expect(connected / walkable).toBeGreaterThan(0.995);
    expect(connected).toBe(walkable);
    expect(walkArea / allArea).toBeGreaterThan(0.62);
    expect(walkArea / allArea).toBeLessThan(0.8);
  });

  it('blocks the spire and the monolith at the poles', () => {
    for (const pole of [planet.poles.north, planet.poles.south]) {
      expect(pole.r).toBeGreaterThanOrEqual(3.5);
      for (const c of cellsWithin(pole.at, pole.r - 0.3))
        expect(grid.isWalkableCell(c)).toBe(false);
    }
  });

  it('lands every pad fifty meters away on open ground', () => {
    for (const pad of planet.pads) {
      expect(openDisc(pad.at, 1.5)).toBe(true);
      expect(openDisc(pad.to, 3)).toBe(true);
      expect(inMain(pad.at)).toBe(true);
      expect(inMain(pad.to)).toBe(true);
      expect(Math.abs(arc(pad.at, pad.to) - 50)).toBeLessThan(0.05);
    }
    // One at each crossroads, plus the extra ones.
    for (const c of planet.crossroads)
      expect(planet.pads.some((p) => dist(p.at, c) < 6)).toBe(true);
  });

  it('spreads the caches on open ground, six meters apart, golden at the hearts', () => {
    for (const c of planet.caches) {
      expect(openDisc(c.at, 0.9)).toBe(true);
      expect(inMain(c.at)).toBe(true);
    }
    for (let i = 0; i < planet.caches.length; i++) {
      for (let j = i + 1; j < planet.caches.length; j++) {
        expect(dist(planet.caches[i]!.at, planet.caches[j]!.at)).toBeGreaterThan(5.99);
      }
    }
    const golden = planet.caches.filter((c) => c.golden);
    for (const r of planet.regions) {
      const here = golden.filter((c) => planetRegionOf(planet, c.at) === r);
      expect(here.length).toBe(r.id === 'sanctuary' ? 6 : 2);
      for (const c of here) expect(arc(c.at, r.heart)).toBeLessThan(25);
    }
    // The hot drop is the richest region.
    const per = planet.regions.map(
      (r) => planet.caches.filter((c) => planetRegionOf(planet, c.at) === r).length,
    );
    expect(Math.max(...per)).toBe(per[2]);
  });

  it('opens every camp seven meters around, away from pads and golden caches', () => {
    const kinds = new Set(planet.camps.map((c) => c.kind));
    expect([...kinds].sort()).toEqual([...CAMP_KINDS].sort());
    for (const camp of planet.camps) {
      expect(openDisc(camp.at, 7)).toBe(true);
      expect(inMain(camp.at)).toBe(true);
      for (const p of planet.pads) {
        expect(dist(camp.at, p.at)).toBeGreaterThan(10);
        expect(dist(camp.at, p.to)).toBeGreaterThan(10);
      }
      for (const c of planet.caches) if (c.golden) expect(dist(camp.at, c.at)).toBeGreaterThan(8);
    }
    for (const r of planet.regions) {
      const here = planet.camps.filter((c) => planetRegionOf(planet, c.at) === r).length;
      expect(here).toBeGreaterThanOrEqual(3);
      expect(here).toBeLessThanOrEqual(4);
    }
  });

  it('gives each creature an open arena in its region', () => {
    const { warden, pyrefang, voidmaul } = planet.creatures;
    const region = (id: string) => planet.regions.find((r) => r.id === id)!;
    expect(planetRegionOf(planet, warden.at).id).toBe('sanctuary');
    const fromSpire = arc(warden.at, planet.poles.north.at);
    expect(fromSpire).toBeGreaterThanOrEqual(15);
    expect(fromSpire).toBeLessThanOrEqual(20);
    expect(warden.r).toBeGreaterThanOrEqual(9.5);
    expect(arc(pyrefang.at, region('ruins').heart)).toBeLessThan(3);
    expect(arc(voidmaul.at, region('cliffs').heart)).toBeLessThan(3);
    for (const a of [warden, pyrefang, voidmaul]) {
      expect(openDisc(a.at, a.r)).toBe(true);
      expect(inMain(a.at)).toBe(true);
    }
  });

  it('keeps bushes off pads and caches, on walkable ground', () => {
    for (const b of planet.bushes) {
      expect(grid.isWalkableAt(b.at)).toBe(true);
      expect(inMain(b.at)).toBe(true);
      for (const p of planet.pads) {
        expect(dist(b.at, p.at)).toBeGreaterThan(b.r);
        expect(dist(b.at, p.to)).toBeGreaterThan(b.r);
      }
      for (const c of planet.caches) expect(dist(b.at, c.at)).toBeGreaterThan(b.r);
    }
  });

  it('keeps the ground heights gentle where champions walk', () => {
    let low = 0;
    let high = 0;
    for (let c = 0; c < grid.cellCount; c++) {
      if (!grid.isWalkableCell(c)) continue;
      const h = data.heights[c]! * data.heightScale;
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    expect(low).toBeGreaterThan(-0.5);
    expect(high).toBeLessThan(4.6);
    expect(high).toBeGreaterThan(3);
  });
});
