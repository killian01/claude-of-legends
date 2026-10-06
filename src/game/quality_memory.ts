// What a browser remembers of how finely it drew its last match of each
// kind, so the next one starts there instead of at the top and relearns
// nothing (quality_ladder.ts). Kept in the browser's own storage under one
// key, never sent anywhere (PRIVACY.md); a browser that keeps nothing
// starts every match at the top, as before.
//
// It also carries what only a new WebGL context can change, the lean
// level. A match whose ladder had to step down makes the next one leaner:
// first without the effects' lights (three pooled point lights every lit
// pixel of the ground shades, at intensity 0 while no spell flashes: the
// frame drawn in 0.63 of the time on the Star Orchard and 0.80 on the
// planet without them, for a flash that no longer lights the ground), then,
// when one still had to go as far as its floor, without antialiasing as
// well (0.83 and 0.62 more, for jagged edges). Three matches in a row held
// at the top on a lean level give one level back.

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

// A match judged this long at the top counts toward a level back.
export const QUIET_MS = 120_000;
// Matches in a row held at the top before a level is given back.
export const QUIET_MATCHES = 3;

export interface ModeMemory {
  // The rung its last match stood on.
  ratio: number;
  shadows: boolean;
  // The lean level for the next match, and how many matches in a row held
  // the top on it.
  lean: number;
  quiet: number;
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
  const { ratio, shadows, lean, quiet } = o;
  if (typeof ratio !== 'number' || !(ratio >= 0.25 && ratio <= 4)) return null;
  if (typeof shadows !== 'boolean') return null;
  if (typeof lean !== 'number' || !Number.isInteger(lean) || lean < 0 || lean > LEANEST)
    return null;
  if (typeof quiet !== 'number' || !Number.isInteger(quiet) || quiet < 0 || quiet > 100) {
    return null;
  }
  return { ratio, shadows, lean, quiet };
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

// Where a match starts: on the rung its last one stood on (the nearest
// one this screen has), with its lean level.
export function matchStart(
  memory: ModeMemory | undefined,
  rungs: readonly Rung[],
): { index: number; lean: number } {
  if (!memory) return { index: 0, lean: 0 };
  const last = rungs.length - 1;
  if (!memory.shadows) return { index: last, lean: memory.lean };
  let index = rungs.findIndex((r) => r.shadows && r.ratio <= memory.ratio + 0.001);
  if (index < 0) index = Math.max(0, last - 1);
  return { index, lean: memory.lean };
}

export interface MatchQuality {
  rungs: readonly Rung[];
  // The rung it stands on outside a trial, and the deepest a step down
  // kept (null when none did).
  settled: number;
  deepest: number | null;
  judgedMs: number;
  // The lean level it was made with.
  lean: number;
}

// What a match leaves for the next one of its kind, from what the browser
// remembered when it started (so saving it again later in the same match
// counts it once).
export function afterMatch(atStart: ModeMemory | undefined, m: MatchQuality): ModeMemory {
  // The floor's rung (the last but one), or the shadows' on a ladder that
  // has nothing else.
  const floor = Math.max(1, m.rungs.length - 2);
  let settled = m.settled;
  let lean = m.lean;
  const before = atStart?.lean === lean ? atStart.quiet : 0;
  let quiet = 0;
  if (m.deepest !== null) {
    // A step down kept: leaner next time (which buys about a rung), past
    // the lights only when the floor was reached.
    if (lean < LEANEST && (lean === 0 || m.deepest >= floor)) {
      lean++;
      settled = Math.max(0, settled - 1);
    }
  } else if (settled === 0 && lean > 0) {
    // At the top all along: a level back after enough such matches. One
    // too short to tell counts neither way.
    quiet = m.judgedMs >= QUIET_MS ? before + 1 : before;
    if (quiet >= QUIET_MATCHES) {
      lean--;
      quiet = 0;
    }
  }
  const rung = m.rungs[settled]!;
  return { ratio: rung.ratio, shadows: rung.shadows, lean, quiet };
}
