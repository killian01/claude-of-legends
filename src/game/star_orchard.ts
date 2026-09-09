// The Star Orchard test mode's assets (docs/star-orchard.md): the shipped
// export under public/map/star-orchard/, fetched once per page and kept,
// then assembled per match into the map record, a fresh walkability grid
// (the sim blocks its towers into it) and the renderer's terrain.

import type { RenderTerrain } from '../render/terrain';
import { loadTerrain } from '../render/terrain_loader';
import type { GameMap } from '../sim/content/map';
import {
  type StarOrchardLayout,
  type StarOrchardManifest,
  starOrchardMap,
} from '../sim/content/star_orchard';
import { decodeTerrainNav, type TerrainNavData, TerrainNavGrid } from '../sim/terrain_nav';

export const STAR_ORCHARD_ROOT = '/map/star-orchard/';

export interface StarOrchardAssets {
  manifest: StarOrchardManifest;
  layout: StarOrchardLayout;
  navigation: TerrainNavData;
  model: ArrayBuffer;
}

export interface StarOrchardMatch {
  map: GameMap;
  nav: TerrainNavGrid;
  terrain: RenderTerrain;
}

// Download progress, 0 to 1, for the one file worth a bar.
export type ProgressReport = (fraction: number) => void;

let cached: Promise<StarOrchardAssets> | null = null;

async function fetchChecked(path: string): Promise<Response> {
  const res = await fetch(`${STAR_ORCHARD_ROOT}${path}`);
  if (!res.ok) throw new Error(`could not load ${path} (${res.status})`);
  return res;
}

// Streams the body so the loading screen can show the model coming in;
// the size comes from the manifest when the server does not say.
async function fetchBytes(
  path: string,
  expected: number,
  onProgress: ProgressReport,
): Promise<ArrayBuffer> {
  const res = await fetchChecked(path);
  const total = Number(res.headers.get('content-length')) || expected;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

export function loadStarOrchardAssets(onProgress: ProgressReport): Promise<StarOrchardAssets> {
  if (cached) return cached;
  const load = async (): Promise<StarOrchardAssets> => {
    const [manifest, layout, navigation] = await Promise.all([
      fetchChecked('manifest.json').then((r) => r.json() as Promise<StarOrchardManifest>),
      fetchChecked('gameplay.json').then((r) => r.json() as Promise<StarOrchardLayout>),
      fetchChecked('navigation.bin').then((r) => r.arrayBuffer()),
    ]);
    // Assemble once up front so a mismatched export fails before the model
    // is downloaded.
    const navData = decodeTerrainNav(manifest, navigation);
    starOrchardMap(layout, manifest);
    const model = await fetchBytes(
      manifest.model,
      manifest.visualReport?.glbBytes ?? 0,
      onProgress,
    );
    return { manifest, layout, navigation: navData, model };
  };
  cached = load().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

// One match's worth: a new grid and terrain over the shared bytes.
export async function buildStarOrchardMatch(assets: StarOrchardAssets): Promise<StarOrchardMatch> {
  const map = starOrchardMap(assets.layout, assets.manifest);
  const nav = new TerrainNavGrid(assets.navigation);
  const terrain = await loadTerrain(assets.model, nav, map);
  return { map, nav, terrain };
}
