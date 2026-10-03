// The battle royale bot's decisions (src/sim/royale/bot/), on observations
// built by hand: the skill mix by seat, the drop, out of the dark, ahead of
// the Dusk by a launch pad, looting, the fight's odds by skill, aiming
// where the target will be, backing off when low, never chasing into the
// dark.

import { describe, expect, it } from 'vitest';
import { ROYALE_SKILLS } from '../src/sim/content/bots/royale_skills';
import { CHAMPIONS } from '../src/sim/content/champions';
import { dirTo, dist, type Vec3 } from '../src/sim/geo';
import type { Action, Observation, ObsRoyale, ObsUnit } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import { decide } from '../src/sim/royale/bot/brain';
import { HOT_DROP_M, pickDropPoint } from '../src/sim/royale/bot/drop_pick';
import { aimAt, royaleOdds } from '../src/sim/royale/bot/fight';
import { buildSense } from '../src/sim/royale/bot/sense';
import { skillMix } from '../src/sim/royale/bot/skill';
import { drawDusk, duskAt, insideCap } from '../src/sim/royale/dusk';
import { along } from '../src/sim/royale/layout';
import { padSites } from '../src/sim/royale/pads';
import type { DuskState } from '../src/sim/royale/types';
import { fakeGround, fakeLayout, R, sph } from './royale_fixture';

const layout = fakeLayout();
const strong = ROYALE_SKILLS.strong;
const gentle = ROYALE_SKILLS.gentle;
const normal = ROYALE_SKILLS.normal;

function wholeDusk(center: Vec3): DuskState {
  return {
    phase: 0,
    now: { center, radius: 2 * R },
    next: { center, radius: 88 },
    phaseEndsAt: 100,
    shrinking: false,
    burn: 0,
  };
}

function royale(over: Partial<ObsRoyale> = {}): ObsRoyale {
  return {
    variant: 'one_life',
    stage: 'play',
    dropEndsAt: 10,
    endsAt: 610,
    dusk: wholeDusk(sph(1, 0, 0)),
    caches: [],
    pads: [],
    drop: { x: 1, y: 0, z: 0 },
    opening: null,
    flying: false,
    score: 0,
    alive: 50,
    leader: null,
    ...over,
  };
}

function obs(at: Vec3, over: { units?: ObsUnit[]; royale?: Partial<ObsRoyale> } = {}, self = {}) {
  const o: Observation = {
    tick: 400,
    time: 20,
    winner: null,
    self: {
      id: 1,
      team: 0,
      x: at.x,
      y: at.y,
      z: at.z,
      hp: 600,
      maxHp: 600,
      hpFrac: 1,
      mana: 300,
      maxMana: 300,
      level: 3,
      gold: 0,
      dead: false,
      abilityReady: { Q: true, W: true, E: true, R: false },
      abilityRanks: { Q: 1, W: 1, E: 1, R: 0 },
      skillPoints: 0,
      sigils: ['riftstep', 'mend'],
      sigilReady: [true, true],
      items: [],
      championId: 'sylra',
      attackRange: 6,
      attackReadyAt: 0,
      lane: null,
      struckAt: null,
      dest: null,
      moveSpeed: 3.7,
      ...self,
    },
    units: over.units ?? [],
    royale: royale(over.royale),
  };
  return o;
}

function enemy(id: number, at: Vec3, extra: Partial<ObsUnit> = {}): ObsUnit {
  return {
    id,
    kind: 'champion',
    friendly: false,
    x: at.x,
    y: at.y,
    z: at.z,
    hpFrac: 1,
    radius: 0.65,
    level: 3,
    items: [],
    championId: 'dain',
    vx: 0,
    vy: 0,
    vz: 0,
    ...extra,
  };
}

function point(a: Action): Vec3 {
  if (a.kind !== 'move' && a.kind !== 'cast' && a.kind !== 'sigil') {
    throw new Error(`no point in ${a.kind}`);
  }
  return { x: a.x, y: a.y ?? 0, z: a.z };
}

