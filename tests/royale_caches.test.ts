// The caches (src/sim/royale/caches.ts): drawn from the seed with every
// golden spot kept, opened by standing still beside one for 1.5 s, broken
// by a step or a hit, one opener at a time, the nearest first, gone in One
// life and back after 90 s in Respawn.

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/sim/geo';
import { Rng } from '../src/sim/rng';
import {
  CACHE_COUNT,
  type CacheSeeker,
  drawCaches,
  openingBy,
  standingCaches,
  stepCaches,
} from '../src/sim/royale/caches';
import { along } from '../src/sim/royale/layout';
import {
  CACHE_BACK_S,
  CACHE_OPEN_S,
  CACHE_REACH_M,
  type CacheState,
} from '../src/sim/royale/types';
import { DT } from '../src/sim/types';
import { fakeLayout, R, sph } from './royale_fixture';

const layout = fakeLayout();

describe('drawing the caches', () => {
  it('keeps every golden spot and draws the rest from the seed', () => {
    const caches = drawCaches(layout.cacheSpots, new Rng(3));
    expect(caches).toHaveLength(CACHE_COUNT);
    const golden = layout.cacheSpots.filter((s) => s.golden).length;
    expect(caches.filter((c) => c.golden)).toHaveLength(golden);
    expect(caches.map((c) => c.id)).toEqual(caches.map((_, i) => i));
    expect(caches.every((c) => c.present && c.opener === null)).toBe(true);
    expect(drawCaches(layout.cacheSpots, new Rng(3))).toEqual(caches);
    const other = drawCaches(layout.cacheSpots, new Rng(4));
    expect(other.map((c) => c.pos)).not.toEqual(caches.map((c) => c.pos));
  });

  it('takes every spot when there are fewer than asked for', () => {
    expect(drawCaches(layout.cacheSpots.slice(0, 20), new Rng(1))).toHaveLength(20);
  });
});

function oneCache(golden = false): CacheState[] {
  return [
    {
      id: 0,
      pos: sph(1, 0.2, 0.3),
      golden,
      present: true,
      respawnAt: null,
      opener: null,
      openSince: 0,
    },
  ];
}

function beside(c: CacheState, m: number, angle = 0): Vec3 {
  const p = c.pos;
  const east = { x: p.z, y: 0, z: -p.x };
  const e = Math.hypot(east.x, east.z);
  const dir = { x: east.x / e, y: 0, z: east.z / e };
  return angle === 0 ? along(p, dir, m, R) : along(p, { x: -dir.x, y: 0, z: -dir.z }, m, R);
}

function seeker(id: number, pos: Vec3, extra: Partial<CacheSeeker> = {}): CacheSeeker {
  return { id, pos, still: true, disturbedAt: -999, ...extra };
}

// Ticks the caches from `from` for `seconds`, returning every opening.
function run(
  caches: CacheState[],
  seekers: (t: number) => CacheSeeker[],
  from: number,
  seconds: number,
  variant: 'respawn' | 'one_life' = 'one_life',
) {
  const opened: { t: number; unitId: number }[] = [];
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i <= ticks; i++) {
    const t = from + i * DT;
    for (const o of stepCaches(caches, seekers(t), t, variant))
      opened.push({ t, unitId: o.unitId });
  }
  return opened;
}

describe('opening a cache', () => {
  it('opens after standing still beside it for the opening time', () => {
    const caches = oneCache();
    const at = beside(caches[0]!, 1);
    const opened = run(caches, () => [seeker(5, at)], 10, 3);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.unitId).toBe(5);
    expect(opened[0]!.t).toBeCloseTo(10 + CACHE_OPEN_S, 6);
    expect(caches[0]!.present).toBe(false);
    expect(standingCaches(caches)).toHaveLength(0);
  });

  it('needs the reach', () => {
    const caches = oneCache();
    const far = beside(caches[0]!, CACHE_REACH_M + 0.2);
    expect(run(caches, () => [seeker(5, far)], 10, 3)).toHaveLength(0);
  });

  it('is broken by a step and by a hit, and starts over', () => {
    const caches = oneCache();
    const at = beside(caches[0]!, 1);
    // A step at 11.0 breaks the first try; it opens 1.5 s after it stands again.
    let opened = run(caches, (t) => [seeker(5, at, { still: Math.abs(t - 11) > 1e-6 })], 10, 4);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.t).toBeCloseTo(11 + DT + CACHE_OPEN_S, 6);
    const hit = oneCache();
    opened = run(hit, (t) => [seeker(5, at, { disturbedAt: t >= 11 ? 11 : -999 })], 10, 4);
    expect(opened[0]!.t).toBeCloseTo(11 + DT + CACHE_OPEN_S, 6);
  });

  it('has one opener, the nearest, the lower id on a tie', () => {
    const caches = oneCache();
    const near = beside(caches[0]!, 0.6);
    const far = beside(caches[0]!, 1.2, 1);
    let opened = run(caches, () => [seeker(9, far), seeker(4, near)], 10, 3);
    expect(opened.map((o) => o.unitId)).toEqual([4]);
    const tie = oneCache();
    const a = beside(tie[0]!, 1);
    stepCaches(tie, [seeker(8, a), seeker(3, { ...a })], 10, 'one_life');
    expect(tie[0]!.opener).toBe(3);
    // Once someone opens it, the nearer newcomer waits for a break.
    const held = oneCache();
    opened = run(
      held,
      (t) => (t < 10.5 ? [seeker(9, far)] : [seeker(9, far), seeker(4, near)]),
      10,
      3,
    );
    expect(opened.map((o) => o.unitId)).toEqual([9]);
  });

  it('opens one cache at a time per champion', () => {
    const caches = [...oneCache(), { ...oneCache()[0]!, id: 1 }];
    const at = beside(caches[0]!, 0.5);
    stepCaches(caches, [seeker(2, at)], 10, 'one_life');
    expect(caches.filter((c) => c.opener === 2)).toHaveLength(1);
    expect(openingBy(caches, 2)?.id).toBe(0);
  });

  it('never comes back in One life, comes back after its delay in Respawn', () => {
    const gone = oneCache();
    const at = beside(gone[0]!, 1);
    run(gone, (t) => (t < 12 ? [seeker(5, at)] : []), 10, CACHE_BACK_S + 10, 'one_life');
    expect(gone[0]!.present).toBe(false);
    expect(gone[0]!.respawnAt).toBeNull();
    const back = oneCache(true);
    const opened = run(back, (t) => (t < 12 ? [seeker(5, at)] : []), 10, 5, 'respawn');
    expect(opened).toHaveLength(1);
    const openedAt = opened[0]!.t;
    expect(back[0]!.respawnAt).toBeCloseTo(openedAt + CACHE_BACK_S, 6);
    stepCaches(back, [], openedAt + CACHE_BACK_S - DT, 'respawn');
    expect(back[0]!.present).toBe(false);
    stepCaches(back, [], openedAt + CACHE_BACK_S, 'respawn');
    expect(back[0]!.present).toBe(true);
    expect(back[0]!.golden).toBe(true);
  });
});
