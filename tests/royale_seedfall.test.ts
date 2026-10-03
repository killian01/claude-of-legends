// The Seedfalls (src/sim/royale/seedfall.ts, CONTEXT.md: Seedfall): five a
// match from 2:00, one every 80 s, called 20 s ahead (two seeds at once in
// Respawn); each lands inside the light as it will stand 30 s later, at
// least 10 m from its edge, on a cache spot the draw left empty; its impact
// hits whoever stands within 4 m for a tenth of their health and throws
// them up, before the deaths and like the Dusk's burn (no fight, the Dusk's
// kill credit); its cache opens in 3 s, breaks on a hit, pays two pieces
// (one and a Heartwood Graft once Grafts ship), all the health and all the
// mana, and never comes back. What a seat observes of it is here too.

import { describe, expect, it } from 'vitest';
import { buildRoyaleSim, type ReplayPick } from '../src/net/replay';
import { dealDamage } from '../src/sim/combat/damage';
import {
  SEEDFALL_AIRBORNE_S,
  SEEDFALL_AT_S,
  SEEDFALL_DEPTH_M,
  SEEDFALL_IMPACT_M,
  SEEDFALL_IMPACT_SHARE,
  SEEDFALL_OPEN_S,
  SEEDFALL_PAIR_M,
  SEEDFALL_PIECES_BEFORE_GRAFTS,
  SEEDFALL_REACH_M,
  SEEDFALL_WARN_S,
} from '../src/sim/content/royale_events';
import { dirTo, dist, type Vec3 } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { Rng } from '../src/sim/rng';
import { type CacheSeeker, cacheOpenS, stepCaches } from '../src/sim/royale/caches';
import { depthInside } from '../src/sim/royale/dusk';
import { along } from '../src/sim/royale/layout';
import { RoyaleMode } from '../src/sim/royale/mode';
import { royaleLayoutOf } from '../src/sim/royale/planet_map';
import {
  drawSeedfallPoints,
  seedfallCap,
  seedfallReward,
  seedfallSchedule,
} from '../src/sim/royale/seedfall';
import {
  CACHE_BACK_S,
  CACHE_OPEN_S,
  type CacheState,
  DROP_S,
  type RoyaleVariant,
} from '../src/sim/royale/types';
import type { Sim, SimEvent } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { sph } from './royale_fixture';
import { loadPlanet } from './royale_planet';

function picks(n: number): ReplayPick[] {
  const ids = ['dain', 'vesk', 'sylra', 'korrath', 'maera'];
  return Array.from({ length: n }, (_, i) => ({
    name: `seat${i}`,
    team: i,
    championId: ids[i % ids.length]!,
    sigils: ['riftstep', 'mend'] as [string, string],
  }));
}

// A match of people (no bot decides), landed, everyone holding still so
// nobody fights back on their own.
function landed(n: number, variant: RoyaleVariant = 'one_life', seed = 3) {
  const built = buildRoyaleSim(loadPlanet(), seed, picks(n), variant);
  while (built.sim.time < DROP_S + DT) built.sim.tick();
  const units = built.unitIds.map((id) => built.sim.units.get(id)!);
  for (const u of units) {
    u.holding = true;
    u.path = [];
  }
  return { sim: built.sim, units };
}

function runUntil(sim: Sim, time: number): SimEvent[] {
  const out: SimEvent[] = [];
  while (sim.time + 1e-9 < time) out.push(...sim.tick());
  return out;
}

function ofType(events: SimEvent[], type: string): SimEvent[] {
  return events.filter((e) => e.type === type);
}

// A walkable point near p.
function ground(sim: Sim, p: Vec3): Vec3 {
  const q = sim.ground.nearestWalkable(p, 40);
  if (!q || q.y === undefined) throw new Error('no ground');
  return { x: q.x, y: q.y, z: q.z };
}

function place(u: Unit, p: Vec3): void {
  u.pos = { ...p };
  u.path = [];
}

// A point s meters from p, one way or the other along a fixed heading.
function aside(sim: Sim, p: Vec3, s: number): Vec3 {
  const R = sim.royaleMode!.layout.radius;
  const dir = dirTo(p, { x: 0, y: R, z: 0 }) ?? { x: 1, y: 0, z: 0 };
  return along(p, dir as Vec3, s, R);
}

// A Seedfall called by hand, landing `inS` from now at p.
function call(sim: Sim, p: Vec3, inS: number, id = 90): void {
  sim.royale!.seedfalls.push({
    id,
    pos: { ...p },
    announcedAt: sim.time,
    landsAt: sim.time + inS,
    landed: false,
    cacheId: null,
  });
}

