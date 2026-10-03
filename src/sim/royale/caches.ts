// The caches (CONTEXT.md: Cache; ADR 0031): about a hundred and fifty
// drawn each match among the layout's spots, golden ones always kept. A
// cache opens for the champion who stands beside it, still, for
// CACHE_OPEN_S; a hit taken breaks the opening, and so do a step, a cast
// and an attack order, the recall's rule. One
// opener at a time: the nearest champion standing there takes it, the
// lower id on a tie. An opened cache is gone for good in One life and
// back after CACHE_BACK_S in Respawn. Pure over a view of the champions,
// so the rule is tested without a sim; the loot the opening pays lives in
// loot.ts.

import { dist2 } from '../geo';
import type { Rng } from '../rng';
import type { Vec2 } from '../types';
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
  spots.forEach((s, i) => {
    if (!keep[i]) return;
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
  return out;
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

function canOpen(c: CacheState, s: CacheSeeker, time: number): boolean {
  if (!s.still || s.disturbedAt >= time) return false;
  return dist2(c.pos, s.pos) <= CACHE_REACH_M * CACHE_REACH_M;
}

// One tick of the caches: comebacks, openings broken or finished, and new
// openers. Returns the caches opened this tick, in id order.
export function stepCaches(
  caches: CacheState[],
  seekers: readonly CacheSeeker[],
  time: number,
  variant: RoyaleVariant,
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
      const holds =
        s?.still === true &&
        s.disturbedAt <= c.openSince &&
        dist2(c.pos, s.pos) <= CACHE_REACH_M * CACHE_REACH_M;
      if (!holds) {
        busy.delete(c.opener);
        c.opener = null;
      } else if (time - c.openSince >= CACHE_OPEN_S - 1e-9) {
        opened.push({ cacheId: c.id, unitId: c.opener, kind: c.kind });
        busy.delete(c.opener);
        c.opener = null;
        c.present = false;
        c.respawnAt = variant === 'respawn' ? time + CACHE_BACK_S : null;
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
      c.openSince = time;
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
