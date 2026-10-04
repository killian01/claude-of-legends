// The marks (CONTEXT.md: Lodestar, Ablaze, Wrath): the champions shown to
// everyone on the globe, why, and the last point shown, each show lasting
// MARK_SHOWN_S. The Lodestar is the champion everyone steers by (Respawn's
// score leader once it counts LODESTAR_RESPAWN_SCORE, One life's most
// takedowns from the Dusk's second closing); Ablaze, a long run of
// takedowns (the ABLAZE_TOP longest only); the Wrath's holder; the slayer of
// a big creature, once. The rules are pure over the standings and the
// units; the mode drives them from stepAfterDeaths and pays a takedown on a
// mark from onDeath (markPayout).

import {
  ABLAZE_EVERY_S,
  ABLAZE_RUN,
  ABLAZE_TOP,
  LODESTAR_EVERY_S,
  LODESTAR_ONE_LIFE_PHASE,
  LODESTAR_ONE_LIFE_SCORE,
  LODESTAR_PIECES,
  LODESTAR_RESPAWN_SCORE,
  LODESTAR_RUNAWAY,
  LODESTAR_RUNAWAY_EVERY_S,
  SNUFF_MAX_PIECES,
  SNUFF_RESPAWN_SCORE,
  SNUFF_RUN_PER_PIECE,
  WRATH_EVERY_S,
} from '../content/royale_events';
import type { Vec3 } from '../geo';
import type { ObsMark, ObsRoyale } from '../policy';
import type { Sim } from '../sim';
import type { Unit } from '../unit';
import type { RoyaleMode } from './mode';
import { leaderOf, type Standing } from './score';
import {
  LEADER_TAKEDOWN_SCORE,
  MARK_SHOWN_S,
  type MarkKind,
  type MarkState,
  type RoyaleVariant,
} from './types';

const EPS = 1e-9;

// A seat as the marks read it: its standing, whether it stands, its run.
export interface MarkSeat extends Standing {
  alive: boolean;
  streak: number;
}

// The Lodestar (pure), or null: Respawn's score leader with
// LODESTAR_RESPAWN_SCORE or more; One life's, from the Dusk's
// LODESTAR_ONE_LIFE_PHASE, the champion still standing with the most
// takedowns, LODESTAR_ONE_LIFE_SCORE or more, the lower id on a tie.
export function lodestarOf(
  variant: RoyaleVariant,
  seats: readonly MarkSeat[],
  duskPhase: number,
): number | null {
  if (variant === 'respawn') {
    const id = leaderOf(seats);
    const s = id !== null ? seats.find((x) => x.id === id) : undefined;
    return s && s.score >= LODESTAR_RESPAWN_SCORE ? s.id : null;
  }
  if (duskPhase < LODESTAR_ONE_LIFE_PHASE) return null;
  let best: MarkSeat | null = null;
  for (const s of seats) {
    if (!s.alive || s.score < LODESTAR_ONE_LIFE_SCORE) continue;
    if (!best || s.score > best.score || (s.score === best.score && s.id < best.id)) best = s;
  }
  return best ? best.id : null;
}

// How far the Lodestar leads the next best seat.
export function lodestarLead(seats: readonly MarkSeat[], lodestarId: number): number {
  const own = seats.find((s) => s.id === lodestarId)?.score ?? 0;
  let next = 0;
  for (const s of seats) if (s.id !== lodestarId && s.score > next) next = s.score;
  return own - next;
}

// The Ablaze runs (pure): the champions standing on a run of ABLAZE_RUN or
// more takedowns, the ABLAZE_TOP longest, the lower id on a tie.
export function ablazeRuns(
  variant: RoyaleVariant,
  seats: readonly MarkSeat[],
): { id: number; streak: number }[] {
  return seats
    .filter((s) => s.alive && s.streak >= ABLAZE_RUN[variant])
    .sort((a, b) => b.streak - a.streak || a.id - b.id)
    .slice(0, ABLAZE_TOP)
    .map((s) => ({ id: s.id, streak: s.streak }));
}

// How often a mark is shown again: the Lodestar every LODESTAR_EVERY_S, or
// LODESTAR_RUNAWAY_EVERY_S while it leads by LODESTAR_RUNAWAY; an Ablaze
// every ABLAZE_EVERY_S; the Wrath every WRATH_EVERY_S; a slayer once.
export function markEvery(kind: MarkKind, lead = 0): number {
  if (kind === 'lodestar') {
    return lead >= LODESTAR_RUNAWAY ? LODESTAR_RUNAWAY_EVERY_S : LODESTAR_EVERY_S;
  }
  if (kind === 'ablaze') return ABLAZE_EVERY_S;
  if (kind === 'wrath') return WRATH_EVERY_S;
  return Number.POSITIVE_INFINITY;
}

// Whether a mark is on the globe at `time`: for MARK_SHOWN_S after a show.
export function markShown(m: Pick<MarkState, 'shownAt'>, time: number): boolean {
  return time - m.shownAt <= MARK_SHOWN_S + EPS;
}

// What a takedown on a marked champion pays its last hit (pure): the score
// (LEADER_TAKEDOWN_SCORE on the Lodestar, and in Respawn SNUFF_RESPAWN_SCORE
// more on an Ablaze), the pieces beyond the takedown's own (LODESTAR_PIECES
// on the Lodestar; on an Ablaze 1 + floor(run / SNUFF_RUN_PER_PIECE), at
// most SNUFF_MAX_PIECES), and the run snuffed out, if any.
export interface MarkPayout {
  score: number;
  pieces: number;
  snuffed: number | null;
}

