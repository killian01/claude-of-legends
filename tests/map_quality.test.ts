// Who downloads which Star Orchard model (src/game/map_quality.ts).

import { describe, expect, it } from 'vitest';
import {
  chooseModel,
  mapQualityFor,
  qualityOverride,
  readDeviceHints,
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

describe('the address', () => {
  it('can insist on either, and nothing else counts', () => {
    expect(qualityOverride('?map=light')).toBe('light');
    expect(qualityOverride('?a=1&map=full')).toBe('full');
    expect(qualityOverride('?map=medium')).toBeNull();
    expect(qualityOverride('')).toBeNull();
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