const here = sph(1, 0.2, 0.1);
const north = dirTo(here, sph(0, 1, 0)) as Vec3;
const east = dirTo(here, sph(0, 0, 1)) as Vec3;

describe('the skill mix', () => {
  it('seats about half gentle, a third normal, the rest strong, shuffled by the seed', () => {
    const mix = skillMix(50, new Rng(1));
    const count = (id: string) => mix.filter((m) => m === id).length;
    expect(count('gentle')).toBe(25);
    expect(count('normal')).toBe(17);
    expect(count('strong')).toBe(8);
    expect(skillMix(50, new Rng(1))).toEqual(mix);
    expect(skillMix(50, new Rng(2))).not.toEqual(mix);
    const soft = skillMix(50, new Rng(1), true);
    expect(soft.filter((m) => m === 'gentle').length).toBe(35);
    expect(soft.filter((m) => m === 'strong').length).toBeLessThan(count('strong'));
  });
});

describe('the drop', () => {
  it('picks once, a share in the Sanctuary, the rest over the regions', () => {
    const o = obs(here, { royale: { stage: 'drop', drop: null } });
    const a = decide(o, new Rng(4), layout, strong);
    expect(a.kind).toBe('drop');
    const picked = obs(here, { royale: { stage: 'drop' } });
    expect(decide(picked, new Rng(4), layout, strong).kind).toBe('noop');
    const rng = new Rng(9);
    const sanctuary = layout.regions.find((r) => r.id === 'sanctuary')!.heart;
    let hot = 0;
    const regions = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const p = pickDropPoint(layout, rng);
      if (dist(p, sanctuary) <= HOT_DROP_M + 0.01) hot++;
      let best = layout.regions[0]!;
      for (const r of layout.regions) if (dist(r.heart, p) < dist(best.heart, p)) best = r;
      regions.add(best.id);
    }
    expect(hot / 400).toBeGreaterThan(0.06);
    expect(hot / 400).toBeLessThan(0.2);
    expect(regions.size).toBe(6);
  });
});

describe('the Dusk', () => {
  const s = drawDusk(new Rng(3), layout, fakeGround, 10);

  it('walks out of the dark first', () => {
    const d = duskAt(s, 10 + 300);
    const out = along(
      d.now.center,
      dirTo(d.now.center, sph(0, -1, 0)) as Vec3,
      d.now.radius + 6,
      R,
    );
    const a = decide(obs(out, { royale: { dusk: d } }), new Rng(1), layout, gentle);
    expect(a.kind).toBe('move');
    expect(dist(point(a), d.now.center)).toBeLessThan(dist(out, d.now.center));
    expect(insideCap(d.now, point(a))).toBe(true);
  });

  it('heads for the next cap early, by a pad when the pad shortens the trip', () => {
    const d = duskAt(s, 10 + 230);
    expect(d.shrinking).toBe(false);
    const next = d.next!;
    // Standing just inside the light, far outside the next cap, ten
    // seconds before the light closes on it.
    const at = along(next.center, dirTo(next.center, d.now.center) as Vec3, 0, R);
    const far = along(
      d.now.center,
      dirTo(d.now.center, at === next.center ? sph(0, -1, 0) : at) as Vec3,
      d.now.radius - 3,
      R,
    );
    const late = { tick: 4800, time: 240 };
    const plain = decide(
      { ...obs(far, { royale: { dusk: d } }, { struckAt: null }), ...late },
      new Rng(1),
      layout,
      strong,
    );
    expect(plain.kind).toBe('move');
    expect(dist(point(plain), next.center)).toBeLessThan(dist(far, next.center));
    expect(insideCap(next, point(plain))).toBe(true);
    // A pad at the bot's feet throwing it into the next cap.
    const toward = dirTo(far, next.center) as Vec3;
    const pad = { id: 0, at: along(far, toward, 3, R), to: along(far, toward, 27, R) };
    const viaPad = decide(
      { ...obs(far, { royale: { dusk: d, pads: [pad] } }), ...late },
      new Rng(1),
      layout,
      strong,
    );
    expect(viaPad.kind).toBe('move');
    expect(dist(point(viaPad), pad.at)).toBeLessThan(0.01);
  });
});

