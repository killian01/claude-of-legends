// The bout errands (ADR 0035; docs/design/thornfray.md, How a bot plays a
// bout): what a kind's bots walk to once the fight is decided, one entry
// per errand, named by the kind's data (BoutBots.errand) and read off the
// observation alone. The brain (brain.ts) asks the kind's errand only after
// its whole fight block, where the planet's calls are asked: a bot with an
// enemy in sight decides that fight by its odds first, every time, and
// only a bot that passed on it walks on. In a bout the planet's Respawn
// Seedfall errand never runs, so no errand walks a bot past a fight. One
// rule is asked before the fight block, beside the held opening it begins
// (beginHeldOpening): a landed Seedfall's cache a step away, for a bot no
// enemy is striking. Numbers are data (content/bots/bout_skills.ts).

import {
  GLEAN_BESIDE_M,
  GLEAN_GOLDEN_M,
  GLEAN_LIT_MARGIN_S,
  GLEAN_SEEDFALL_M,
  GLEAN_STEP_IN_M,
} from '../../content/bots/bout_skills';
import type { BoutBots } from '../../content/bouts/types';
import { dist, type Vec3 } from '../../geo';
import type { Action, ObsCache, ObsSeedfall } from '../../policy';
import { cacheOpenS, cacheReachM, openingHeld } from '../caches';
import { depthInside, insideCap } from '../dusk';
import { p3, type Sense } from './sense';
import {
  approachSeedfall,
  holdStill,
  lootCache,
  moveTo,
  secondsToDarkAt,
  seedfallCache,
} from './travel';

// Whether the light holds a point for `seconds` more, as far as the
// schedule shows: in the light now, two meters deep, and still lit that
// long. What an errand's goal asks of its ground: the walk there, the
// opening and GLEAN_LIT_MARGIN_S. The planet's safe ground (travel.ts
// safeGround) asks the next cap of every goal from 25 s before a closing:
// with it in this one's place, a first burst's seed placed in the
// Thornyard's light past the next cap was walked to by nobody for a
// minute, and two bouts in twelve left a seed unopened at the clock
// (match seeds 1 to 12, bout 1 of a pool of Starglean alone).
export function litFor(sense: Sense, p: Vec3, seconds: number): boolean {
  if (!insideCap(sense.now, p) || depthInside(sense.now, p) < 2) return false;
  return secondsToDarkAt(sense, p) > seconds;
}

// Seconds of walking to `p` at the bot's own speed.
function walkS(sense: Sense, p: Vec3): number {
  return dist(sense.me, p) / Math.max(1, sense.speed);
}

// What an errand asks this slot: the action, and why (the report counts
// it; the bot never reads it).
export interface BoutErrand {
  why: string;
  action: Action;
}

export type BoutCall = (sense: Sense, bots: BoutBots) => BoutErrand | null;

// How many enemies in sight stand nearer a point than the bot: the bot's
// rank in the race to it as far as its own sight shows.
export function raceRank(sense: Sense, at: Vec3): number {
  const mine = dist(sense.me, at);
  let n = 0;
  for (const e of sense.enemies) if (dist(p3(e), at) < mine) n++;
  return n;
}

// The called Seedfall the bot races for, within `reach` and its seed lit
// until the bot would have opened it (litFor): the one it ranks best in
// the race to (raceRank), then the nearest, then the lower id; null when
// none. Held to the nearest alone, the eight crowded a burst's nearest
// seeds, and two bouts in twelve left its third unopened at the clock
// (the same twelve as litFor's); by the race, none.
export function calledSeedfall(sense: Sense, reach: number): ObsSeedfall | null {
  let best: ObsSeedfall | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestD = Number.POSITIVE_INFINITY;
  for (const sf of sense.r.seedfalls ?? []) {
    const at = p3(sf);
    const d = dist(sense.me, at);
    if (d > reach) continue;
    const wait = sf.landed ? 0 : sf.landsAt - sense.obs.time;
    const busyS = Math.max(walkS(sense, at), wait) + cacheOpenS({ kind: 'seedfall' });
    if (!litFor(sense, at, busyS + GLEAN_LIT_MARGIN_S)) continue;
    const rank = raceRank(sense, at);
    const better =
      rank < bestRank ||
      (rank === bestRank && (d < bestD || (d === bestD && best !== null && sf.id < best.id)));
    if (!better) continue;
    best = sf;
    bestRank = rank;
    bestD = d;
  }
  return best;
}

// How much nearer a cache weighs by what it counts: a golden one
// GLEAN_GOLDEN_M, a Seedfall's GLEAN_SEEDFALL_M.
function cacheWorthM(c: ObsCache): number {
  if (c.kind === 'seedfall') return GLEAN_SEEDFALL_M;
  return c.golden ? GLEAN_GOLDEN_M : 0;
}

