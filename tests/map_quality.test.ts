// Who downloads which Star Orchard model (src/game/map_quality.ts).

import { describe, expect, it } from 'vitest';
import {
  chooseModel,
  ladderOverride,
  mapQualityFor,
  PHONE_PIXEL_RATIO,
  PHONE_SHADOW_MAP,
  qualityOverride,
  readDeviceHints,
  renderQualityFor,
} from '../src/game/map_quality';

const orchard = {
  model: 'map.glb',
  modelBytes: 43_000_000,
  modelLight: 'map-light.glb',
  modelLightBytes: 5_000_000,
};

describe('the rule', () => {
  it('gives a coarse pointer the light model and everyone else the full one', () => {
    expect(mapQualityFor({ coarsePointer: true })).toBe('light');
    expect(mapQualityFor({ coarsePointer: false })).toBe('full');
  });

  it('reads the pointer off the page, and assumes a fine one when it cannot', () => {
    const win = (matches: boolean) => ({
      matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' && matches }),
    });
    expect(readDeviceHints(win(true) as unknown as Window)).toEqual({ coarsePointer: true });
    expect(readDeviceHints(win(false) as unknown as Window)).toEqual({ coarsePointer: false });
    const broken = {
      matchMedia: () => {
        throw new Error('no');
      },
    };
    expect(readDeviceHints(broken as unknown as Window)).toEqual({ coarsePointer: false });
  });
});

describe('what the renderer draws into', () => {
  const phone = { coarsePointer: true };
  const laptop = { coarsePointer: false };

  it('caps a phone at 1.5 pixels per pixel and a 1024 shadow map', () => {
    expect(PHONE_PIXEL_RATIO).toBe(1.5);
    expect(PHONE_SHADOW_MAP).toBe(1024);
    expect(renderQualityFor(phone, 3)).toEqual({ pixelRatio: 1.5, shadowMapSize: 1024 });
    expect(renderQualityFor(phone, 2)).toEqual({ pixelRatio: 1.5, shadowMapSize: 1024 });
    // A screen below the cap keeps its own ratio.
    expect(renderQualityFor(phone, 1)).toEqual({ pixelRatio: 1, shadowMapSize: 1024 });
    // Whatever the terrain asks for.
    expect(renderQualityFor(phone, 3, true)).toEqual({ pixelRatio: 1.5, shadowMapSize: 1024 });
  });

  it('leaves a laptop as it was: its ratio up to 2, a 2048 shadow map', () => {
    expect(renderQualityFor(laptop, 1)).toEqual({ pixelRatio: 1, shadowMapSize: 2048 });
    expect(renderQualityFor(laptop, 1.25)).toEqual({ pixelRatio: 1.25, shadowMapSize: 2048 });
    expect(renderQualityFor(laptop, 3)).toEqual({ pixelRatio: 2, shadowMapSize: 2048 });
    expect(renderQualityFor(laptop, 3, true)).toEqual({ pixelRatio: 3, shadowMapSize: 4096 });
  });

  it('draws one pixel per pixel when the browser reports no ratio', () => {
    for (const dpr of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(renderQualityFor(laptop, dpr).pixelRatio).toBe(1);
      expect(renderQualityFor(phone, dpr).pixelRatio).toBe(1);
    }
  });
});

describe('the address', () => {
  it('can insist on either, and nothing else counts', () => {
    expect(qualityOverride('?map=light')).toBe('light');
    expect(qualityOverride('?a=1&map=full')).toBe('full');
    expect(qualityOverride('?map=medium')).toBeNull();
    expect(qualityOverride('')).toBeNull();
  });

  it('can hold the quality ladder at either end, and nothing else counts', () => {
    expect(ladderOverride('?quality=full')).toBe('full');
    expect(ladderOverride('?map=light&quality=low')).toBe('low');
    expect(ladderOverride('?quality=auto')).toBeNull();
    expect(ladderOverride('')).toBeNull();
  });
});

describe('the file', () => {
  it('is the light one when asked for and shipped', () => {
    expect(chooseModel(orchard, 'light')).toEqual({
      file: 'map-light.glb',
      bytes: 5_000_000,
      quality: 'light',
    });
    expect(chooseModel(orchard, 'full')).toEqual({
      file: 'map.glb',
      bytes: 43_000_000,
      quality: 'full',
    });
  });

  it('falls back to the full one on an export without a light model', () => {
    expect(chooseModel({ ...orchard, modelLight: null, modelLightBytes: 0 }, 'light')).toEqual({
      file: 'map.glb',
      bytes: 43_000_000,
      quality: 'full',
    });
  });
});
