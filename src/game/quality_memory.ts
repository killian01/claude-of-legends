// What a browser remembers between matches of how finely it draws: only
// what a new WebGL context can change, the lean level, for each kind of
// match, with the matches played at it and the slow ones in a row, and the
// screen's refresh. Every match starts on the top rung of its ladder
// (quality_ladder.ts), whatever the last one did, so a step taken for a
// slowdown never carries over and a screen with another pixel ratio needs
// nothing of its own. Kept in the browser's own storage under one key,
// never sent anywhere (PRIVACY.md); a browser that keeps nothing starts
// every match with everything.
//
// The lean level is weighed on the top rung's own rate, which every match
// draws for its first judged seconds. A match judged two minutes, its
// settling aside, whose top windows (twenty seconds of them at least) drew
// under 0.6 of the target rate nine times in ten is slow: three fights in
// two minutes fill most of a capable machine's top windows. Two slow
// matches in a row make the next one leaner by a level, never one alone:
// first without the effects' lights (three pooled point lights every lit
// pixel of the ground shades: the frame drawn in 0.63 of the time on the
// Star Orchard and 0.80 on the planet without them, for a flash that no
// longer lights the ground), then without antialiasing as well (0.83 and
// 0.62 more, for jagged edges). Five matches at a level give one back, a
// retry whose match alone tells: a machine that still needs it leans again
// after that one match. Nothing else moves it.

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
// A match judged this long tells; its top judged this long at least, under
// this share of the target rate nine windows in ten, is slow.
export const EVIDENCE_MS = 100_000;
export const TOP_EVIDENCE_MS = 20_000;
export const LEAN_SHARE = 0.6;
// Slow matches in a row that lean the next one.
export const SLOW_MATCHES = 2;

export interface ModeMemory {
  // The lean level for the next match, the matches played at it, and the
  // slow ones in a row.
  lean: number;
  played: number;
  slow: number;
}

export interface QualityMemory {
  // The screen's rate, as best known.
  hz: number | null;
  modes: Partial<Record<LadderMode, ModeMemory>>;
}

const MODES: readonly LadderMode[] = ['classic', 'royale'];

function whole(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
}

// A line from before the slow matches were counted has none.
function modeOf(v: unknown): ModeMemory | null {
  if (typeof v !== 'object' || v === null) return null;
  const { lean, played, slow = 0 } = v as Record<string, unknown>;
  if (!whole(lean, LEANEST) || !whole(played, RETRY_MATCHES - 1)) return null;
  if (!whole(slow, SLOW_MATCHES - 1)) return null;
  return { lean, played, slow };
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
    // storage unavailable: the next match starts with everything
  }
}

export interface MatchQuality {
  // The memory the match was drawn with.
  start: ModeMemory;
  // Milliseconds judged in all and on the top rung, and the share of the
  // target rate nine in ten of the top's windows drew at most
  // (quality_ladder.ts).
  judgedMs: number;
  topMs: number;
  topShare: number | null;
}

// What a match leaves for the next one of its kind: the same however often
// it is saved along the way. A match judged too short to tell leaves the
// memory as it found it; one not slow starts the count of slow ones over.
export function afterMatch(m: MatchQuality): ModeMemory {
  const { lean, played, slow } = m.start;
  if (m.judgedMs < EVIDENCE_MS) return { lean, played, slow };
  const isSlow = m.topMs >= TOP_EVIDENCE_MS && m.topShare !== null && m.topShare < LEAN_SHARE;
  const run = isSlow ? Math.min(slow + 1, SLOW_MATCHES) : 0;
  if (run === SLOW_MATCHES && lean < LEANEST) return { lean: lean + 1, played: 0, slow: 0 };
  if (lean === 0) return { lean, played: 0, slow: run };
  // The retry: its match alone tells.
  if (played + 1 >= RETRY_MATCHES) return { lean: lean - 1, played: 0, slow: SLOW_MATCHES - 1 };
  return { lean, played: played + 1, slow: Math.min(run, SLOW_MATCHES - 1) };
}
