// The Wanderseed's records as the browser reads them (ADR 0031,
// docs/plan-royale.md), the sibling of star_orchard_records.ts: the
// gameplay layout and the cube-sphere walkability grid
// (src/sim/sphere_nav.ts), fetched once per page for the battle royale.
// The planet's model is the renderer's to load; a worker wants the grid
// and never Three.js, which is why the records stand alone here.

import { versioned } from './asset_version';

export const PLANET_ROOT = '/map/planet/';

// The layout as the export wrote it (docs/planet.md); the planet's content
// module reads its fields.
export type PlanetLayoutFile = Record<string, unknown>;

export interface PlanetRecords {
  layout: PlanetLayoutFile;
  navigation: ArrayBuffer;
}

export async function fetchPlanetFile(path: string): Promise<Response> {
  const res = await fetch(versioned(`${PLANET_ROOT}${path}`));
  if (!res.ok) throw new Error(`could not load ${path} (${res.status})`);
  return res;
}

let cached: Promise<PlanetRecords> | null = null;

// Once per page, however many matches ask; a failure is forgotten so the
// next ask tries again.
export function loadPlanetRecords(): Promise<PlanetRecords> {
  if (cached) return cached;
  const load = async (): Promise<PlanetRecords> => {
    const [layout, navigation] = await Promise.all([
      fetchPlanetFile('layout.json').then((r) => r.json() as Promise<PlanetLayoutFile>),
      fetchPlanetFile('navigation.bin').then((r) => r.arrayBuffer()),
    ]);
    return { layout, navigation };
  };
  cached = load().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}
