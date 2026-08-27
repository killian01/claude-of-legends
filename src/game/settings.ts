// Player settings: audio volumes and the announcer toggle, persisted in
// localStorage and applied live through the audio modules' setters. The
// parsing/clamping core is pure so the test suite can pin it.

import { setAnnouncerEnabled } from './announcer';
import { setMusicVolume } from './music';
import { setSfxVolume } from './sfx';

export interface GameSettings {
  // 0..1 multipliers over the authored levels.
  sfx: number;
  music: number;
  announcer: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = { sfx: 1, music: 1, announcer: true };

const STORAGE_KEY = 'loc-settings';

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

// Pure: any junk in, a valid settings object out.
export function clampSettings(raw: unknown): GameSettings {
  const r = (raw ?? {}) as Partial<Record<keyof GameSettings, unknown>>;
  return {
    sfx: clamp01(r.sfx, DEFAULT_SETTINGS.sfx),
    music: clamp01(r.music, DEFAULT_SETTINGS.music),
    announcer: typeof r.announcer === 'boolean' ? r.announcer : DEFAULT_SETTINGS.announcer,
  };
}

let current: GameSettings | null = null;

function apply(s: GameSettings): void {
  setSfxVolume(s.sfx);
  setMusicVolume(s.music);
  setAnnouncerEnabled(s.announcer);
}

export function getSettings(): GameSettings {
  if (!current) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      // storage or JSON unavailable
    }
    current = clampSettings(raw);
    apply(current);
  }
  return current;
}

export function updateSettings(patch: Partial<GameSettings>): GameSettings {
  current = clampSettings({ ...getSettings(), ...patch });
  apply(current);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
  return current;
}
