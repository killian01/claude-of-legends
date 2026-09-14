// Which Star Orchard model a browser downloads (docs/star-orchard.md).
// The full model's textures decode to about 1.5 GB on the GPU, which a
// laptop holds and a phone does not: iOS and Android kill the tab the
// moment the terrain arrives and reload it, which the player sees as the
// loading card reaching 100% and the landing coming back. The export
// ships a second model with the same scene and smaller textures
// (scripts/light_map.mjs); this decides who gets it. Pure, so
// tests/map_quality.test.ts can pin the rule; star_orchard.ts reads it.

import type { StarOrchard } from '../sim/content/star_orchard';

export type MapQuality = 'full' | 'light';

// What the page can tell about the device without a GL context. A coarse
// primary pointer is a phone or a tablet, the two kinds of device that
// have lost the full model; memory itself is not readable on Safari.
export interface DeviceHints {
  coarsePointer: boolean;
}

export function readDeviceHints(win: Pick<Window, 'matchMedia'>): DeviceHints {
  try {
    return { coarsePointer: win.matchMedia('(pointer: coarse)').matches };
  } catch {
    return { coarsePointer: false };
  }
}

export function mapQualityFor(hints: DeviceHints): MapQuality {
  return hints.coarsePointer ? 'light' : 'full';
}

// The address can insist: ?map=light on a laptop shows what a phone sees,
// ?map=full on a phone is how to check the full one still loads there.
// Anything else in the query leaves the rule alone.
export const QUALITY_PARAM = 'map';

export function qualityOverride(search: string): MapQuality | null {
  const value = new URLSearchParams(search).get(QUALITY_PARAM);
  return value === 'light' || value === 'full' ? value : null;
}

export interface ModelChoice {
  file: string;
  bytes: number;
  quality: MapQuality;
}

// The file to fetch: the light one when it is asked for and the export
// ships it, the full one otherwise.
export function chooseModel(
  orchard: Pick<StarOrchard, 'model' | 'modelBytes' | 'modelLight' | 'modelLightBytes'>,
  quality: MapQuality,
): ModelChoice {
  if (quality === 'light' && orchard.modelLight !== null) {
    return { file: orchard.modelLight, bytes: orchard.modelLightBytes, quality: 'light' };
  }
  return { file: orchard.model, bytes: orchard.modelBytes, quality: 'full' };
}