export function markPayout(
  variant: RoyaleVariant,
  lodestar: boolean,
  ablazeRun: number | null,
): MarkPayout {
  let score = lodestar ? LEADER_TAKEDOWN_SCORE : 1;
  let pieces = lodestar ? LODESTAR_PIECES : 0;
  if (ablazeRun !== null) {
    pieces += Math.min(SNUFF_MAX_PIECES, 1 + Math.floor(ablazeRun / SNUFF_RUN_PER_PIECE));
    if (variant === 'respawn') score += SNUFF_RESPAWN_SCORE;
  }
  return { score, pieces, snuffed: ablazeRun };
}

export function markOf(marks: readonly MarkState[], unitId: number, kind: MarkKind) {
  return marks.find((m) => m.unitId === unitId && m.kind === kind) ?? null;
}

function posOf(u: Unit): Vec3 | null {
  return u.pos.y !== undefined ? { x: u.pos.x, y: u.pos.y, z: u.pos.z } : null;
}

// A new mark, shown at once, and told to everyone (except a passing Wrath,
// whose own event tells it: risings.ts wrathOnDeath).
function addMark(
  mode: RoyaleMode,
  sim: Sim,
  u: Unit,
  kind: MarkKind,
  tell: boolean,
  streak?: number,
): void {
  const at = posOf(u) ?? { x: 0, y: 0, z: 0 };
  const m: MarkState = { unitId: u.id, kind, at, shownAt: sim.time };
  if (streak !== undefined) m.streak = streak;
  mode.state.marks.push(m);
  if (tell) sim.pushEvent({ type: 'royale_mark', unitId: u.id, kind });
}

// The slayer of a big creature: shown to everyone once, for MARK_SHOWN_S
// (the mode's onDeath, the creature branch).
export function markSlayer(mode: RoyaleMode, sim: Sim, u: Unit): void {
  addMark(mode, sim, u, 'slayer', true);
}

export function markSeats(mode: RoyaleMode, sim: Sim): MarkSeat[] {
  const out: MarkSeat[] = [];
  for (const u of sim.units.values()) {
    if (u.kind !== 'champion') continue;
    out.push({
      id: u.id,
      score: mode.state.scores.get(u.id) ?? 0,
      deaths: u.deaths,
      alive: !u.dead,
      streak: u.killStreak,
    });
  }
  return out;
}

// One tick of the marks after the deaths: who is marked (the Lodestar, the
// Ablaze runs, the Wrath's holder; a slayer's show run out), each new one
// shown at once, each due one shown again where its champion stands (never
// while it is dead), and a shown one's point kept on its champion until the
// show ends. Respawn's leader is kept beside it, shown with the Lodestar.
export function stepMarks(mode: RoyaleMode, sim: Sim): void {
  const s = mode.state;
  if (s.stage !== 'play') return;
  const time = sim.time;
  const seats = markSeats(mode, sim);
  if (mode.variant === 'respawn') s.leaderId = leaderOf(seats);
  const lodestar = lodestarOf(mode.variant, seats, s.dusk.phase);
  const runs = ablazeRuns(mode.variant, seats);
  const holder = s.wrathHolder ? s.wrathHolder.unitId : null;
  const wanted = (m: MarkState): boolean => {
    if (m.kind === 'lodestar') return m.unitId === lodestar;
    if (m.kind === 'wrath') return m.unitId === holder;
    if (m.kind === 'ablaze') return runs.some((r) => r.id === m.unitId);
    return markShown(m, time);
  };
  const passing = s.marks.some((m) => m.kind === 'wrath' && m.unitId !== holder);
  s.marks = s.marks.filter(wanted);
  const unit = (id: number) => sim.units.get(id);
  if (lodestar !== null && !s.marks.some((m) => m.kind === 'lodestar')) {
    const u = unit(lodestar);
    if (u) addMark(mode, sim, u, 'lodestar', true);
  }
  if (holder !== null && !s.marks.some((m) => m.kind === 'wrath')) {
    const u = unit(holder);
    if (u) addMark(mode, sim, u, 'wrath', !passing);
  }
  for (const r of runs) {
    const m = markOf(s.marks, r.id, 'ablaze');
    if (m) m.streak = r.streak;
    else {
      const u = unit(r.id);
      if (u) addMark(mode, sim, u, 'ablaze', true, r.streak);
    }
  }
  const lead = lodestar !== null ? lodestarLead(seats, lodestar) : 0;
  for (const m of s.marks) {
    const u = unit(m.unitId);
    if (!u || u.dead) continue;
    const p = posOf(u);
    if (!p) continue;
    if (time - m.shownAt >= markEvery(m.kind, lead) - EPS) m.shownAt = time;
    if (markShown(m, time)) m.at = p;
  }
  const lode = s.marks.find((m) => m.kind === 'lodestar');
  if (lode && lode.unitId === s.leaderId) s.leaderShownAt = lode.shownAt;
}

// The marks as everyone sees them (ObsRoyale.marks): each champion marked,
// why, its run, its level, and the last point shown with when (held still
// while hidden).
export function observeMarks(mode: RoyaleMode, sim: Sim, _u: Unit): Pick<ObsRoyale, 'marks'> {
  const out: ObsMark[] = [];
  for (const m of mode.state.marks) {
    const o: ObsMark = {
      id: m.unitId,
      kind: m.kind,
      level: sim.units.get(m.unitId)?.level ?? 1,
      at: { x: m.at.x, y: m.at.y, z: m.at.z },
      shownAt: m.shownAt,
    };
    if (m.streak !== undefined) o.streak = m.streak;
    out.push(o);
  }
  return { marks: out };
}
