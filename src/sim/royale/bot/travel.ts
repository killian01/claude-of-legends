// Where the battle royale bot walks when it is not fighting: out of the
// dark first, ahead of the Dusk's next cap early (a launch pad when one is
// on the way and its throw shortens the trip), to the nearest standing
// cache inside the light no enemy will reach first, to a camp when nothing
// better is near, and otherwise a wander where it stands. Pure over the
// slot's sense; every distance a chord.

import { ROAM_GOAL_M, SEEDFALL_STANDOFF_M } from '../../content/bots/royale_skills';
import { dirTo, dist, heading, type Vec3 } from '../../geo';
import type { Action, ObsCache, ObsSeedfall } from '../../policy';
import { depthInside, insideCap } from '../dusk';
import { along } from '../layout';
import { padSaving } from '../pads';
import { CACHE_REACH_M, type DuskCap } from '../types';
import { p3, type Sense } from './sense';

// A walk re-issued only when the goal moved this much from where the
// current walk ends: an unchanged order would cost a path for nothing.
export const REORDER_M = 1.2;
// A pad is worth taking when it saves this many seconds.
export const PAD_WORTH_S = 4;
// How deep inside a cap the bot aims to stand when it heads for one.
export const SAFE_DEPTH_M = 5;
// How far the bot looks for a cache before it settles for a camp.
export const CACHE_NEAR_M = 30;
// How far it walks to a camp it believes up.
export const CAMP_NEAR_M = 32;

export function moveTo(sense: Sense, p: Vec3): Action {
  const dest = sense.s.dest;
  if (dest && dist(p3(dest), p) <= REORDER_M) return { kind: 'noop' };
  // Already there: hold. A walk to where the bot stands ends at once and
  // leaves it idle, and the sim's idle defense then strikes whoever comes
  // into reach: four fights in five began that way (a probe, 2026-10-03).
  if (!dest && dist(sense.me, p) <= ARRIVED_M) return holdStill(sense);
  return { kind: 'move', x: p.x, y: p.y, z: p.z };
}

// A goal this close is where the bot stands.
export const ARRIVED_M = 1;

// The point `depth` meters inside a cap along the way from the bot to its
// center (the center itself for a small cap).
export function intoCap(sense: Sense, cap: DuskCap, depth = SAFE_DEPTH_M): Vec3 {
  const d = dist(sense.me, cap.center);
  const want = cap.radius - depth;
  if (want <= 0 || d <= want) return cap.center;
  const dir = dirTo(sense.me, cap.center);
  if (!dir) return cap.center;
  return along(sense.me, dir as Vec3, d - want, sense.layout.radius);
}

// The pad that shortens the walk to `goal` the most, landing in the light,
// or null.
export function padOnTheWay(sense: Sense, goal: Vec3): Vec3 | null {
  let best: Vec3 | null = null;
  let bestSave = PAD_WORTH_S;
  for (const pad of sense.r.pads) {
    if (!insideCap(sense.now, pad.at) || !insideCap(sense.now, pad.to)) continue;
    if (sense.next && !insideCap(sense.next, pad.to) && insideCap(sense.next, goal)) continue;
    const save = padSaving({ id: pad.id, at: pad.at, to: pad.to }, sense.me, goal, sense.speed);
    if (save > bestSave) {
      best = pad.at;
      bestSave = save;
    }
  }
  return best;
}

export function walkVia(sense: Sense, goal: Vec3): Action {
  const pad = padOnTheWay(sense, goal);
  return moveTo(sense, pad ?? goal);
}

// Out of the dark: the shortest way back into the light, now.
export function leaveDark(sense: Sense): Action | null {
  const cap = sense.now;
  if (cap.radius <= 0) return moveTo(sense, cap.center);
  if (depthInside(cap, sense.me) >= 1) return null;
  return walkVia(sense, intoCap(sense, cap));
}

