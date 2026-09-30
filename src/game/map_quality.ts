// Which Star Orchard model a browser downloads (docs/star-orchard.md), and
// how finely the renderer draws it. The full model's textures decode to
// about 1.5 GB on the GPU, which a laptop holds and a phone does not: iOS
// and Android kill the tab the moment the terrain arrives and reload it,
// which the player sees as the loading card reaching 100% and the landing
// coming back. The export ships a second model with the same scene and
// smaller textures (scripts/light_map.mjs); this decides who gets it, and
// what a phone draws it into. Pure, so tests/map_quality.test.ts can pin
// the rules; star_orchard.ts and the renderer read them.

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

// What the renderer draws into: the canvas's pixels per CSS pixel, and the
// side of the sun's shadow map.
export interface RenderQuality {
  pixelRatio: number;
  shadowMapSize: number;
}

// A phone's canvas is its biggest GPU item after the textures: an 844x390
// screen at a ratio of 2 draws 1688x780 with 4x antialiasing, about 40 MB
// with its depth, and the 2048 shadow map adds 16 MB more, which is what a
// tab gets killed for. So a coarse pointer draws at 1.5 pixels per CSS
// pixel at most, still sharp at arm's length, into a 1024 shadow map
// (about 24 MB and 4 MB), whatever the terrain asks for.
export const PHONE_PIXEL_RATIO = 1.5;
export const PHONE_SHADOW_MAP = 1024;
// Everyone else: the screen's own ratio up to 2, a 2048 shadow map; a
// terrain that asks for high detail gets the screen's ratio and 4096.
export const DESK_PIXEL_RATIO = 2;
export const DESK_SHADOW_MAP = 2048;
export const HIGH_DETAIL_SHADOW_MAP = 4096;

export function renderQualityFor(
  hints: DeviceHints,
  devicePixelRatio: number,
  highDetail = false,
): RenderQuality {
  // A browser that reports no usable ratio draws one pixel per pixel.
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (hints.coarsePointer) {
    return { pixelRatio: Math.min(dpr, PHONE_PIXEL_RATIO), shadowMapSize: PHONE_SHADOW_MAP };
  }
  if (highDetail) return { pixelRatio: dpr, shadowMapSize: HIGH_DETAIL_SHADOW_MAP };
  return { pixelRatio: Math.min(dpr, DESK_PIXEL_RATIO), shadowMapSize: DESK_SHADOW_MAP };
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
