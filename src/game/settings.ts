// Player settings: audio volumes and the announcer toggle, persisted in
// localStorage and applied live through the audio modules' setters, and the
// choices a screen remembers for the viewer (the practice select's enemy
// bots). The parsing/clamping core is pure so the test suite can pin it.

import { setAnnouncerEnabled } from './announcer';
import { setMusicVolume } from './music';
import { clampPracticeBots, DEFAULT_PRACTICE_BOTS, type PracticeBots } from './practice_bots';
import { setSfxVolume } from './sfx';
import type { TouchScheme } from './touch';
import { clampUiScale, SETTINGS_EVENT, type UiScaleSetting } from './ui_scale';

export interface GameSettings {
  // 0..1 multipliers over the authored levels.
  sfx: number;
  music: number;
  announcer: boolean;
  // How big the interface is drawn (ui_scale.ts): the rule, or a multiplier.
  uiScale: UiScaleSetting;
  // How a phone plays (touch.ts): the thumb stick, or a tap to walk.
  touchScheme: TouchScheme;
  // Who the opponents' lane seats play in Practice (practice_bots.ts): the
  // choice last locked in at its select.
  practiceBots: PracticeBots;
  // The matches this device has shown the Move ring in (move_ring.ts),
  // which stops after the first few. Not a choice the panel offers.
  moveRingMatches: number;
  // A phone held upright that the browser will not turn (rotated_view.ts):
  // the match turned a quarter for it, or the wall asking for a turn.
  rotatedView: boolean;
  // This browser was told, once, that its matches are on the ladder: a
  // Guest's first points say so plainly (ui/hud.ts, ADR 0027). Not a
  // choice, so the settings panel never shows it.
  ladderTold: boolean;
  // A left click on the ground walks and on an enemy attacks, like the
  // right click (game/boot.ts): a laptop's trackpad clicks left, and a
  // visitor whose clicks did nothing left within half a minute (the seat
  // report, 2026-10-01). Off, a left click only selects, the genre's way.
  leftClickMoves: boolean;
  // The first steps (ui/first_steps.ts): hidden by the player, and the
  // steps this browser has done, so a returning player meets only what
  // they have not. The settings panel brings a hidden guide back, from
  // its first step.
  stepsOff: boolean;
  stepsDone: string[];
}

export const DEFAULT_SETTINGS: GameSettings = {
  sfx: 1,
  music: 1,
  announcer: true,
  uiScale: 'auto',
  touchScheme: 'thumbs',
  practiceBots: DEFAULT_PRACTICE_BOTS,
  moveRingMatches: 0,
  rotatedView: true,
  ladderTold: false,
  leftClickMoves: true,
  stepsOff: false,
  stepsDone: [],
};

const STORAGE_KEY = 'loc-settings';

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

// A count kept in storage: a whole number from zero, capped so that junk
// in storage stays a small number.
const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1000, Math.max(0, Math.floor(v))) : 0;

// Pure: any junk in, a valid settings object out.
export function clampSettings(raw: unknown): GameSettings {
  const r = (raw ?? {}) as Partial<Record<keyof GameSettings, unknown>>;
  return {
    sfx: clamp01(r.sfx, DEFAULT_SETTINGS.sfx),
    music: clamp01(r.music, DEFAULT_SETTINGS.music),
    announcer: typeof r.announcer === 'boolean' ? r.announcer : DEFAULT_SETTINGS.announcer,
    uiScale: clampUiScale(r.uiScale),
    touchScheme: r.touchScheme === 'tap' ? 'tap' : 'thumbs',
    practiceBots: clampPracticeBots(r.practiceBots),
    moveRingMatches: count(r.moveRingMatches),
    rotatedView: typeof r.rotatedView === 'boolean' ? r.rotatedView : DEFAULT_SETTINGS.rotatedView,
    ladderTold: r.ladderTold === true,
    leftClickMoves:
      typeof r.leftClickMoves === 'boolean' ? r.leftClickMoves : DEFAULT_SETTINGS.leftClickMoves,
    stepsOff: r.stepsOff === true,
    stepsDone: Array.isArray(r.stepsDone)
      ? [...new Set(r.stepsDone.filter((x): x is string => typeof x === 'string'))].slice(0, 32)
      : [],
  };
}

let current: GameSettings | null = null;

function apply(s: GameSettings): void {
  setSfxVolume(s.sfx);
  setMusicVolume(s.music);
  setAnnouncerEnabled(s.announcer);
  // The interface size is read by whatever is on screen (the HUD, a menu):
  // they hear the change here rather than being told one by one.
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
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
