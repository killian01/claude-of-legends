// Respawn's pace at the Seedfall (src/sim/royale/caches.ts openingHeld,
// content/royale_events.ts SEEDFALL_HELD): in Respawn a Seedfall cache's
// opening is held, not broken. A hit, a cast, an attack or a step inside
// the reach slows its clock to SEEDFALL_HELD_RATE until the opener has
// gone SEEDFALL_CALM_S undisturbed and still; only leaving the reach or
// falling breaks it, and then the cache keeps the time counted for the
// next opener. One life and every plain cache keep the old rule. The
// observation and the snapshot read the held time through the opening's
// start, so a person's bar slows exactly as the sim counts. And a whole
// Respawn match of house bots opens its Seedfalls, most of them fought
// over.

import { describe, expect, it } from 'vitest';
import { buildRoyaleSim, type ReplayPick } from '../src/net/replay';
import { dealDamage } from '../src/sim/combat/damage';
import {
  SEEDFALL_CALM_S,
  SEEDFALL_HELD,
  SEEDFALL_HELD_RATE,
  SEEDFALL_OPEN_S,
  SEEDFALL_REACH_M,
} from '../src/sim/content/royale_events';
import { dirTo, type Vec3 } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { type CacheSeeker, heldClockRate, openingHeld, stepCaches } from '../src/sim/royale/caches';
import { royaleHouseChampions } from '../src/sim/royale/fill';
import { along } from '../src/sim/royale/layout';
import {
  CACHE_OPEN_S,
  type CacheKind,
  type CacheState,
  DROP_S,
  PLAY_S,
  type RoyaleVariant,
} from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { sph } from './royale_fixture';
import { loadPlanet } from './royale_planet';

function cacheOf(kind: CacheKind = 'seedfall'): CacheState[] {
  return [
    {
      id: 0,
      pos: sph(1, 0.2, 0.3),
      kind,
      present: true,
      respawnAt: null,
      opener: null,
      openSince: 0,
    },
  ];
}

function at(c: CacheState, d: number, id = 1, over: Partial<CacheSeeker> = {}): CacheSeeker {
  const R = Math.sqrt(c.pos.x ** 2 + c.pos.y ** 2 + c.pos.z ** 2);
  return {
    id,
    pos: along(c.pos, { x: 0, y: 1, z: 0 } as Vec3, d, R),
    still: true,
    disturbedAt: -999,
    ...over,
  };
}

// Steps the caches tick by tick from `from` while `seekers(t)` says who
// stands where; the time of the first opening and who opened, or null.
function run(
  caches: CacheState[],
  from: number,
  to: number,
  seekers: (t: number) => CacheSeeker[],
  variant: RoyaleVariant = 'respawn',
): { at: number; unitId: number } | null {
  for (let k = 0; from + k * DT <= to + 1e-9; k++) {
    const t = from + k * DT;
    const opened = stepCaches(caches, seekers(t), t, variant);
    if (opened.length > 0) return { at: t, unitId: opened[0]!.unitId };
  }
  return null;
}