// Seconds until the light's edge reaches where the bot stands, as far as
// the schedule says: never while the light holds and the bot is inside the
// next cap.
export function secondsToDark(sense: Sense): number {
  const { r, obs } = sense;
  const next = sense.next;
  if (!next) return Number.POSITIVE_INFINITY;
  if (insideCap(next, sense.me) && depthInside(next, sense.me) > 2) {
    return Number.POSITIVE_INFINITY;
  }
  const untilChange = r.dusk.phaseEndsAt - obs.time;
  if (r.dusk.shrinking) {
    // The edge closes from where it is toward the next cap at about the
    // Dusk's pace: the bot's depth now over the closing's remaining time.
    const depth = depthInside(sense.now, sense.me);
    const shrinkLeft = sense.now.radius - next.radius;
    const pace = shrinkLeft > 0 ? shrinkLeft / Math.max(1, untilChange) : 0.74;
    return depth / Math.max(0.2, pace);
  }
  return untilChange;
}

// Ahead of the Dusk: toward the next cap once the walk there, with the
// skill's margin, takes about as long as the light will last here.
export function beatDusk(sense: Sense): Action | null {
  const next = sense.next;
  if (!next) return null;
  if (depthInside(next, sense.me) >= SAFE_DEPTH_M * 0.6) return null;
  const goal = intoCap(sense, next);
  const walk = dist(sense.me, goal) / Math.max(1, sense.speed);
  if (secondsToDark(sense) > walk + sense.skill.duskMargin) return null;
  return walkVia(sense, goal);
}

// Whether a point is a safe place to stand for a while: in the light now,
// and inside the next cap too once the Dusk is about to close on it.
function safeGround(sense: Sense, p: Vec3): boolean {
  if (!insideCap(sense.now, p) || depthInside(sense.now, p) < 2) return false;
  const next = sense.next;
  if (!next) return true;
  const soon = sense.r.dusk.shrinking || sense.r.dusk.phaseEndsAt - sense.obs.time < 25;
  return !soon || insideCap(next, p);
}

// The cache worth walking to: the nearest standing one on safe ground,
// golden ones counted closer, none an enemy in sight stands beside or
// will reach first. Racing every enemy to the same caches made the first
// minute of One life a massacre of half the field.
export function pickCache(sense: Sense, within = Number.POSITIVE_INFINITY): ObsCache | null {
  let best: ObsCache | null = null;
  let bestD = within;
  for (const c of sense.r.caches) {
    if (!safeGround(sense, c)) continue;
    const mine = dist(sense.me, c);
    const d = c.golden ? mine - 10 : mine;
    if (d >= bestD) continue;
    if (sense.enemies.some((e) => dist(p3(e), c) < Math.max(3, mine))) continue;
    best = c;
    bestD = d;
  }
  return best;
}

// Looting: standing still beside a cache opens it; walking there first.
export function lootCache(sense: Sense, cache: ObsCache): Action {
  const d = dist(sense.me, cache);
  if (d <= CACHE_REACH_M - 0.45) return holdStill(sense);
  return walkVia(sense, { x: cache.x, y: cache.y, z: cache.z });
}

// The camp spot worth walking to: the nearest the bot's own memory does not
// hold empty, on safe ground, within reach.
export function pickCampSpot(sense: Sense): Vec3 | null {
  let best: Vec3 | null = null;
  let bestD = CAMP_NEAR_M;
  const camps = sense.obs.camps ?? [];
  for (const c of camps) {
    const at = p3(c);
    if (!safeGround(sense, at)) continue;
    if (c.up === false && c.downSince !== null && sense.obs.time - c.downSince < 85) continue;
    const d = dist(sense.me, at);
    if (d < bestD) {
      best = at;
      bestD = d;
    }
  }
  return best;
}

// Holding still where the bot stands: a stop when it is walking or not yet
// holding. The stop holds its fire too (the sim's idle defense strikes
// any enemy that walks into reach of a champion standing idle): a bot
// opening a cache that struck every passer-by started half the first
// minute's fights, and broke its own opening doing it.
export function holdStill(sense: Sense): Action {
  return sense.s.dest || sense.s.holding !== true ? { kind: 'stop' } : { kind: 'noop' };
}

