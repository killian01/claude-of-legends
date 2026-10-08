// The royale bot's calls (src/sim/royale/bot/brain.ts): somewhere to go
// when no enemy is in sight, read off the observation only (a Seedfall,
// an ambush beside it, a Clamor, a Rising, the carrier of its own Burr, a
// mark).
// No memory beyond the observation; the first call that applies wins. The
// brain consults them after the Dusk's walk and before the plain caches,
// only with the bot's health at CALL_HP or more, and the ambush also
// inside a fight: a bot waiting in a bush holds there with the opener in
// sight. Respawn's Seedfall errand is the Seedfall call from ERRAND_HP,
// also inside a fight the bot did not strike in. Radii and clocks are
// data (content/bots/royale_skills.ts).

import {
  AMBUSH_REACH_M,
  AMBUSH_SEED_M,
  AMBUSH_STRIKE_HP,
  AMBUSH_WAIT_S,
  BURR_CALL_M,
  CALL_HP,
  CALL_WALK_SPEED,
  CLAMOR_ALIVE,
  CLAMOR_HP,
  CLAMOR_PHASE,
  ERRAND_HP,
  MARK_CALL_M,
  MARK_FRESH_S,
  RISING_CALL_M,
  RISING_DARK_BURN,
  RISING_DARK_HP,
  RISING_DARK_M,
  RISING_HP,
  RISING_LEAD_S,
  RISING_LEVEL,
  SEEDFALL_LATE_S,
  STEAL_BODY_HP,
  STEAL_M,
  WARY_M,
  WARY_STEP_M,
} from '../../content/bots/royale_skills';
import { dirTo, dist, type Vec3 } from '../../geo';
import type { ObsMark, ObsRising, ObsSeedfall, ObsUnit } from '../../policy';
import { depthInside, insideCap } from '../dusk';
import { along } from '../layout';
import { CLAMOR_S } from '../types';
import { strength } from './fight';
import { p3, type Sense } from './sense';

// A call's goal: a point to walk to, and why. An ambush names the
// champion it strikes, or none while it waits at the point (the bush).
export interface RoyaleCall {
  kind: 'seedfall' | 'ambush' | 'clamor' | 'rising' | 'burr' | 'mark' | 'wary';
  x: number;
  y: number;
  z: number;
  seedfallId?: number;
  strike?: ObsUnit | null;
}

function callAt(kind: RoyaleCall['kind'], p: Vec3, extra: Partial<RoyaleCall> = {}): RoyaleCall {
  return { kind, x: p.x, y: p.y, z: p.z, ...extra };
}

// The Seedfalls this bot hears: within its skill's reach, not yet opened.
function heard(sense: Sense): ObsSeedfall[] {
  const reach = sense.skill.seedfallM;
  if (reach <= 0) return [];
  return (sense.r.seedfalls ?? []).filter((sf) => dist(sense.me, p3(sf)) <= reach);
}

// Whether the bot sets off for a Seedfall now: while the walk there takes
// no longer than the time to its landing plus SEEDFALL_LATE_S (it arrives
// no later than that after the landing), and any time after the landing
// while its cache stands.
export function leavesFor(sense: Sense, sf: ObsSeedfall): boolean {
  if (sf.landed) return true;
  const walk = dist(sense.me, p3(sf)) / CALL_WALK_SPEED;
  return walk <= sf.landsAt - sense.obs.time + SEEDFALL_LATE_S + 1e-9;
}

// The Seedfall call: the nearest heard Seedfall the bot sets off for.
export function seedfallCall(sense: Sense): RoyaleCall | null {
  let best: ObsSeedfall | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const sf of heard(sense)) {
    if (!leavesFor(sense, sf)) continue;
    const d = dist(sense.me, p3(sf));
    if (d < bestD || (d === bestD && best !== null && sf.id < best.id)) {
      best = sf;
      bestD = d;
    }
  }
  return best ? callAt('seedfall', p3(best), { seedfallId: best.id }) : null;
}

// The nearest bush to the bot within AMBUSH_REACH_M of the point, out of
// the impact's reach, or null.
export function ambushBush(sense: Sense, seed: Vec3): Vec3 | null {
  let best: Vec3 | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const b of sense.layout.bushes ?? []) {
    const fromSeed = dist(b.at, seed);
    if (fromSeed > AMBUSH_REACH_M || fromSeed < AMBUSH_SEED_M) continue;
    if (sense.now.radius > 0 && !insideCap(sense.now, b.at)) continue;
    const d = dist(sense.me, b.at);
    if (d < bestD) {
      best = b.at;
      bestD = d;
    }
  }
  return best;
}