// The middle of the light, on the ground.
function lit(sim: Sim): Vec3 {
  return ground(sim, sim.royale!.dusk.now.center);
}

function combatCtx(sim: Sim): Parameters<typeof dealDamage>[0] {
  return (sim as unknown as { ctx(): Parameters<typeof dealDamage>[0] }).ctx();
}

describe('the schedule', () => {
  it('calls five Seedfalls from 2:00, every 80 s, 20 s ahead, two seeds each in Respawn', () => {
    const land = DROP_S;
    const one = seedfallSchedule('one_life', land);
    expect(SEEDFALL_AT_S).toEqual([120, 200, 280, 360, 440]);
    expect(SEEDFALL_WARN_S).toBe(20);
    expect(one.map((c) => c.landsAt)).toEqual([130, 210, 290, 370, 450]);
    expect(one.map((c) => c.announceAt)).toEqual([110, 190, 270, 350, 430]);
    expect(one.map((c) => c.ids)).toEqual([[0], [1], [2], [3], [4]]);
    const two = seedfallSchedule('respawn', land);
    expect(two.map((c) => c.landsAt)).toEqual(one.map((c) => c.landsAt));
    expect(two.map((c) => c.ids)).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [8, 9],
    ]);
  });
});

describe('where a seed falls, on the Wanderseed', () => {
  const planet = loadPlanet();
  // One decoded ground for every seed: the draw never steps a sim.
  const shared = planet.ground();
  const layout = royaleLayoutOf(planet.layout);

  function draws(seed: number, variant: RoyaleVariant, offset: number) {
    const rng = new Rng(seed);
    const mode = new RoyaleMode(rng, shared, { variant, layout });
    return mode.seedfallCalls.map((c) => {
      const cap = seedfallCap(mode.schedule, c.landsAt, offset);
      const points = drawSeedfallPoints(
        rng,
        mode.seedfallSpots,
        cap,
        c.ids.length,
        layout,
        mode.ground,
      );
      return { cap, points, mode };
    });
  }

  it('draws the same points from the same seed, and others from another', () => {
    const a = draws(4, 'respawn', 0).map((d) => d.points);
    expect(draws(4, 'respawn', 0).map((d) => d.points)).toEqual(a);
    expect(draws(5, 'respawn', 0).map((d) => d.points)).not.toEqual(a);
  });

  it('lands every seed on walkable ground, 10 m inside the light 30 s after, for seeds 1 to 50', () => {
    for (let seed = 1; seed <= 50; seed++) {
      for (const offset of [0, 30, 60]) {
        for (const { cap, points, mode } of draws(seed, 'one_life', offset)) {
          expect(points).toHaveLength(1);
          for (const p of points) {
            expect(mode.ground.walkable(p)).toBe(true);
            expect(depthInside(cap, p)).toBeGreaterThanOrEqual(SEEDFALL_DEPTH_M - 1e-6);
          }
        }
      }
    }
  });

  it('stands Respawn pairs 60 m apart, the last as far as the light allows, for seeds 1 to 50', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const all = draws(seed, 'respawn', 0);
      all.forEach(({ cap, points, mode }, wave) => {
        expect(points).toHaveLength(2);
        for (const p of points) {
          expect(mode.ground.walkable(p)).toBe(true);
          expect(depthInside(cap, p)).toBeGreaterThanOrEqual(SEEDFALL_DEPTH_M - 1e-6);
        }
        const apart = dist(points[0]!, points[1]!);
        // The last light closes to under 60 m of room 10 m deep (a cap of
        // about 38 m at 7:50): there the twins stand as far as they can.
        if (wave < all.length - 1) expect(apart).toBeGreaterThanOrEqual(SEEDFALL_PAIR_M);
        else expect(apart).toBeGreaterThan(25);
      });
    }
  });

  it('never lands a seed on a standing cache', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { mode } = draws(seed, 'one_life', 0)[0]!;
      for (const p of mode.seedfallSpots) {
        for (const c of mode.state.caches) expect(dist(c.pos, p)).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('the call and the landing, in a match', () => {
  it('shows a Seedfall from 20 s before it lands, exactly, then lands it with its cache', () => {
    const { sim, units } = landed(2, 'one_life');
    const self = units[0]!;
    const [first] = sim.royaleMode!.seedfallCalls;
    // Nothing is called, and nothing drawn, before the call's tick (the
    // tick at sim time t leaves the world at t + DT, as every rule does).
    const quiet = runUntil(sim, first!.announceAt);
    expect(ofType(quiet, 'royale_seedfall')).toEqual([]);
    expect(buildObservation(sim, self.id)!.royale!.seedfalls).toEqual([]);
    const rng = sim.rng.state;
    const events = sim.tick();
    expect(sim.rng.state).not.toBe(rng);
    expect(ofType(events, 'royale_seedfall')).toHaveLength(1);
    expect(sim.royale!.seedfalls[0]!.announcedAt).toBeCloseTo(first!.announceAt, 9);
    const obs = buildObservation(sim, self.id)!.royale!;
    expect(obs.seedfalls).toHaveLength(1);
    const sf = obs.seedfalls![0]!;
    expect(sf.id).toBe(0);
    expect(sf.landsAt).toBeCloseTo(DROP_S + SEEDFALL_AT_S[0]!, 9);
    expect(sf.landed).toBe(false);
    expect(sf.opener).toBeUndefined();
    const before = sim.royale!.caches.length;
    const landing = runUntil(sim, sf.landsAt + DT);
    expect(ofType(landing, 'royale_seedfall_land')).toEqual([
      { type: 'royale_seedfall_land', seedfallId: 0, at: { x: sf.x, y: sf.y, z: sf.z } },
    ]);
    expect(sim.royaleMode!.tally.seedfallsLanded).toBe(1);
    const cache = sim.royale!.caches[before]!;
    expect(cache).toMatchObject({ id: before, kind: 'seedfall', present: true });
    const after = buildObservation(sim, self.id)!.royale!;
    expect(after.seedfalls![0]!.landed).toBe(true);
    expect(after.caches.find((c) => c.id === cache.id)?.kind).toBe('seedfall');
    expect(after.caches.find((c) => c.id === 0)?.kind).toBe(sim.royale!.caches[0]!.kind);
  });

  it('calls two seeds at once in Respawn, 60 m apart', () => {
    const { sim } = landed(2, 'respawn');
    const [first] = sim.royaleMode!.seedfallCalls;
    const events = runUntil(sim, first!.announceAt + DT);
    expect(ofType(events, 'royale_seedfall')).toHaveLength(2);
    const [a, b] = sim.royale!.seedfalls;
    expect([a!.id, b!.id]).toEqual([0, 1]);
    expect(dist(a!.pos, b!.pos)).toBeGreaterThanOrEqual(SEEDFALL_PAIR_M);
  });
});

describe('the impact', () => {
  it('hits within 4 m for a tenth of the health, throws up, and spares 4.1 m', () => {
    const { sim, units } = landed(3);
    const [a, b, c] = units as [Unit, Unit, Unit];
    const at = lit(sim);
    place(a, at);
    place(b, aside(sim, at, -(SEEDFALL_IMPACT_M + 0.1)));
    place(c, aside(sim, at, SEEDFALL_IMPACT_M - 0.1));
    expect(dist(b.pos, at)).toBeGreaterThan(SEEDFALL_IMPACT_M);
    expect(dist(c.pos, at)).toBeLessThan(SEEDFALL_IMPACT_M);
    for (const u of units) u.hp = u.maxHp;
    const hitAt = a.lastDamagedAt;
    call(sim, at, 1);
    let tick: SimEvent[] = [];
    while (ofType(tick, 'royale_seedfall_land').length === 0) tick = sim.tick();
    for (const u of [a, c]) {
      expect(u.maxHp - u.hp).toBeGreaterThan(u.maxHp * SEEDFALL_IMPACT_SHARE * 0.98);
      expect(u.maxHp - u.hp).toBeLessThan(u.maxHp * SEEDFALL_IMPACT_SHARE * 1.02);
      const up = u.statuses.find((s) => s.kind === 'airborne');
      expect(up?.until).toBeCloseTo(sim.time - DT + SEEDFALL_AIRBORNE_S, 9);
    }
    expect(b.hp).toBe(b.maxHp);
    expect(b.statuses.some((s) => s.kind === 'airborne')).toBe(false);
    // No fight: the out of combat clock stands.
    expect(a.lastDamagedAt).toBe(hitAt);
    // Once only.
    const hp = a.hp;
    sim.tick();
    expect(a.hp).toBeGreaterThanOrEqual(hp);
  });

  it('kills on the landing tick, the credit to the last enemy who hit inside the window', () => {
    const { sim, units } = landed(4);
    const [victim, killer, lone] = units as [Unit, Unit, Unit];
    const at = lit(sim);
    place(victim, at);
    place(lone, aside(sim, at, 2));
    place(killer, ground(sim, aside(sim, at, 30)));
    victim.hp = 5;
    victim.lastHitByChampion = killer.id;
    victim.lastHitAt = sim.time;
    lone.hp = 5;
    call(sim, at, 1);
    let tick: SimEvent[] = [];
    while (ofType(tick, 'royale_seedfall_land').length === 0) tick = sim.tick();
    expect(victim.dead).toBe(true);
    expect(lone.dead).toBe(true);
    const deaths = ofType(tick, 'death') as Extract<SimEvent, { type: 'death' }>[];
    expect(deaths.find((d) => d.unitId === victim.id)?.killerId).toBe(killer.id);
    expect(deaths.find((d) => d.unitId === lone.id)?.killerId).toBe(0);
    expect(killer.kills).toBe(1);
  });

  it('leaves an opening under way alone', () => {
    const { sim, units } = landed(1, 'respawn');
    const u = units[0]!;
    const cache = sim.royale!.caches.find((c) => c.kind === 'plain' && c.present)!;
    place(u, ground(sim, cache.pos));
    expect(dist(u.pos, cache.pos)).toBeLessThan(1.6);
    sim.tick();
    expect(cache.opener).toBe(u.id);
    call(sim, cache.pos, 0.5);
    const events = runUntil(sim, cache.openSince + CACHE_OPEN_S + DT);
    expect(u.hp).toBeLessThan(u.maxHp);
    expect(ofType(events, 'royale_cache')).toEqual([
      { type: 'royale_cache', unitId: u.id, cacheId: cache.id },
    ]);
  });
});

describe('the Seedfall cache', () => {
  function seedfallCache(): CacheState[] {
    return [
      {
        id: 0,
        pos: sph(1, 0.2, 0.3),
        kind: 'seedfall',
        present: true,
        respawnAt: null,
        opener: null,
        openSince: 0,
      },
    ];
  }

  function at(c: CacheState, d: number, still = true, disturbedAt = -999): CacheSeeker {
    const R = Math.sqrt(c.pos.x ** 2 + c.pos.y ** 2 + c.pos.z ** 2);
    return { id: 1, pos: along(c.pos, { x: 0, y: 1, z: 0 } as Vec3, d, R), still, disturbedAt };
  }

  it('takes 3 s to open, from 2.2 m', () => {
    expect(cacheOpenS({ kind: 'seedfall' })).toBe(SEEDFALL_OPEN_S);
    expect(cacheOpenS({ kind: 'plain' })).toBe(CACHE_OPEN_S);
    const far = seedfallCache();
    stepCaches(far, [at(far[0]!, SEEDFALL_REACH_M + 0.1)], 10, 'one_life');
    expect(far[0]!.opener).toBeNull();
    const caches = seedfallCache();
    const s = at(caches[0]!, SEEDFALL_REACH_M - 0.1);
    stepCaches(caches, [s], 10, 'one_life');
    expect(caches[0]!.opener).toBe(1);
    let t = 10;
    while (t < 10 + SEEDFALL_OPEN_S - DT / 2) {
      t += DT;
      const opened = stepCaches(caches, [s], t, 'one_life');
      if (t < 10 + SEEDFALL_OPEN_S - 1e-6) expect(opened).toEqual([]);
      else expect(opened).toEqual([{ cacheId: 0, unitId: 1, kind: 'seedfall' }]);
    }
    expect(caches[0]!.present).toBe(false);
  });

  it('breaks on a hit', () => {
    const caches = seedfallCache();
    const s = at(caches[0]!, 1);
    stepCaches(caches, [s], 10, 'one_life');
    stepCaches(caches, [{ ...s, disturbedAt: 11 }], 11, 'one_life');
    expect(caches[0]!.opener).toBeNull();
    expect(stepCaches(caches, [{ ...s, disturbedAt: 11 }], 13.1, 'one_life')).toEqual([]);
  });

  it('never comes back in Respawn', () => {
    const caches = seedfallCache();
    const s = at(caches[0]!, 1);
    stepCaches(caches, [s], 10, 'respawn');
    stepCaches(caches, [s], 10 + SEEDFALL_OPEN_S, 'respawn');
    expect(caches[0]!.present).toBe(false);
    expect(caches[0]!.respawnAt).toBeNull();
    stepCaches(caches, [], 10 + SEEDFALL_OPEN_S + CACHE_BACK_S + 10, 'respawn');
    expect(caches[0]!.present).toBe(false);
  });

  it('pays two pieces, all the health and all the mana, until Grafts ship', () => {
    expect(seedfallReward()).toEqual({
      pieces: SEEDFALL_PIECES_BEFORE_GRAFTS,
      heal: 1,
      mana: 1,
      heartwood: false,
    });
    expect(SEEDFALL_PIECES_BEFORE_GRAFTS).toBe(2);
    const { sim, units } = landed(1, 'respawn');
    const u = units[0]!;
    const p = lit(sim);
    call(sim, p, 0.5);
    runUntil(sim, sim.time + 1);
    const cache = sim.royale!.caches.find((c) => c.kind === 'seedfall')!;
    place(u, ground(sim, cache.pos));
    u.hp = u.maxHp * 0.3;
    u.mana = 0;
    const items = u.items.length;
    sim.tick();
    expect(cache.opener).toBe(u.id);
    const since = cache.openSince;
    let events: SimEvent[] = [];
    while (ofType(events, 'royale_cache').length === 0) events = sim.tick();
    // The tick at t leaves the world at t + DT.
    expect(sim.time - DT - since).toBeCloseTo(SEEDFALL_OPEN_S, 6);
    expect(ofType(events, 'royale_loot')).toHaveLength(2);
    expect(u.items.length).toBe(items + 2);
    expect(u.hp).toBe(u.maxHp);
    expect(u.mana).toBe(u.maxMana);
    const tally = sim.royaleMode!.tally;
    expect(tally.seedfallsOpened).toBe(1);
    expect(tally.seedfallsContested).toBe(0);
    // Gone from the list, and never back, even in Respawn.
    expect(sim.royale!.seedfalls).toEqual([]);
    expect(buildObservation(sim, u.id)!.royale!.seedfalls).toEqual([]);
    runUntil(sim, sim.time + CACHE_BACK_S + 1);
    expect(cache.present).toBe(false);
  });

  it('breaks its opening on a hit taken in the match', () => {
    const { sim, units } = landed(2);
    const [u, enemy] = units as [Unit, Unit];
    call(sim, lit(sim), 0.5);
    runUntil(sim, sim.time + 1);
    const cache = sim.royale!.caches.find((c) => c.kind === 'seedfall')!;
    place(u, ground(sim, cache.pos));
    place(enemy, ground(sim, aside(sim, cache.pos, 20)));
    runUntil(sim, sim.time + 1);
    expect(cache.opener).toBe(u.id);
    dealDamage(combatCtx(sim), enemy.id, u, 10, 'true');
    sim.tick();
    expect(cache.opener).toBeNull();
    expect(cache.present).toBe(true);
  });

  it('counts an opening contested when another champion stands within 12 m', () => {
    const { sim, units } = landed(2);
    const [u, other] = units as [Unit, Unit];
    call(sim, lit(sim), 0.5);
    runUntil(sim, sim.time + 1);
    const cache = sim.royale!.caches.find((c) => c.kind === 'seedfall')!;
    place(u, ground(sim, cache.pos));
    place(other, ground(sim, aside(sim, cache.pos, 8)));
    runUntil(sim, sim.time + SEEDFALL_OPEN_S + 0.5);
    expect(cache.present).toBe(false);
    expect(sim.royaleMode!.tally.seedfallsContested).toBe(1);
  });

  it('shows its opener to a seat that sees it or opens it, never under fog', () => {
    const { sim, units } = landed(3);
    const [opener, watcher, far] = units as [Unit, Unit, Unit];
    call(sim, lit(sim), 0.5);
    runUntil(sim, sim.time + 1);
    const cache = sim.royale!.caches.find((c) => c.kind === 'seedfall')!;
    place(opener, ground(sim, cache.pos));
    place(watcher, ground(sim, aside(sim, cache.pos, 5)));
    const anti = { x: -cache.pos.x, y: -cache.pos.y, z: -cache.pos.z };
    place(far, ground(sim, anti));
    sim.tick();
    expect(cache.opener).toBe(opener.id);
    const seen = (u: Unit) => buildObservation(sim, u.id)!.royale!.seedfalls![0]!.opener;
    expect(sim.isVisible(watcher.team, opener.id)).toBe(true);
    expect(sim.isVisible(far.team, opener.id)).toBe(false);
    expect(seen(opener)).toEqual({ id: opener.id, since: cache.openSince });
    expect(seen(watcher)).toEqual({ id: opener.id, since: cache.openSince });
    expect(seen(far)).toBeUndefined();
  });
});
