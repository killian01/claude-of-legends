// The Star Orchard's model as the browser reads it (ADR 0021): the one
// download worth a progress bar, fetched once per page and kept as bytes,
// parsed into a fresh terrain per match (the parsed scene belongs to the
// renderer that disposes it). The records the sim needs are
// star_orchard_records.ts; this module is the only one that touches the
// renderer's loader.

import type { RenderTerrain } from '../render/terrain';
import { loadTerrain } from '../render/terrain_loader';
import type { StarOrchard } from '../sim/content/star_orchard';
import { TerrainNavGrid } from '../sim/terrain_nav';
import { fetchOrchardFile, loadStarOrchard } from './star_orchard_records';

// Download progress, 0 to 1.
export type ProgressReport = (fraction: number) => void;

// One download per page, however many matches ask: every caller hears the
// progress of the download in flight, and a caller that comes late hears
// where it stands at once.
let model: Promise<ArrayBuffer> | null = null;
let downloaded = false;
let fraction = 0;
const listeners = new Set<ProgressReport>();

function report(value: number): void {
  fraction = value;
  for (const listener of listeners) listener(value);
}

// Streams the body so the loading screen can show the model coming in;
// the size comes from the manifest when the server does not say.
async function fetchBytes(path: string, expected: number): Promise<ArrayBuffer> {
  const res = await fetchOrchardFile(path);
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
    report(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

// Whether the model is already on hand, so a host can skip the card.
export function modelDownloaded(): boolean {
  return downloaded;
}

export function loadStarOrchardModel(
  orchard: StarOrchard,
  onProgress: ProgressReport,
): Promise<ArrayBuffer> {
  listeners.add(onProgress);
  if (downloaded) onProgress(1);
  else if (fraction > 0) onProgress(fraction);
  if (!model) {
    model = fetchBytes(orchard.model, orchard.modelBytes)
      .then((bytes) => {
        downloaded = true;
        report(1);
        return bytes;
      })
      .catch((err) => {
        model = null;
        throw err;
      });
  }
  return model.finally(() => listeners.delete(onProgress));
}

// A match's terrain: the shared bytes parsed over a grid of their own (the
// renderer reads heights and paints the minimap from it; the sim has its
// own grid to block towers into).
export async function loadStarOrchardTerrain(
  orchard: StarOrchard,
  onProgress: ProgressReport,
): Promise<RenderTerrain> {
  const bytes = await loadStarOrchardModel(orchard, onProgress);
  return loadTerrain(bytes, new TerrainNavGrid(orchard.navigation), orchard.map);
}

export interface LoadedOrchard {
  orchard: StarOrchard;
  terrain: RenderTerrain;
}

// Records and terrain together, for the hosts that want both at once.
export async function loadStarOrchardMatch(onProgress: ProgressReport): Promise<LoadedOrchard> {
  const orchard = await loadStarOrchard();
  const terrain = await loadStarOrchardTerrain(orchard, onProgress);
  return { orchard, terrain };
}
