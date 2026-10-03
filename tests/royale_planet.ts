// The Wanderseed as a host reads it, for the tests that play on the real
// planet: the layout record assembled (content/planet.ts) and a maker of
// its ground, a SphereGround over a fresh grid on the decoded navigation
// export (sphere_nav.ts), the way buildRoyaleSim takes it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RoyalePlanet } from '../src/net/replay';
import { assemblePlanet } from '../src/sim/content/planet';
import { SphereGround } from '../src/sim/ground';
import { decodeSphereNav, findSpherePath, SphereNavGrid } from '../src/sim/sphere_nav';

let cached: RoyalePlanet | null = null;

export function loadPlanet(
  dir = fileURLToPath(new URL('../public/map/planet/', import.meta.url)),
): RoyalePlanet {
  if (cached) return cached;
  const planet = assemblePlanet(JSON.parse(readFileSync(`${dir}layout.json`, 'utf8')));
  const bin = readFileSync(`${dir}navigation.bin`);
  const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
  const data = decodeSphereNav(planet.nav, buffer);
  cached = {
    layout: planet,
    ground: () => new SphereGround(new SphereNavGrid(data), findSpherePath),
  };
  return cached;
}
