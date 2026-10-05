import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ChartWindow } from '../src/render/chart_world';
import { PlanetChart } from '../src/render/planet_chart';
import { voidmaulArenaForImpact } from '../src/render/voidmaul_arena';
import type { RingSite } from '../src/sim/content/map';
import { starOrchardMap } from '../src/sim/content/star_orchard';
import { planetGameMap } from '../src/sim/royale/planet_map';

const shipped = new URL('../public/map/star-orchard/', import.meta.url);
const layout = JSON.parse(readFileSync(new URL('gameplay.json', shipped), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('manifest.json', shipped), 'utf8'));
const rings = starOrchardMap(layout, manifest).rings!;

function modelNodes(): { extras?: { role?: string; objective_id?: string; radius_m?: number } }[] {
  // The GLB's JSON chunk carries the authored platform's dimensions; its
  // textures and compressed geometry are unnecessary for this comparison.
  const file = openSync(new URL('map.glb', shipped), 'r');
  try {
    const header = Buffer.alloc(20);
    readSync(file, header, 0, header.length, 0);
    const json = Buffer.alloc(header.readUInt32LE(12));
    readSync(file, json, 0, json.length, 20);
    return JSON.parse(json.toString('utf8')).nodes;
  } finally {
    closeSync(file);
  }
}

describe('Voidmaul impact arena', () => {
  it('uses the shipped platform centre and radius rather than its leash or the offset paw', () => {
    const arena = voidmaulArenaForImpact(rings, () => 3.3)!;
    expect(arena.center.toArray()).toEqual([0.13170051574707062, 3.3, 146.7403106689453]);
    expect(arena.radius).toBe(16.35);
    expect(rings.find((ring) => ring.id === 'top')!.leash).toBeGreaterThan(arena.radius);
    const platform = modelNodes().find(
      (node) =>
        node.extras?.role === 'objective_platform' &&
        node.extras.objective_id === 'objective-northwest',
    );
    expect(platform?.extras?.radius_m).toBe(arena.radius);
  });

  it('anchors height at the arena centre, selecting Voidmaul even when the Pyrefang site is first', () => {
    const height = vi.fn((x: number, z: number) => 2 + x * 0.1 - z * 0.03);
    const arena = voidmaulArenaForImpact([...rings].reverse(), height)!;
    expect(height).toHaveBeenCalledExactlyOnceWith(arena.center.x, arena.center.z);
    expect(arena.center.y).toBe(2 + arena.center.x * 0.1 - arena.center.z * 0.03);
    arena.center.set(999, 999, 999);
    expect(rings.find((ring) => ring.id === 'top')!.x).toBe(0.13170051574707062);
  });

  it('projects the planet site into its actual chart exactly once while preserving the arena size', () => {
    const planet = JSON.parse(
      readFileSync(new URL('../public/map/planet/layout.json', import.meta.url), 'utf8'),
    );
    const sites = planetGameMap(planet).rings!;
    const point = planet.creatures.voidmaul.at;
    const window = new ChartWindow(
      { chart: PlanetChart.around(point, planet.radius), epoch: 0 },
      200,
    );
    const project = vi.fn((p) => window.toLocal(p));
    const height = vi.fn(() => 1.25);
    const arena = voidmaulArenaForImpact(sites, height, project)!;
    expect(project).toHaveBeenCalledExactlyOnceWith(point);
    expect(height).toHaveBeenCalledExactlyOnceWith(100, 100);
    expect(arena.center.toArray()).toEqual([100, 1.25, 100]);
    expect(arena.radius).toBe(9);
  });

  it('falls back for scenes without a Voidmaul site and refuses an unprojected spherical centre', () => {
    expect(voidmaulArenaForImpact(undefined, () => 0)).toBeUndefined();
    expect(voidmaulArenaForImpact([], () => 0)).toBeUndefined();
    expect(
      voidmaulArenaForImpact(
        rings.filter((ring) => ring.id === 'bot'),
        () => 0,
      ),
    ).toBeUndefined();
    const spherical: RingSite = { id: 'top', lane: 'top', x: 0, y: 0, z: -80, r: 9, leash: 14 };
    expect(voidmaulArenaForImpact([spherical], () => 0)).toBeUndefined();
  });

  it('rejects invalid radius, source coordinates, projection coordinates and terrain height', () => {
    const top = rings.find((ring) => ring.id === 'top')!;
    for (const change of [{ r: 0 }, { r: NaN }, { r: Infinity }, { x: NaN }, { y: Infinity }]) {
      expect(
        voidmaulArenaForImpact(
          [{ ...top, ...change }],
          () => 0,
          (p) => p,
        ),
      ).toBeUndefined();
    }
    expect(
      voidmaulArenaForImpact(
        rings,
        () => 0,
        () => ({ x: NaN, z: 0 }),
      ),
    ).toBeUndefined();
    expect(voidmaulArenaForImpact(rings, () => NaN)).toBeUndefined();
  });
});
