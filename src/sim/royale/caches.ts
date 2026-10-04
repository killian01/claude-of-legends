// The caches (CONTEXT.md: Cache; ADR 0031): about a hundred and fifty
// drawn each match among the layout's spots, golden ones always kept. A
// cache opens for the champion who stands beside it, still, for its
// opening time (CACHE_OPEN_S, a Seedfall cache's SEEDFALL_OPEN_S, read by
// kind through cacheOpenS); a hit taken breaks the opening, and so do a
// step, a cast and an attack order, the recall's rule; a Respawn Seedfall
// cache's opening is held instead (openingHeld: those slow its clock, only
// leaving its reach breaks it). One
// opener at a time: the nearest champion standing there takes it, the
// lower id on a tie. An opened cache is gone for good in One life and
// back after CACHE_BACK_S in Respawn, except a Seedfall cache, which never
// comes back. Pure over a view of the champions, so the rule is tested
// without a sim; the loot the opening pays lives in loot.ts.

import {
  SEEDFALL_CALM_S,
  SEEDFALL_HELD,
  SEEDFALL_HELD_RATE,
  SEEDFALL_OPEN_S,
  SEEDFALL_REACH_M,
} from '../content/royale_events';
import { dist2 } from '../geo';
import type { Rng } from '../rng';
import { DT, type Vec2 } from '../types';
import type { CacheSpot } from './layout';
import {
  CACHE_BACK_S,
  CACHE_OPEN_S,
  CACHE_REACH_M,
  type CacheKind,
  type CacheState,
  type RoyaleVariant,
} from './types';

export const CACHE_COUNT = 150;

// The caches of a match: every golden spot, then plain ones drawn without
// replacement until `count`, ids in spot order so a cache's id says where
// it stands in the layout.
export function drawCaches(
  spots: readonly CacheSpot[],
  rng: Rng,
  count = CACHE_COUNT,
): CacheState[] {
  return drawCacheSpots(spots, rng, count).caches;
}

// The same draw, with the indices of the spots it left empty, in spot
// order: where a Seedfall may land (seedfall.ts) without standing on a
// cache. A Seedfall cache is appended after these, its id the next one.
export function drawCacheSpots(
  spots: readonly CacheSpot[],
  rng: Rng,
  count = CACHE_COUNT,
): { caches: CacheState[]; unused: number[] } {
  const keep = new Array<boolean>(spots.length).fill(false);
  const plain: number[] = [];
  let kept = 0;
  spots.forEach((s, i) => {
    if (s.golden) {
      keep[i] = true;
      kept++;
    } else plain.push(i);
  });
  // A partial Fisher-Yates over the plain spots: the first draws win.
  for (let k = 0; k < plain.length && kept < count; k++) {
    const j = k + rng.int(plain.length - k);
    const pick = plain[j]!;
    plain[j] = plain[k]!;
    plain[k] = pick;
    keep[pick] = true;
    kept++;
  }
  const out: CacheState[] = [];
  const unused: number[] = [];
  spots.forEach((s, i) => {
    if (!keep[i]) {
      unused.push(i);
      return;
    }
    out.push({
      id: out.length,
      pos: { ...s.pos },
      kind: s.golden ? 'golden' : 'plain',
      present: true,
      respawnAt: null,
      opener: null,
      openSince: 0,
    });
  });
  return { caches: out, unused };
}

// How long a cache takes to open, read by its kind: the one place an
// opening's length is decided (the sim's rule, the snapshot's opening.d).
// The opener is the seam a per-champion factor reads (a Graft, later).
export function cacheOpenS(c: Pick<CacheState, 'kind'>, _opener?: { id: number }): number {
  return c.kind === 'seedfall' ? SEEDFALL_OPEN_S : CACHE_OPEN_S;
}

// The reach from a cache's center within which a champion opens it.
export function cacheReachM(c: Pick<CacheState, 'kind'>): number {
  return c.kind === 'seedfall' ? SEEDFALL_REACH_M : CACHE_REACH_M;
}

// What the caches read of a champion: alive and on the ground (the caller
// leaves out the dead and the fliers), whether it stood still this tick
// (no walk, no dash, no windup), and when it was last disturbed: a hit
// taken (the Dusk's burn aside), a cast or a sigil pressed, an attack
// ordered. Anything after the opening started breaks it, the recall's rule.
export interface CacheSeeker {
  id: number;
  pos: Vec2;
  still: boolean;
  disturbedAt: number;
}