// The ambush: a bot that reached a Seedfall it hears (within
// AMBUSH_REACH_M) and finds another champion within AMBUSH_SEED_M of the
// point, or its opening under way, waits in the nearest bush and strikes
// when the opening starts, when the champion it waits on falls under
// AMBUSH_STRIKE_HP, or AMBUSH_WAIT_S past the landing; with no bush, at
// once. The opener is struck first.
export function ambushCall(sense: Sense): RoyaleCall | null {
  const me = sense.s.id;
  for (const sf of heard(sense)) {
    const seed = p3(sf);
    if (dist(sense.me, seed) > AMBUSH_REACH_M) continue;
    const opener = sf.opener && sf.opener.id !== me ? sf.opener : null;
    const openerUnit = opener ? (sense.enemies.find((e) => e.id === opener.id) ?? null) : null;
    let near: ObsUnit | null = null;
    for (const e of sense.enemies) {
      if (dist(p3(e), seed) > AMBUSH_SEED_M) continue;
      if (!near || dist(p3(e), seed) < dist(p3(near), seed)) near = e;
    }
    const target = openerUnit ?? near;
    if (!target) continue;
    const bush = ambushBush(sense, seed);
    const late = sense.obs.time >= sf.landsAt + AMBUSH_WAIT_S - 1e-9;
    const strike = openerUnit !== null || target.hpFrac < AMBUSH_STRIKE_HP || late || !bush;
    if (strike) return callAt('ambush', p3(target), { seedfallId: sf.id, strike: target });
    return callAt('ambush', bush, { seedfallId: sf.id, strike: null });
  }
  return null;
}

// Respawn's Seedfall errand: the Seedfall call for a bot with ERRAND_HP
// of its health or more, in Respawn only (the brain walks it past the
// fights it did not strike in). Null otherwise.
export function seedfallErrand(sense: Sense): RoyaleCall | null {
  if (sense.r.variant !== 'respawn' || sense.s.hpFrac < ERRAND_HP) return null;
  return seedfallCall(sense);
}

// Whether One life's Clamor draws the packs yet: from the Dusk's
// CLAMOR_PHASE, or once CLAMOR_ALIVE or fewer are left. Never in Respawn,
// where a takedown rings out every half second.
export function clamorsHeard(sense: Sense): boolean {
  const r = sense.r;
  return r.variant === 'one_life' && (r.dusk.phase >= CLAMOR_PHASE || r.alive <= CLAMOR_ALIVE);
}

// A Clamor this close rang out where the bot stands.
export const CLAMOR_HERE_M = 4;

// The Clamor call: the nearest takedown that rang out within the skill's
// reach in the last CLAMOR_S, in the light, for a bot at CLAMOR_HP or more.
export function clamorCall(sense: Sense): RoyaleCall | null {
  const reach = sense.skill.clamorM;
  if (reach <= 0 || !clamorsHeard(sense) || sense.s.hpFrac < CLAMOR_HP) return null;
  let best: Vec3 | null = null;
  let bestD = reach;
  for (const c of sense.r.clamors ?? []) {
    if (sense.obs.time - c.at >= CLAMOR_S) continue;
    const at = p3(c);
    if (sense.now.radius > 0 && !insideCap(sense.now, at)) continue;
    const d = dist(sense.me, at);
    // Its own takedown is where it stands.
    if (d < CLAMOR_HERE_M) continue;
    if (d <= bestD) {
      best = at;
      bestD = d;
    }
  }
  return best ? callAt('clamor', best) : null;
}

// Whether the bot takes on a big body (a Rising standing): a skill that
// takes the creatures at RISING_LEVEL or more, with `hp` of its own health;
// any skill to steal one under STEAL_BODY_HP.
export function takesBody(sense: Sense, bodyHpFrac: number, hp: number): boolean {
  if (bodyHpFrac < STEAL_BODY_HP) return true;
  return sense.skill.creatures && sense.s.level >= RISING_LEVEL && sense.s.hpFrac >= hp;
}

// Whether a big body's site is in reach of the bot's errand: in the light,
// or past its edge by RISING_DARK_M at most while the dark burns
// RISING_DARK_BURN or less and the bot keeps RISING_DARK_HP of its health.
export function risingReachable(sense: Sense, at: Vec3): boolean {
  const now = sense.now;
  if (now.radius <= 0) return false;
  if (insideCap(now, at)) return true;
  return (
    sense.r.dusk.burn <= RISING_DARK_BURN + 1e-9 &&
    depthInside(now, at) >= -RISING_DARK_M &&
    sense.s.hpFrac >= RISING_DARK_HP
  );
}