// Toward a Seedfall: before it lands, to a point SEEDFALL_STANDOFF_M off
// it on the bot's side, out of the impact's reach, and held there; once
// landed, to its cache (`cache`, when the observation shows it) and opened.
export function approachSeedfall(sense: Sense, sf: ObsSeedfall, cache: ObsCache | null): Action {
  const seed = p3(sf);
  if (sf.landed) return cache ? lootCache(sense, cache) : moveTo(sense, seed);
  const d = dist(sense.me, seed);
  if (d <= SEEDFALL_STANDOFF_M + 1) {
    if (d >= SEEDFALL_STANDOFF_M - 1.5) return holdStill(sense);
  }
  const out = d > 1e-3 ? dirTo(seed, sense.me) : null;
  const spot = out ? along(seed, out as Vec3, SEEDFALL_STANDOFF_M, sense.layout.radius) : seed;
  return walkVia(sense, spot);
}

// A Seedfall's cache once it landed: the one the observation marks as a
// Seedfall's nearest the point, else any standing on the point.
export function seedfallCache(sense: Sense, sf: ObsSeedfall): ObsCache | null {
  let best: ObsCache | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of sense.r.caches) {
    const d = dist(p3(sf), c);
    if (c.kind !== 'seedfall' && d > SEEDFALL_CACHE_M) continue;
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

// A cache this close to a Seedfall's point is its cache, whatever its kind
// reads.
export const SEEDFALL_CACHE_M = 2.5;

// The nearest unopened Seedfall within `within`, or null.
export function nearestSeedfall(sense: Sense, within: number): ObsSeedfall | null {
  let best: ObsSeedfall | null = null;
  let bestD = within;
  for (const sf of sense.r.seedfalls ?? []) {
    const d = dist(sense.me, p3(sf));
    if (d >= bestD) continue;
    best = sf;
    bestD = d;
  }
  return best;
}

// How long a wandering bot keeps one way before it picks the next.
export const WANDER_S = 12;

// A number from 0 to 1 fixed by the seat and the stretch of time: a
// wander goal that holds still for WANDER_S without any memory.
function wanderDraw(id: number, time: number, salt: number): number {
  let h =
    (Math.imul(id, 0x9e3779b1) ^ Math.imul(Math.floor(time / WANDER_S) + salt, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  return h / 4294967296;
}

// How far a wandering bot walks from where it stands, at most.
export const WANDER_M = 11;

// The spot a point stands on, as a number: a 6 m lattice cell.
function cellOf(p: Vec3): number {
  const i = Math.floor(p.x / 6);
  const j = Math.floor(p.y / 6);
  const k = Math.floor(p.z / 6);
  return (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) >>> 0;
}

// With nothing else to do, the bot heads for the nearest unopened cache
// or Seedfall within ROAM_GOAL_M (anywhere while the whole planet is lit);
// with none, it wanders where it is, on safe ground, one leg of up to
// WANDER_M at a time, drawn by the seat, the stretch of time and the spot
// it stands on: the Dusk brings the field together. Every bot walking to
// the light's heart once the caches were gone made the second minute of
// One life a massacre; a wander beside a standing cache made bots that ran
// everywhere and went nowhere (a playtest, 2026-10-03).
export function roam(sense: Sense): Action {
  const cap = sense.next ?? sense.now;
  const whole = cap.radius >= 2 * sense.layout.radius - 1e-6;
  const c = pickCache(sense, whole ? Number.POSITIVE_INFINITY : ROAM_GOAL_M);
  if (c) return lootCache(sense, c);
  const sf = nearestSeedfall(sense, ROAM_GOAL_M);
  if (sf && safeGround(sense, p3(sf))) return approachSeedfall(sense, sf, seedfallCache(sense, sf));
  if (!safeGround(sense, sense.me)) return walkVia(sense, intoCap(sense, cap));
  const dest = sense.s.dest;
  if (dest && safeGround(sense, p3(dest)) && dist(sense.me, p3(dest)) <= WANDER_M * 1.5) {
    return { kind: 'noop' };
  }
  const R = sense.layout.radius;
  const salt = cellOf(sense.me);
  const angle = wanderDraw(sense.s.id, sense.obs.time, salt) * 2 * Math.PI;
  const reach = WANDER_M * (0.4 + 0.6 * wanderDraw(sense.s.id, sense.obs.time, salt + 1));
  const goal = along(sense.me, heading(sense.me, angle) as Vec3, reach, R);
  if (safeGround(sense, goal)) return moveTo(sense, goal);
  return walkVia(sense, intoCap(sense, cap));
}