describe('a held opening', () => {
  it('is a Respawn Seedfall cache only', () => {
    expect(SEEDFALL_HELD).toEqual({ one_life: false, respawn: true });
    expect(openingHeld({ kind: 'seedfall' }, 'respawn')).toBe(true);
    expect(openingHeld({ kind: 'seedfall' }, 'one_life')).toBe(false);
    expect(openingHeld({ kind: 'plain' }, 'respawn')).toBe(false);
    expect(openingHeld({ kind: 'golden' }, 'respawn')).toBe(false);
  });

  it('runs in full undisturbed and still for 1 s, else at half', () => {
    expect(SEEDFALL_HELD_RATE).toBe(0.5);
    expect(SEEDFALL_CALM_S).toBe(1);
    const c = cacheOf()[0]!;
    expect(heldClockRate(at(c, 1), 10)).toBe(1);
    expect(heldClockRate(at(c, 1, 1, { disturbedAt: 9 }), 10)).toBe(1);
    expect(heldClockRate(at(c, 1, 1, { disturbedAt: 9.05 }), 10)).toBe(SEEDFALL_HELD_RATE);
    expect(heldClockRate(at(c, 1, 1, { still: false }), 10)).toBe(SEEDFALL_HELD_RATE);
  });

  it('opens in 3 s undisturbed, as in One life', () => {
    const caches = cacheOf();
    const s = at(caches[0]!, 1);
    const done = run(caches, 10, 20, () => [s]);
    expect(done?.at).toBeCloseTo(10 + SEEDFALL_OPEN_S, 6);
  });

  it('slows on a hit taken and goes on, half a second later for one hit', () => {
    const caches = cacheOf();
    const hitAt = 11;
    const done = run(caches, 10, 20, (t) => [
      at(caches[0]!, 1, 1, { disturbedAt: t >= hitAt ? hitAt : -999 }),
    ]);
    // The second after the hit counts half: the opening ends half of it later.
    const late = SEEDFALL_CALM_S * (1 - SEEDFALL_HELD_RATE);
    expect(done).not.toBeNull();
    expect(done!.unitId).toBe(1);
    expect(done!.at).toBeCloseTo(10 + SEEDFALL_OPEN_S + late, 6);
  });

  it('under hits that never stop, takes twice as long and still opens', () => {
    const caches = cacheOf();
    // Hit on every tick but the one it starts on.
    const done = run(caches, 10, 30, (t) => [at(caches[0]!, 1, 1, { disturbedAt: t - DT })]);
    expect(done?.at).toBeCloseTo(10 + SEEDFALL_OPEN_S / SEEDFALL_HELD_RATE, 6);
  });

  it('slows on a step inside the reach, and breaks on leaving it', () => {
    const caches = cacheOf();
    const c = caches[0]!;
    stepCaches(caches, [at(c, 1)], 10, 'respawn');
    stepCaches(caches, [at(c, 2, 1, { still: false })], 10 + DT, 'respawn');
    expect(c.opener).toBe(1);
    stepCaches(
      caches,
      [at(c, SEEDFALL_REACH_M + 0.1, 1, { still: false })],
      10 + 2 * DT,
      'respawn',
    );
    expect(c.opener).toBeNull();
    // Falling (no seeker) breaks it too.
    stepCaches(caches, [at(c, 1)], 11, 'respawn');
    expect(c.opener).toBe(1);
    stepCaches(caches, [], 11 + DT, 'respawn');
    expect(c.opener).toBeNull();
  });

  it('keeps the time counted for the next opener, who finishes the count', () => {
    const caches = cacheOf();
    const c = caches[0]!;
    // The first opener counts 2 s, then is carried out of the reach.
    const first = run(caches, 10, 12, () => [at(c, 1, 1)]);
    expect(first).toBeNull();
    stepCaches(caches, [at(c, 5, 1)], 12 + DT, 'respawn');
    expect(c.opener).toBeNull();
    // A second steps in: one second more opens it, for the second.
    const done = run(caches, 13, 20, () => [at(c, 1, 2)]);
    expect(done?.unitId).toBe(2);
    expect(done!.at).toBeCloseTo(13 + SEEDFALL_OPEN_S - 2 - DT, 6);
  });

  it('keeps its claim while held: a nearer champion does not take it over', () => {
    const caches = cacheOf();
    const c = caches[0]!;
    stepCaches(caches, [at(c, 2, 1)], 10, 'respawn');
    const done = run(caches, 10 + DT, 20, (t) => [at(c, 2, 1, { disturbedAt: t }), at(c, 0.2, 2)]);
    expect(done?.unitId).toBe(1);
  });

  it('still breaks on a hit in One life, and for a plain cache in Respawn', () => {
    for (const [kind, variant] of [
      ['seedfall', 'one_life'],
      ['plain', 'respawn'],
    ] as const) {
      const caches = cacheOf(kind);
      const c = caches[0]!;
      stepCaches(caches, [at(c, 1)], 10, variant);
      stepCaches(caches, [at(c, 1, 1, { disturbedAt: 10.5 })], 10.5, variant);
      expect(c.opener).toBeNull();
      // And starts over from nothing.
      stepCaches(caches, [at(c, 1)], 11, variant);
      expect(c.openSince).toBe(11);
    }
    expect(CACHE_OPEN_S).toBeLessThan(SEEDFALL_OPEN_S);
  });
});

function picks(n: number): ReplayPick[] {
  const ids = ['dain', 'vesk', 'sylra'];
  return Array.from({ length: n }, (_, i) => ({
    name: `seat${i}`,
    team: i,
    championId: ids[i % ids.length]!,
    sigils: ['riftstep', 'mend'] as [string, string],
  }));
}

function landed(n: number, variant: RoyaleVariant) {
  const built = buildRoyaleSim(loadPlanet(), 3, picks(n), variant);
  while (built.sim.time < DROP_S + DT) built.sim.tick();
  const units = built.unitIds.map((id) => built.sim.units.get(id)!);
  for (const u of units) {
    u.holding = true;
    u.path = [];
  }
  return { sim: built.sim, units };
}