export interface CacheOpened {
  cacheId: number;
  unitId: number;
  kind: CacheKind;
}

function inReach(c: CacheState, s: CacheSeeker): boolean {
  const reach = cacheReachM(c);
  return dist2(c.pos, s.pos) <= reach * reach;
}

// Whether a cache's opening is held through a disturbance rather than
// broken by it: a Seedfall cache's, in the variants that say so
// (content/royale_events.ts SEEDFALL_HELD, Respawn).
export function openingHeld(c: Pick<CacheState, 'kind'>, variant: RoyaleVariant): boolean {
  return c.kind === 'seedfall' && SEEDFALL_HELD[variant];
}

// How fast a held opening's clock runs this tick: in full with the opener
// still and undisturbed for SEEDFALL_CALM_S, else at SEEDFALL_HELD_RATE.
export function heldClockRate(s: CacheSeeker, time: number): number {
  return s.still && time - s.disturbedAt >= SEEDFALL_CALM_S - 1e-9 ? 1 : SEEDFALL_HELD_RATE;
}

function canOpen(c: CacheState, s: CacheSeeker, time: number): boolean {
  if (!s.still || s.disturbedAt >= time) return false;
  return inReach(c, s);
}

// One tick of the caches: comebacks, openings broken, held or finished,
// and new openers. A held opening that breaks leaves the time it counted
// with the cache, and the next opener goes on from there: the ring, not
// the opener, keeps the count, and the cache goes to whoever stands in it
// when the count is full. While nobody opens a held cache its openSince
// holds that kept time (seconds, zero for none); while someone does, it is
// the start that time implies, so `time - openSince` reads the same. Returns the caches opened this tick, in id order. It
// runs once a tick, `dt` apart: a held opening's slowed tick moves its
// start later by the share of `dt` it did not count, so `time - openSince`
// is the time it has counted (what the observation and the snapshot show
// of it, a bar that slows).
export function stepCaches(
  caches: CacheState[],
  seekers: readonly CacheSeeker[],
  time: number,
  variant: RoyaleVariant,
  dt = DT,
): CacheOpened[] {
  const opened: CacheOpened[] = [];
  const byId = new Map<number, CacheSeeker>();
  for (const s of seekers) byId.set(s.id, s);
  // A champion opens one cache at a time.
  const busy = new Set<number>();
  for (const c of caches) {
    if (c.present && c.opener !== null) busy.add(c.opener);
  }
  for (const c of caches) {
    if (!c.present) {
      if (c.respawnAt !== null && time >= c.respawnAt) {
        c.present = true;
        c.respawnAt = null;
      } else continue;
    }
    if (c.opener !== null) {
      const s = byId.get(c.opener);
      const held = openingHeld(c, variant);
      if (held && s && inReach(c, s)) c.openSince += dt * (1 - heldClockRate(s, time));
      const holds =
        s !== undefined && (held || (s.still && s.disturbedAt <= c.openSince)) && inReach(c, s);
      if (!holds) {
        busy.delete(c.opener);
        c.opener = null;
        // A held opening keeps the time it counted for the next opener.
        if (held) c.openSince = Math.max(0, time - c.openSince);
      } else if (time - c.openSince >= cacheOpenS(c, s) - 1e-9) {
        opened.push({ cacheId: c.id, unitId: c.opener, kind: c.kind });
        busy.delete(c.opener);
        c.opener = null;
        c.present = false;
        c.respawnAt = variant === 'respawn' && c.kind !== 'seedfall' ? time + CACHE_BACK_S : null;
        continue;
      } else continue;
    }
    let best: CacheSeeker | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const s of seekers) {
      if (busy.has(s.id) || !canOpen(c, s, time)) continue;
      const d = dist2(c.pos, s.pos);
      if (d < bestD || (d === bestD && best !== null && s.id < best.id)) {
        best = s;
        bestD = d;
      }
    }
    if (best) {
      c.opener = best.id;
      // A held opening goes on from the time the cache kept.
      c.openSince = openingHeld(c, variant) ? time - c.openSince : time;
      busy.add(best.id);
    }
  }
  return opened;
}

// The caches still standing, as everyone's minimap shows them.
export function standingCaches(caches: readonly CacheState[]): CacheState[] {
  return caches.filter((c) => c.present);
}

// The cache a champion is opening, if any.
export function openingBy(caches: readonly CacheState[], unitId: number): CacheState | null {
  return caches.find((c) => c.present && c.opener === unitId) ?? null;
}
