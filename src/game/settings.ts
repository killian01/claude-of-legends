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
  // The battle royale's first steps (ui/royale_steps.ts): the steps this
  // browser has done there. One guide with two lists of steps: Hide guide
  // hides both (stepsOff), and the settings panel brings both back.
  royaleStepsDone: string[];
  // The battle royale's quick pick (ui/royale_pick.ts): the champion, the
  // skin and the two sigils last played, ready the next time; null before
  // the first. Which champions exist is the pick's to check
  // (ui/royale_pick_rules.ts), not the storage's.
  royalePick: RoyalePickMemory | null;
  // The most Respawn takedowns this browser scored in one seat, counted
  // since landing for a drop-in: the end card's best (ui/royale_result.ts).
  // 0 before the first. Not a choice, so the settings panel never shows it.
  royaleBest: number;
  // The points this browser's seats earned in battle royales: Respawn's end
  // card climbs them as levels (ui/royale_goal.ts). 0 before the first. Not
  // a choice, so the settings panel never shows it.
  royaleGoal: number;
}

export interface RoyalePickMemory {
  championId: string;
  skin: number;
  sigils: [string, string];
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
  royaleStepsDone: [],
  royalePick: null,
  royaleBest: 0,
  royaleGoal: 0,
};

const STORAGE_KEY = 'loc-settings';

const clamp01 = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

// A count kept in storage: a whole number from zero, capped so that junk
// in storage stays a small number.
const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1000, Math.max(0, Math.floor(v))) : 0;

// A total of points kept in storage: a whole number from zero, capped far
// past any real one (ui/royale_goal.ts GOAL_MAX_POINTS).
const points = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(10_000_000, Math.max(0, Math.floor(v)))
    : 0;

// A list of step ids kept in storage: strings, once each, a few at most.
const idList = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === 'string'))].slice(0, 32)
    : [];

// The quick pick remembered: a champion id, a skin index and two different
// sigil ids, or nothing.
function royalePickOf(v: unknown): RoyalePickMemory | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Partial<Record<keyof RoyalePickMemory, unknown>>;
  if (typeof r.championId !== 'string' || r.championId.length === 0) return null;
  if (r.championId.length > 64) return null;
  const sigils = Array.isArray(r.sigils) ? r.sigils : [];
  const [a, b] = sigils;
  if (sigils.length !== 2 || typeof a !== 'string' || typeof b !== 'string' || a === b) {
    return null;
  }
  return { championId: r.championId, skin: Math.min(count(r.skin), 32), sigils: [a, b] };
}

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
    stepsDone: idList(r.stepsDone),
    royaleStepsDone: idList(r.royaleStepsDone),
    royalePick: royalePickOf(r.royalePick),
    royaleBest: count(r.royaleBest),
    royaleGoal: points(r.royaleGoal),
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
