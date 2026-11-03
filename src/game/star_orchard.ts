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
import { downloadTotal } from './download_total';
import {
  chooseModel,
  type ModelChoice,
  mapQualityFor,
  qualityOverride,
  readDeviceHints,
} from './map_quality';
import { downloadModel, type ModelFile } from './slow_line';
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
// the size comes from the manifest when the server does not say, or says
// it of a compressed body (download_total.ts). A full model on a line too
// slow for it gives way to the light one (slow_line.ts).
function fetchBytes(choice: ModelChoice, light: ModelFile | null): Promise<ArrayBuffer> {
  return downloadModel(
    choice,
    choice.quality === 'full' ? light : null,
    {
      fetchFile: fetchOrchardFile,
      totalOf: (res, expected) => downloadTotal(res.headers, expected),
      now: () => performance.now(),
    },
    report,
  );
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
    // Which model: the light one on a phone or a tablet, unless the
    // address says otherwise (map_quality.ts). An address that asks for
    // one gets it however slow the line.
    const asked = qualityOverride(window.location.search);
    const choice = chooseModel(orchard, asked ?? mapQualityFor(readDeviceHints(window)));
    const light =
      asked === null && orchard.modelLight !== null && orchard.modelLightBytes > 0
        ? { file: orchard.modelLight, bytes: orchard.modelLightBytes }
        : null;
    model = fetchBytes(choice, light)
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

// Starts the records and the model downloading for a match about to be
// chosen (the practice select, as the online queue does with the records
// it already holds), so the card at the match's door is brief. A failure
// is left to that card: the loads forget it and ask again there.
export function prefetchStarOrchard(): void {
  loadStarOrchard()
    .then((orchard) => loadStarOrchardModel(orchard, () => {}))
    .catch(() => undefined);
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
