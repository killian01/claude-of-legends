// The settings core: any junk from storage in, a valid settings object out.

import { describe, expect, it, vi } from 'vitest';
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
      uiScale: 'auto',
      touchScheme: 'thumbs',
      practiceBots: 'gentle',
    });
    expect(clampSettings({ sfx: 0.35, music: 0.8, announcer: true })).toEqual({
      sfx: 0.35,
      music: 0.8,
      announcer: true,
      uiScale: 'auto',
      touchScheme: 'thumbs',
      practiceBots: 'gentle',
    });
  });

  it('knows the two ways a phone plays and defaults to the stick', () => {
    expect(clampSettings({ touchScheme: 'tap' }).touchScheme).toBe('tap');
    expect(clampSettings({ touchScheme: 'wheel' }).touchScheme).toBe('thumbs');
  });

  it('remembers the enemy bots of Practice, Gentle until Normal is chosen', () => {
    expect(DEFAULT_SETTINGS.practiceBots).toBe('gentle');
    expect(clampSettings({ practiceBots: 'normal' }).practiceBots).toBe('normal');
    expect(clampSettings({ practiceBots: 'gentle' }).practiceBots).toBe('gentle');
    expect(clampSettings({ practiceBots: 'brutal' }).practiceBots).toBe('gentle');
    expect(clampSettings({ practiceBots: 1 }).practiceBots).toBe('gentle');
  });

  // Per viewer: what the practice select locked in is there on the next
  // page load, read back from the browser's storage.
  it('keeps the enemy bots chosen across a page load', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
    try {
      vi.resetModules();
      const first = await import('../src/game/settings');
      expect(first.getSettings().practiceBots).toBe('gentle');
      first.updateSettings({ practiceBots: 'normal' });
      vi.resetModules();
      const next = await import('../src/game/settings');
      expect(next.getSettings().practiceBots).toBe('normal');
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('keeps an interface size in range and falls back to auto', () => {
    expect(clampSettings({ uiScale: 1.5 }).uiScale).toBe(1.5);
    expect(clampSettings({ uiScale: 9 }).uiScale).toBe(2);
    expect(clampSettings({ uiScale: 'huge' }).uiScale).toBe('auto');
  });
});