function runUntil(sim: Sim, time: number): void {
  while (sim.time + 1e-9 < time) sim.tick();
}

function ground(sim: Sim, p: Vec3): Vec3 {
  const q = sim.ground.nearestWalkable(p, 40);
  if (!q || q.y === undefined) throw new Error('no ground');
  return { x: q.x, y: q.y, z: q.z };
}

function place(u: Unit, p: Vec3): void {
  u.pos = { ...p };
  u.path = [];
}

function aside(sim: Sim, p: Vec3, s: number): Vec3 {
  const R = sim.royaleMode!.layout.radius;
  const dir = dirTo(p, { x: 0, y: R, z: 0 }) ?? { x: 1, y: 0, z: 0 };
  return along(p, dir as Vec3, s, R);
}

function combatCtx(sim: Sim): Parameters<typeof dealDamage>[0] {
  return (sim as unknown as { ctx(): Parameters<typeof dealDamage>[0] }).ctx();
}

// A Seedfall landed by hand in the middle of the light, and its cache.
function seedfallHere(sim: Sim): CacheState {
  const p = ground(sim, sim.royale!.dusk.now.center);
  sim.royale!.seedfalls.push({
    id: 90,
    pos: p,
    announcedAt: sim.time,
    landsAt: sim.time + 0.5,
    landed: false,
    cacheId: null,
  });
  runUntil(sim, sim.time + 1);
  return sim.royale!.caches.find((c) => c.kind === 'seedfall')!;
}

describe('in a Respawn match', () => {
  it('holds an opening through a hit, and the opener sees its bar slow', () => {
    const { sim, units } = landed(2, 'respawn');
    const [u, foe] = units as [Unit, Unit];
    const cache = seedfallHere(sim);
    place(u, ground(sim, cache.pos));
    place(foe, ground(sim, aside(sim, cache.pos, 20)));
    runUntil(sim, sim.time + 1);
    expect(cache.opener).toBe(u.id);
    const before = buildObservation(sim, u.id)!.royale!.opening!;
    const countedBefore = sim.time - before.since;
    dealDamage(combatCtx(sim), foe.id, u, 10, 'true');
    runUntil(sim, sim.time + 0.5);
    expect(cache.opener).toBe(u.id);
    const after = buildObservation(sim, u.id)!.royale!.opening!;
    // Half a second under the hit counted a quarter of a second.
    expect(sim.time - after.since - countedBefore).toBeCloseTo(0.5 * SEEDFALL_HELD_RATE, 6);
    const seen = buildObservation(sim, u.id)!.royale!.seedfalls!.find((f) => f.id === 90)!;
    expect(seen.opener).toEqual({ id: u.id, since: after.since });
    runUntil(sim, sim.time + SEEDFALL_OPEN_S);
    expect(cache.present).toBe(false);
  });

  it('breaks the same opening on a hit in One life', () => {
    const { sim, units } = landed(2, 'one_life');
    const [u, foe] = units as [Unit, Unit];
    const cache = seedfallHere(sim);
    place(u, ground(sim, cache.pos));
    place(foe, ground(sim, aside(sim, cache.pos, 20)));
    runUntil(sim, sim.time + 1);
    expect(cache.opener).toBe(u.id);
    dealDamage(combatCtx(sim), foe.id, u, 10, 'true');
    sim.tick();
    expect(cache.opener).toBeNull();
  });
});

describe('a whole Respawn match of house bots', () => {
  it('opens its Seedfalls, most of them fought over', () => {
    const seed = 2;
    const champs = royaleHouseChampions(seed, 50);
    const all: ReplayPick[] = champs.map((championId, i) => ({
      name: `house${i}`,
      team: i,
      championId,
      sigils: ['riftstep', 'mend'],
      bot: 'royale',
    }));
    const { sim } = buildRoyaleSim(loadPlanet(), seed, all, 'respawn');
    const mode = sim.royaleMode!;
    while (mode.state.stage !== 'over' && sim.time < DROP_S + PLAY_S + 5) sim.tick();
    const t = mode.tally;
    expect(t.seedfallsLanded).toBe(10);
    // Tranche 1, before the held opening: 3 to 6 of 10 opened, 0 to 2
    // fought over (seeds 1 to 3).
    expect(t.seedfallsOpened).toBeGreaterThanOrEqual(9);
    expect(t.seedfallsContested).toBeGreaterThanOrEqual(t.seedfallsOpened * 0.6);
    // The field still fights: about ninety takedowns a minute.
    expect(t.takedowns).toBeGreaterThan(600);
  }, 300_000);
});
