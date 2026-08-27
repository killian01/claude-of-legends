// The settings core: any junk from storage in, a valid settings object out.

import { describe, expect, it } from 'vitest';
import { clampSettings, DEFAULT_SETTINGS } from '../src/game/settings';

describe('player settings', () => {
  it('falls back to defaults on junk', () => {
    expect(clampSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(clampSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(clampSettings({ sfx: 'loud', music: Number.NaN, announcer: 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('clamps volumes into 0..1 and keeps valid values', () => {
    expect(clampSettings({ sfx: 2, music: -1, announcer: false })).toEqual({
      sfx: 1,
      music: 0,
      announcer: false,
    });
    expect(clampSettings({ sfx: 0.35, music: 0.8, announcer: true })).toEqual({
      sfx: 0.35,
      music: 0.8,
      announcer: true,
    });
  });
});
