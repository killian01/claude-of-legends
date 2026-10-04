// The royale bot's calls (src/sim/royale/bot/brain.ts): somewhere to go
// when no enemy is in sight, read off the public observation only (a
// Seedfall, an ambush beside it, a Clamor; a Rising and a mark later).
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
  CALL_HP,
  CALL_WALK_SPEED,
  CLAMOR_ALIVE,
  CLAMOR_HP,
  CLAMOR_PHASE,
  ERRAND_HP,
  SEEDFALL_LATE_S,
} from '../../content/bots/royale_skills';
import { dist, type Vec3 } from '../../geo';
import type { ObsSeedfall, ObsUnit } from '../../policy';
import { insideCap } from '../dusk';
import { CLAMOR_S } from '../types';
import { p3, type Sense } from './sense';

// A call's goal: a point to walk to, and why. An ambush names the
// champion it strikes, or none while it waits at the point (the bush).
export interface RoyaleCall {
  kind: 'seedfall' | 'ambush' | 'clamor' | 'rising' | 'mark';
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

// The call that applies to this slot, or null: the ambush, the Seedfall,
// the Clamor, the first that applies. Only at CALL_HP of health or more.
export function royaleCall(sense: Sense): RoyaleCall | null {
  if (sense.s.hpFrac < CALL_HP) return null;
  return ambushCall(sense) ?? seedfallCall(sense) ?? clamorCall(sense);
}