describe('looting', () => {
  const cacheAt = along(here, east, 8, R);
  const cache = { id: 3, x: cacheAt.x, y: cacheAt.y, z: cacheAt.z, golden: false };

  it('walks to the nearest standing cache, stops beside it and holds', () => {
    const a = decide(obs(here, { royale: { caches: [cache] } }), new Rng(1), layout, gentle);
    expect(a.kind).toBe('move');
    expect(dist(point(a), cacheAt)).toBeLessThan(0.01);
    const beside = along(cacheAt, east, 0.5, R);
    const walking = obs(beside, { royale: { caches: [cache] } }, { dest: cacheAt });
    expect(decide(walking, new Rng(1), layout, gentle).kind).toBe('stop');
    const still = obs(beside, { royale: { caches: [cache] } });
    expect(decide(still, new Rng(1), layout, gentle).kind).toBe('noop');
    const opening = obs(beside, {
      royale: { caches: [cache], opening: { cacheId: 3, since: 19 } },
    });
    expect(decide(opening, new Rng(1), layout, gentle).kind).toBe('noop');
  });

  it('does not reorder a walk already headed there', () => {
    const o = obs(here, { royale: { caches: [cache] } }, { dest: cacheAt });
    expect(decide(o, new Rng(1), layout, gentle).kind).toBe('noop');
  });
});

