// What a browser remembers of how finely it drew its last match of each
// kind, so the next one starts near there instead of at the top and
// relearns little (quality_ladder.ts). Kept in the browser's own storage
// under one key, never sent anywhere (PRIVACY.md); a browser that keeps
// nothing starts every match at the top, as before.
//
// The step is the rung the last match spent most of its judged time on,
// kept as rungs below the device's own ratio, with that ratio: a screen
// with another (a zoom, another monitor) starts at its own top, the steps
// having been another screen's. Nothing is given back at a match's end:
// the ladder's calm step up climbs within the match when there is room,
// and a slowdown it came back from soon leaves the top as the step.
//
// It also carries what only a new WebGL context can change, the lean
// level. A match that spent most of its judged time below the top makes
// the next one leaner by a level: first without the effects' lights (three
// pooled point lights every lit pixel of the ground shades, at intensity 0
// while no spell flashes: the frame drawn in 0.63 of the time on the Star
// Orchard and 0.80 on the planet without them, for a flash that no longer
// lights the ground), then without antialiasing as well (0.83 and 0.62
// more, for jagged edges). Five matches at a level give one back, a retry:
// a machine that still needs it is below the top again in the next one
// and leans again. A line kept in an older shape is dropped.

import type { Rung } from './quality_ladder';

export const QUALITY_KEY = 'col.quality';

// The two kinds of match, drawn at very different costs a pixel: the Star
// Orchard's ground shades at about two and a half times the planet's.
export type LadderMode = 'classic' | 'royale';

// What a lean level makes the context with.
export interface Lean {
  antialias: boolean;
  effectLights: boolean;
}

export const LEAN_LEVELS: readonly Lean[] = [
  { antialias: true, effectLights: true },
  { antialias: true, effectLights: false },
  { antialias: false, effectLights: false },
];
export const LEANEST = LEAN_LEVELS.length - 1;

// Matches played at a lean level before one is given back.
export const RETRY_MATCHES = 5;

export interface ModeMemory {
  // The device's own ratio, the top of its ladder.
  top: number;
  // The rung to start the next match on, counted from the top.
  step: number;
  // The lean level for the next match, and the matches played at it.
  lean: number;
  played: number;
}

export interface QualityMemory {
  // The screen's rate, as best known.
  hz: number | null;
  modes: Partial<Record<LadderMode, ModeMemory>>;
}

const MODES: readonly LadderMode[] = ['classic', 'royale'];

function modeOf(v: unknown): ModeMemory | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const { top, step, lean, played } = o;
  if (typeof top !== 'number' || !(top >= 0.25 && top <= 4)) return null;
  if (!whole(step, 16) || !whole(lean, LEANEST) || !whole(played, RETRY_MATCHES)) return null;
  return { top, step, lean, played };
}

function whole(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
}

// A stored line read back: anything broken, out of range or in an older
// shape is dropped, never trusted.
export function parseQualityMemory(raw: string | null): QualityMemory {
  const empty: QualityMemory = { hz: null, modes: {} };
  if (raw === null) return empty;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof v !== 'object' || v === null) return empty;
  const o = v as Record<string, unknown>;
  const hz = typeof o.hz === 'number' && o.hz >= 1 && o.hz <= 500 ? o.hz : null;
  const modes: QualityMemory['modes'] = {};
  const stored = typeof o.modes === 'object' && o.modes !== null ? o.modes : {};
  for (const mode of MODES) {
    const m = modeOf((stored as Record<string, unknown>)[mode]);
    if (m) modes[mode] = m;
  }
  return { hz, modes };
}

export function readQualityMemory(): QualityMemory {
  try {
    return parseQualityMemory(localStorage.getItem(QUALITY_KEY));
  } catch {
    return { hz: null, modes: {} };
  }
}

export function writeQualityMemory(memory: QualityMemory): void {
  try {
    localStorage.setItem(QUALITY_KEY, JSON.stringify(memory));
  } catch {
    // storage unavailable: the next match starts at the top
  }
}

export interface MatchStart {
  // The rung to start on, and the lean level with the matches played at it.
  index: number;
  lean: number;
  played: number;
}

// Where a match starts: the step its last one left, on a screen with the
// same top, else the top; with its lean level.
export function matchStart(memory: ModeMemory | undefined, rungs: readonly Rung[]): MatchStart {
  if (!memory) return { index: 0, lean: 0, played: 0 };
  const same = Math.abs(memory.top - rungs[0]!.ratio) < 0.001;
  return {
    index: same ? Math.min(memory.step, rungs.length - 1) : 0,
    lean: memory.lean,
    played: memory.played,
  };
}

export interface MatchQuality {
  rungs: readonly Rung[];
  // The milliseconds judged on each rung (quality_ladder.ts spentMs).
  spentMs: readonly number[];
  // How it started.
  start: MatchStart;
}

// What a match leaves for the next one of its kind: the same however often
// it is saved along the way. A match not judged at all leaves the memory
// as it found it.
export function afterMatch(m: MatchQuality): ModeMemory {
  const top = m.rungs[0]!.ratio;
  const { index, lean, played } = m.start;
  const judged = m.spentMs.reduce((a, b) => a + b, 0);
  if (!(judged > 0)) return { top, step: index, lean, played };
  // The rung it spent most of its judged time on, the finer of two alike.
  let step = 0;
  for (let i = 1; i < m.spentMs.length; i++) if (m.spentMs[i]! > m.spentMs[step]!) step = i;
  const below = judged - (m.spentMs[0] ?? 0);
  if (2 * below > judged && lean < LEANEST) return { top, step, lean: lean + 1, played: 0 };
  if (played + 1 >= RETRY_MATCHES && lean > 0) return { top, step, lean: lean - 1, played: 0 };
  return { top, step, lean, played: Math.min(played + 1, RETRY_MATCHES) };
}