// The Rising call: the nearest Rising in reach the bot answers, a
// creature-taking skill at RISING_LEVEL and RISING_HP within RISING_CALL_M
// from RISING_LEAD_S before it rises; any skill to a standing body under
// STEAL_BODY_HP within STEAL_M (the steal).
export function risingCall(sense: Sense): RoyaleCall | null {
  let best: ObsRising | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const r of sense.r.risings ?? []) {
    const at = p3(r);
    if (!risingReachable(sense, at)) continue;
    const d = dist(sense.me, at);
    const steal = r.up && r.hpFrac < STEAL_BODY_HP && d <= STEAL_M;
    const answer =
      d <= RISING_CALL_M &&
      sense.obs.time + 1e-9 >= r.risesAt - RISING_LEAD_S &&
      takesBody(sense, 1, RISING_HP);
    if (!steal && !answer) continue;
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best ? callAt('rising', p3(best)) : null;
}

// The bot's odds against a marked champion it cannot see (a mark, its
// Burr's carrier): its own health and level against the mark's level at
// full health.
export function markOdds(sense: Sense, m: Pick<ObsMark, 'level'>): number {
  const own = strength(sense.s.hpFrac, sense.s.level);
  const them = strength(1, m.level);
  return own + them > 0 ? own / (own + them) : 0.5;
}

function freshMarks(sense: Sense, within: number): ObsMark[] {
  const out: ObsMark[] = [];
  for (const m of sense.r.marks ?? []) {
    if (m.id === sense.s.id || sense.obs.time - m.shownAt > MARK_FRESH_S + 1e-9) continue;
    if (dist(sense.me, p3(m.at)) <= within) out.push(m);
  }
  return out;
}

// The hunt: the nearest mark shown in the last MARK_FRESH_S within
// MARK_CALL_M, in the light, for a creature-taking skill whose odds
// against it reach its nerve; to the point it was last shown.
export function markCall(sense: Sense, nerve: number): RoyaleCall | null {
  if (!sense.skill.creatures) return null;
  let best: ObsMark | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const m of freshMarks(sense, MARK_CALL_M)) {
    const at = p3(m.at);
    if (sense.now.radius > 0 && !insideCap(sense.now, at)) continue;
    if (markOdds(sense, m) < nerve) continue;
    const d = dist(sense.me, at);
    if (d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best ? callAt('mark', p3(best.at)) : null;
}

// The Burr's call: the carrier of the bot's own Burr where it stands,
// within BURR_CALL_M and in the light, for a creature-taking skill whose
// odds against it reach its nerve. Never past BURR_CALL_M: a Burr is a
// score to settle on the way, not a chase across the planet.
export function burrCall(sense: Sense, nerve: number): RoyaleCall | null {
  const b = sense.burr;
  if (!b?.at || !sense.skill.creatures) return null;
  const at = p3(b.at);
  if (sense.now.radius > 0 && !insideCap(sense.now, at)) return null;
  if (dist(sense.me, at) > BURR_CALL_M || markOdds(sense, b) < nerve) return null;
  return callAt('burr', at);
}

// A gentle bot's care: a mark shown in the last MARK_FRESH_S within WARY_M
// is walked away from, WARY_STEP_M, while that keeps it in the light.
export function waryCall(sense: Sense): RoyaleCall | null {
  if (sense.skill.creatures) return null;
  const near = freshMarks(sense, WARY_M).filter((m) => m.kind !== 'slayer');
  if (near.length === 0) return null;
  const from = p3(near[0]!.at);
  const dir = dirTo(from, sense.me);
  if (!dir) return null;
  const to = along(sense.me, dir as Vec3, WARY_STEP_M, sense.layout.radius);
  if (sense.now.radius > 0 && depthInside(sense.now, to) < 3) return null;
  return callAt('wary', to);
}

// The call that applies to this slot, or null: a gentle bot's care first,
// then the ambush, the Seedfall, the Clamor, a Rising, the Burr's carrier,
// the hunt of a mark, the first that applies. Only at CALL_HP of health or
// more, but the care.
export function royaleCall(sense: Sense, nerve = Number.POSITIVE_INFINITY): RoyaleCall | null {
  const wary = waryCall(sense);
  if (wary) return wary;
  if (sense.s.hpFrac < CALL_HP) return null;
  return (
    ambushCall(sense) ??
    seedfallCall(sense) ??
    clamorCall(sense) ??
    risingCall(sense) ??
    burrCall(sense, nerve) ??
    markCall(sense, nerve)
  );
}