describe('fighting', () => {
  it('weighs the odds by health, level and items', () => {
    const e = enemy(9, along(here, east, 5, R));
    const even = buildSense(obs(here, { units: [e] }), royale(), layout, strong);
    expect(royaleOdds(even)).toBeCloseTo(0.5, 6);
    const fed = enemy(9, along(here, east, 5, R), { level: 9, items: ['colossus_heart'] });
    const worse = buildSense(obs(here, { units: [fed] }), royale(), layout, strong);
    expect(royaleOdds(worse)).toBeLessThan(0.42);
  });

  it('takes an even fight at every skill, in either variant, from the calm on', () => {
    // A playtest (2026-10-03): in One life the bots let each other be and
    // only came for a low champion someone else had worn down.
    const e = enemy(9, along(here, east, 5, R));
    const loot = along(here, north, 20, R);
    const caches = [{ id: 1, x: loot.x, y: loot.y, z: loot.z, golden: false }];
    for (const skill of [gentle, normal, strong]) {
      for (const variant of ['one_life', 'respawn'] as const) {
        let fights = 0;
        for (let seed = 1; seed <= 20; seed++) {
          const a = decide(
            obs(here, { units: [e], royale: { caches, variant } }),
            new Rng(seed),
            layout,
            skill,
          );
          // A slot its eye is elsewhere keeps to its order: never a walk
          // off to the cache with the enemy beside it.
          expect(`${skill.id} ${variant} ${a.kind}`).toMatch(/ (cast|attack|noop)$/);
          if (a.kind !== 'noop') fights++;
        }
        expect(fights).toBeGreaterThanOrEqual(Math.floor(20 * skill.attention * 0.6));
      }
    }
  });

  it('runs from a far stronger enemy close by', () => {
    const at = along(here, east, 6, R);
    const hearts = ['colossus_heart', 'colossus_heart', 'colossus_heart', 'colossus_heart'];
    const fed = enemy(9, at, { level: 16, items: hearts });
    for (const skill of [gentle, normal, strong]) {
      const a = decide(
        obs(here, { units: [fed] }, { struckAt: 19.8, sigilReady: [false, false] }),
        new Rng(1),
        layout,
        skill,
      );
      expect(a.kind).toBe('move');
      expect(dist(point(a), at)).toBeGreaterThan(dist(here, at));
    }
  });

  it('counts the nearest bystanders only, so a crowd still fights', () => {
    const target = enemy(9, along(here, east, 5, R));
    const crowd = Array.from({ length: 12 }, (_, i) =>
      enemy(20 + i, along(here, north, 6 + i * 0.5, R)),
    );
    const sense = buildSense(obs(here, { units: [target, ...crowd] }), royale(), layout, strong);
    expect(royaleOdds(sense, target)).toBeCloseTo(1 / 2.5, 9);
    expect(royaleOdds(sense)).toBeLessThan(0.15);
  });

  it('answers a hit and fights on in the last light', () => {
    const s = drawDusk(new Rng(3), layout, fakeGround, 10);
    const d = duskAt(s, 10 + 560);
    expect(d.now.radius).toBeLessThanOrEqual(20);
    const at = d.now.center;
    const e = enemy(9, along(at, dirTo(at, sph(0, -1, 0)) as Vec3, 3, R), { level: 8 });
    const struck = obs(at, { units: [e], royale: { dusk: d } }, { struckAt: 19.8, hpFrac: 0.3 });
    const a = decide(struck, new Rng(1), layout, gentle);
    expect(['cast', 'attack', 'sigil']).toContain(a.kind);
  });

  it('finishes a low enemy whatever the skill', () => {
    const e = enemy(9, along(here, east, 5, R), { hpFrac: 0.15 });
    for (let seed = 1; seed < 20; seed++) {
      const a = decide(
        obs(here, { units: [e] }, { struckAt: 19.5 }),
        new Rng(seed),
        layout,
        gentle,
      );
      expect(['cast', 'attack']).toContain(a.kind);
    }
  });

  it('aims a skillshot where the target will be, the strong better than the gentle', () => {
    const at = along(here, east, 8, R);
    const v = north;
    const e = enemy(9, at, { vx: v.x * 3.7, vy: v.y * 3.7, vz: v.z * 3.7 });
    const q = CHAMPIONS.sylra!.abilities.Q;
    const lead = 3.7 * (8 / 24);
    const sStrong = buildSense(obs(here, { units: [e] }), royale(), layout, strong);
    const sGentle = buildSense(obs(here, { units: [e] }), royale(), layout, gentle);
    let strongErr = 0;
    let gentleErr = 0;
    const ahead = along(at, v, lead, R);
    for (let seed = 1; seed <= 40; seed++) {
      strongErr += dist(aimAt(sStrong, e, q, new Rng(seed)), ahead);
      gentleErr += dist(aimAt(sGentle, e, q, new Rng(seed)), ahead);
    }
    expect(strongErr / 40).toBeLessThan(0.3);
    expect(gentleErr / 40).toBeGreaterThan(strongErr / 40 + 0.5);
  });

  it('backs off when low with an enemy on top of it', () => {
    const at = along(here, east, 4, R);
    const e = enemy(9, at);
    const a = decide(
      obs(
        here,
        { units: [e] },
        { hp: 90, hpFrac: 0.15, struckAt: 19.8, sigilReady: [false, false] },
      ),
      new Rng(1),
      layout,
      strong,
    );
    expect(a.kind).toBe('move');
    expect(dist(point(a), at)).toBeGreaterThan(dist(here, at));
  });

  it('never chases into the dark', () => {
    const s = drawDusk(new Rng(3), layout, fakeGround, 10);
    const d = duskAt(s, 10 + 400);
    const inside = along(
      d.now.center,
      dirTo(d.now.center, sph(0, -1, 0)) as Vec3,
      d.now.radius - 3,
      R,
    );
    const outside = along(
      d.now.center,
      dirTo(d.now.center, sph(0, -1, 0)) as Vec3,
      d.now.radius + 2,
      R,
    );
    const e = enemy(9, outside, { hpFrac: 0.1 });
    for (let seed = 1; seed < 10; seed++) {
      const a = decide(
        obs(inside, { units: [e], royale: { dusk: d } }),
        new Rng(seed),
        layout,
        strong,
      );
      expect(a.kind === 'attack' && a.targetId === 9).toBe(false);
      if (a.kind === 'move') expect(insideCap(d.now, point(a))).toBe(true);
    }
  });
});

describe('the pads as everyone knows them', () => {
  it('are the layout pads, ids in order', () => {
    const pads = padSites(layout.pads);
    expect(pads.map((p) => p.id)).toEqual(pads.map((_, i) => i));
  });
});
