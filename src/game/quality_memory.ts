// What a browser remembers of how finely it drew its last match of each
// kind, so the next one starts near there instead of at the top and
// relearns little (quality_ladder.ts). Kept in the browser's own storage
// under one key, never sent anywhere (PRIVACY.md); a browser that keeps
// nothing starts every match at the top, as before.
//
// The step is kept as rungs below the device's own ratio, with that
// ratio: a screen with another (a zoom, another monitor) starts at its
// top, the steps having been another screen's. And it gives way: the next
// match starts a rung above where the last one settled, unless that one
// kept a step down (the ladder keeps one only for a clear gain), so a
// machine that could draw finer is never held low by its memory.
//
// It also carries what only a new WebGL context can change, the lean
// level. A match that kept a step down and stayed below the top, ending
// there or spending most of its time there, makes the next one leaner:
// first without the effects' lights (three pooled point lights every lit
// pixel of the ground shades, at intensity 0 while no spell flashes: the
// frame drawn in 0.63 of the time on the Star Orchard and 0.80 on the
// planet without them, for a flash that no longer lights the ground), then,
// when one still had to go as far as its floor, without antialiasing as
// well (0.83 and 0.62 more, for jagged edges). A match that ended at the
// top gives a level back: a slowdown stepped down for and climbed back
// from leaves nothing.

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

// A match judged this long tells whether it could have drawn finer; a
// shorter one changes nothing, unless it kept a step down.
export const TOLD_MS = 120_000;

export interface ModeMemory {
  // The device's own ratio, the top of its ladder.
  top: number;
  // The rung to start the next match on, counted from the top.
  step: number;
  // The lean level for the next match.
  lean: number;
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
  const { top, step, lean } = o;
  if (typeof top !== 'number' || !(top >= 0.25 && top <= 4)) return null;
  if (!whole(step, 16) || !whole(lean, LEANEST)) return null;
  return { top, step, lean };
}

function whole(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
}

// A stored line read back: anything broken or out of range is dropped,
// never trusted.
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

// Where a match starts: the step its last one left, on a screen with the
// same top, else the top; with its lean level.
export function matchStart(
  memory: ModeMemory | undefined,
  rungs: readonly Rung[],
): { index: number; lean: number } {
  if (!memory) return { index: 0, lean: 0 };
  const same = Math.abs(memory.top - rungs[0]!.ratio) < 0.001;
  return { index: same ? Math.min(memory.step, rungs.length - 1) : 0, lean: memory.lean };
}

export interface MatchQuality {
  rungs: readonly Rung[];
  // The rung it stands on outside a trial, and the deepest a step down
  // kept (null when none did).
  settled: number;
  deepest: number | null;
  // How long it was judged, and how much of that below the top.
  judgedMs: number;
  belowMs: number;
  // The lean level it was made with.
  lean: number;
}

// What a match leaves for the next one of its kind: the same however often
// it is saved along the way.
export function afterMatch(m: MatchQuality): ModeMemory {
  // The floor's rung (the last but one), or the shadows' on a ladder that
  // has nothing else.
  const floor = Math.max(1, m.rungs.length - 2);
  const kept = m.deepest !== null;
  let step = m.settled;
  let lean = m.lean;
  if (kept && (m.settled > 0 || 2 * m.belowMs > m.judgedMs)) {
    // Slow: leaner next time (which buys about a rung), past the lights
    // only when the floor was reached.
    if (lean < LEANEST && (lean === 0 || (m.deepest ?? 0) >= floor)) {
      lean++;
      step = Math.max(0, step - 1);
    }
  } else if (m.judgedMs >= TOLD_MS) {
    // Nothing kept: a rung higher next time. Ended at the top: a level
    // back.
    if (!kept) step = Math.max(0, step - 1);
    if (m.settled === 0) lean = Math.max(0, lean - 1);
  }
  return { top: m.rungs[0]!.ratio, step, lean };
}