// The cache the glean errand walks to: the nearest standing one within
// `reach`, lit until the bot would have opened it (litFor), weighed by
// what it counts, none an enemy in sight stands within GLEAN_BESIDE_M of;
// an enemy farther off is raced for it. Null when none.
export function gleanCache(sense: Sense, reach: number): ObsCache | null {
  let best: ObsCache | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of sense.r.caches) {
    const mine = dist(sense.me, c);
    if (mine > reach) continue;
    const busyS = walkS(sense, c) + cacheOpenS({ kind: c.kind ?? 'plain' });
    if (!litFor(sense, c, busyS + GLEAN_LIT_MARGIN_S)) continue;
    const d = mine - cacheWorthM(c);
    if (d > bestD || (d === bestD && best !== null && c.id > best.id)) continue;
    if (sense.enemies.some((e) => dist(p3(e), c) <= GLEAN_BESIDE_M)) continue;
    best = c;
    bestD = d;
  }
  return best;
}

// Starglean's errand: from the kind's health floor, to the nearest called
// Seedfall within its reach (the whole Thornyard), standing off its impact
// until it lands, then its cache; else to the nearest cache worth taking
// (gleanCache). Under the floor, none: the brain's own loot and its odds
// decide, as ever. A Seedfall cache's opening, once begun, is held by the
// brain's held opening (brain.ts heldOpening), Respawn's own rule.
export function gleanCall(sense: Sense, bots: BoutBots): BoutErrand | null {
  if (sense.s.hpFrac < bots.floor) return null;
  const sf = calledSeedfall(sense, bots.reach);
  if (sf) {
    return { why: 'glean-seedfall', action: approachSeedfall(sense, sf, seedfallCache(sense, sf)) };
  }
  const c = gleanCache(sense, bots.reach);
  return c ? { why: 'glean-cache', action: lootCache(sense, c) } : null;
}

// How far inside a cache's reach the bot must stand to begin it.
export const BEGIN_REACH_SLACK_M = 0.3;

// The held opening begun (docs/design/thornfray.md: a bot holds a Seedfall
// cache's opening as the held opening allows): in a bout, a bot no enemy
// struck in the last two seconds, within GLEAN_STEP_IN_M of a landed
// Seedfall's cache whose opening is held (Respawn's, caches.ts
// openingHeld) and that no other champion opens as far as it sees, steps
// into its reach and holds still there to begin it. Begun, it is the
// brain's held opening (brain.ts heldOpening): it never changes hands while
// the bot keeps the reach, and the bot hits back from there at whoever
// strikes it. Asked before the fight block like the held opening; a bot
// struck answers first. Without it the champions at a landed seed fought
// and chased each other around it, one seed for fifty seconds, and nine
// bouts in twelve left a seed unopened at the clock (the same twelve as
// litFor's); with it, none.
export function beginHeldOpening(sense: Sense): BoutErrand | null {
  const r = sense.r;
  if (!sense.bout || r.opening || sense.struck) return null;
  let best: ObsCache | null = null;
  let bestD = GLEAN_STEP_IN_M;
  for (const sf of r.seedfalls ?? []) {
    if (!sf.landed || (sf.opener && sf.opener.id !== sense.s.id)) continue;
    const c = seedfallCache(sense, sf);
    if (!c || !openingHeld({ kind: c.kind ?? 'seedfall' }, r.variant)) continue;
    const d = dist(sense.me, c);
    if (d > bestD || (d === bestD && best !== null && c.id > best.id)) continue;
    if (!litFor(sense, c, walkS(sense, c) + cacheOpenS({ kind: 'seedfall' }))) continue;
    best = c;
    bestD = d;
  }
  if (!best) return null;
  if (bestD <= cacheReachM({ kind: 'seedfall' }) - BEGIN_REACH_SLACK_M) {
    return { why: 'begin-opening', action: holdStill(sense) };
  }
  return { why: 'step-in', action: moveTo(sense, p3(best)) };
}

// Every errand a kind may name, by its id.
export const BOUT_CALLS: Readonly<Record<string, BoutCall>> = {
  glean: gleanCall,
};

// The errand the bout's kind names, asked for this slot; null on the
// planet, for a kind with none, or when it has nothing to ask.
export function boutCall(sense: Sense): BoutErrand | null {
  const bots = sense.bout;
  if (!bots || bots.errand === null || !Object.hasOwn(BOUT_CALLS, bots.errand)) return null;
  return BOUT_CALLS[bots.errand]!(sense, bots);
}
