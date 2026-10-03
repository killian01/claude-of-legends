// The Wanderseed as a Node process reads it (ADR 0031, docs/planet.md): the
// layout record and the cube-sphere walkability grid under public/map/planet
// in a checkout, or under dist/ where only the built client ships (the
// container), assembled by the planet's own module (src/sim/content/
// planet.ts) so every point lies on the sphere to the bit. Read and decoded
// once per process; each match builds a grid of its own over the shared
// heights, since a match's walls block cells of its own (src/sim/ground.ts).
// The models are never read here: nothing in Node renders.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { RoyalePlanet } from '../src/net/replay';
import { assemblePlanet } from '../src/sim/content/planet';
import { SphereGround } from '../src/sim/ground';
import { decodeSphereNav, findSpherePath, SphereNavGrid } from '../src/sim/sphere_nav';

const FOLDER = path.join('map', 'planet');

// Where the export is, under `root`: the checkout's public/ first, since a
// stale dist/ beside it would otherwise win.
export function planetDir(root = process.cwd()): string {
  for (const base of ['public', 'dist']) {
    const dir = path.join(root, base, FOLDER);
    if (existsSync(path.join(dir, 'layout.json'))) return dir;
  }
  throw new Error(`the Wanderseed export is missing under ${root} (public/ or dist/)`);
}

export function readPlanet(root = process.cwd()): RoyalePlanet {
  const dir = planetDir(root);
  const record: unknown = JSON.parse(readFileSync(path.join(dir, 'layout.json'), 'utf8'));
  const layout = assemblePlanet(record);
  const binary = readFileSync(path.join(dir, 'navigation.bin'));
  const buffer = binary.buffer.slice(
    binary.byteOffset,
    binary.byteOffset + binary.byteLength,
  ) as ArrayBuffer;
  const data = decodeSphereNav(layout.nav, buffer);
  return {
    layout,
    ground: () => new SphereGround(new SphereNavGrid(data), findSpherePath),
  };
}

let cached: RoyalePlanet | null = null;

// The process's one copy, read on first use.
export function planet(): RoyalePlanet {
  cached ??= readPlanet();
  return cached;
}
