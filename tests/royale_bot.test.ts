// The battle royale bot's decisions (src/sim/royale/bot/), on observations
// built by hand: the skill mix by seat, the drop, out of the dark, ahead of
// the Dusk by a launch pad, looting, the fight's odds by skill, aiming
// where the target will be, backing off when low and losing, the swing
// never thrown away, never chasing into the dark; and the bots with
// intent: fights that end (the commit, the exits, the follow into a
// bush, the sigils), the calm and the sharpening, the calls (a Seedfall,
// the ambush, a Clamor), the wander that never starts beside a goal, and
// a dead Respawn seat's pick of where to come back.

import { describe, expect, it } from 'vitest';
import {
  AMBUSH_WAIT_S,
  CALL_WALK_SPEED,
  CALM_NERVE,
  CLAMOR_ALIVE,
  CLAMOR_PHASE,
  ONE_LIFE_PACE,
  PACE_NERVE_MAX,
  PACE_NERVE_PER_SEAT,
  ROAM_GOAL_M,
  ROYALE_SKILLS,
  SEEDFALL_LATE_S,
  SEEDFALL_STANDOFF_M,
} from '../src/sim/content/bots/royale_skills';
import { CHAMPIONS } from '../src/sim/content/champions';
import { dirTo, dist, type Vec3 } from '../src/sim/geo';
import type { Action, Observation, ObsRoyale, ObsSeedfall, ObsUnit } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import {
  CAMP_CLEAR_M,
  decide,
  effectiveSkill,
  nerveOf,
  paceAlive,
  paceNerve,
  RESPAWN_PICK_S,
  ROOM_M,
  SETTLE_M,
} from '../src/sim/royale/bot/brain';
import { royaleCall } from '../src/sim/royale/bot/calls';
import { HOT_DROP_M, pickDropPoint } from '../src/sim/royale/bot/drop_pick';
import { aimAt, royaleOdds } from '../src/sim/royale/bot/fight';
import { buildSense } from '../src/sim/royale/bot/sense';
import { skillMix } from '../src/sim/royale/bot/skill';
import { ARRIVED_M, moveTo } from '../src/sim/royale/bot/travel';
import { drawDusk, duskAt, insideCap } from '../src/sim/royale/dusk';
import { along } from '../src/sim/royale/layout';
import { padSites } from '../src/sim/royale/pads';
import { type DuskState, RESPAWN_S } from '../src/sim/royale/types';
import { DT } from '../src/sim/types';
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
    expect(soft.filter((m) => m === 'gentle').length).toBe(25);
    expect(soft.filter((m) => m === 'normal').length).toBe(18);
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
    // Standing idle, it holds (a stop holds its fire too); holding, it
    // keeps holding.
    const idle = obs(beside, { royale: { caches: [cache] } });
    expect(decide(idle, new Rng(1), layout, gentle).kind).toBe('stop');
    const still = obs(beside, { royale: { caches: [cache] } }, { holding: true });
    expect(decide(still, new Rng(1), layout, gentle).kind).toBe('noop');
    const opening = obs(
      beside,
      { royale: { caches: [cache], opening: { cacheId: 3, since: 19 } } },
      { holding: true },
    );
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

  it('takes an even fight at every skill, in either variant, once the calm is over', () => {
    // A playtest (2026-10-03): in One life the bots let each other be and
    // only came for a low champion someone else had worn down.
    const e = enemy(9, along(here, east, 5, R));
    const loot = along(here, north, 20, R);
    const caches = [{ id: 1, x: loot.x, y: loot.y, z: loot.z, golden: false }];
    const dusk = { ...wholeDusk(sph(1, 0, 0)), phase: 1 };
    for (const skill of [gentle, normal, strong]) {
      for (const variant of ['one_life', 'respawn'] as const) {
        let fights = 0;
        for (let seed = 1; seed <= 20; seed++) {
          const a = decide(
            obs(here, { units: [e], royale: { caches, variant, dusk } }),
            new Rng(seed),
            layout,
            skill,
          );
          // A slot its eye is elsewhere keeps to its order, holding its
          // fire where it stands: never a walk off to the cache with the
          // enemy beside it.
          expect(`${skill.id} ${variant} ${a.kind}`).toMatch(/ (cast|attack|noop|stop)$/);
          if (a.kind === 'cast' || a.kind === 'attack') fights++;
        }
        expect(fights).toBeGreaterThanOrEqual(Math.floor(20 * skill.attention * 0.6));
      }
    }
  });

  it('runs from a far stronger enemy close by', () => {
    const at = along(here, east, 6, R);
    const hearts = Array.from({ length: 6 }, () => 'colossus_heart');
    const fed = enemy(9, at, { level: 18, items: hearts });
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

  it('backs off when hurt only from a fight it is losing', () => {
    // A playtest (2026-10-03): hurt bots backed off from every enemy in
    // reach, and two of them that met circled one another without a blow.
    const at = along(here, east, 4, R);
    const self = { hp: 180, hpFrac: 0.3, struckAt: 19.8, sigilReady: [false, false] };
    const fresh = decide(obs(here, { units: [enemy(9, at)] }, self), new Rng(1), layout, normal);
    expect(fresh.kind).toBe('move');
    expect(dist(point(fresh), at)).toBeGreaterThan(dist(here, at));
    const worse = enemy(9, at, { hpFrac: 0.2 });
    const fights = decide(obs(here, { units: [worse] }, self), new Rng(1), layout, normal);
    expect(['cast', 'attack']).toContain(fights.kind);
  });

  it('never throws its own swing away for a sidestep or a kite step', () => {
    // On top of it, with a bolt on course: between swings a strong bot
    // steps aside or back; mid-swing it holds, and the strike lands. Past
    // the calm, where an even duel is a fight for a strong bot (in the
    // calm its nerve sits a hair over even odds and it gives room).
    const e = enemy(9, along(here, east, 2.5, R));
    const from = along(here, north, 6, R);
    const dir = dirTo(from, here) as Vec3;
    const bolt = {
      x: from.x,
      y: from.y,
      z: from.z,
      dirX: dir.x,
      dirY: dir.y,
      dirZ: dir.z,
      speed: 20,
      radius: 0.5,
      friendly: false,
      homing: false,
    };
    const quiet = { abilityReady: { Q: false, W: false, E: false, R: false }, attackReadyAt: 21.5 };
    let moved = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const at = (swing: number | null) =>
        decide(
          {
            ...obs(
              here,
              { units: [e], royale: { dusk: phase1 } },
              { ...quiet, attackSwingUntil: swing },
            ),
            projectiles: [bolt],
          },
          new Rng(seed),
          layout,
          strong,
        );
      if (at(null).kind === 'move') moved++;
      expect(at(20.2).kind).toBe('noop');
    }
    expect(moved).toBeGreaterThanOrEqual(7);
  });

  it('counts the nearest bystanders only, so a crowd still fights', () => {
    const target = enemy(9, along(here, east, 5, R));
    const crowd = Array.from({ length: 12 }, (_, i) =>
      enemy(20 + i, along(here, north, 6 + i * 0.5, R)),
    );
    const sense = buildSense(obs(here, { units: [target, ...crowd] }), royale(), layout, normal);
    expect(royaleOdds(sense, target)).toBeCloseTo(1 / 2.5, 9);
    expect(royaleOdds(sense)).toBeLessThan(0.15);
  });

  it('weighs a bystander beside a strong bot as a third fighter', () => {
    const target = enemy(9, along(here, east, 5, R));
    const beside = enemy(10, along(here, north, 7, R));
    const off = enemy(11, along(here, north, 12, R));
    const units = [target, beside, off];
    const s = buildSense(obs(here, { units }), royale(), layout, strong);
    // Two at full weight against the strong bot, the third at a quarter.
    expect(royaleOdds(s, target)).toBeCloseTo(1 / 3.25, 9);
    const n = buildSense(obs(here, { units }), royale(), layout, normal);
    expect(royaleOdds(n, target)).toBeCloseTo(1 / 2.5, 9);
    expect(strong.fightOdds).toBeCloseTo(0.46, 9);
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

// The bots with intent (docs: the royale design package, bots-with-intent).

const phase1 = { ...wholeDusk(sph(1, 0, 0)), phase: 1 };
const quiet = {
  abilityReady: { Q: false, W: false, E: false, R: false },
  sigils: [] as string[],
  sigilReady: [] as boolean[],
};

function whys(
  o: Observation,
  skill = strong,
  lay = layout,
  seed = 1,
): { a: Action; why: string[] } {
  const why: string[] = [];
  const a = decide(o, new Rng(seed), lay, skill, (w) => why.push(w));
  return { a, why };
}

function walking(at: Vec3, speed: number, extra: Partial<ObsUnit> = {}): ObsUnit {
  return enemy(9, at, { vx: east.x * speed, vy: east.y * speed, vz: east.z * speed, ...extra });
}

function hits(a: Action): boolean {
  return a.kind === 'attack' || a.kind === 'cast';
}

describe('fights that end', () => {
  it('chases a leaving target past its chase while it can catch it, and no further', () => {
    const past = along(here, east, strong.chase + 3, R);
    const at = (u: ObsUnit, self = {}) =>
      decide(
        obs(here, { units: [u], royale: { dusk: phase1 } }, { ...quiet, ...self }),
        new Rng(1),
        layout,
        strong,
      );
    // Slower than the bot: caught.
    expect(hits(at(walking(past, 3, { hpFrac: 0.5 })))).toBe(true);
    // Faster, healthy, nothing to catch it with: let go.
    expect(hits(at(walking(past, 4.5, { hpFrac: 0.5 })))).toBe(false);
    // Faster but under 40%: chased.
    expect(hits(at(walking(past, 4.5, { hpFrac: 0.35 })))).toBe(true);
    // Faster, with the Zephyr ready: chased.
    const zephyr = { sigils: ['zephyr'], sigilReady: [true] };
    expect(hits(at(walking(past, 4.5, { hpFrac: 0.5 }), zephyr))).toBe(true);
    // Faster, with a dash of its own ready (Fenn's Lunge): chased.
    const fenn = { championId: 'fenn', abilityReady: { Q: true, W: false, E: false, R: false } };
    const lunge = at(walking(past, 4.5, { hpFrac: 0.5 }), fenn);
    expect(lunge.kind === 'attack' || lunge.kind === 'cast').toBe(true);
    // Past the chase and the commit: never.
    const beyond = along(here, east, strong.chase + 5, R);
    expect(dist(here, beyond)).toBeGreaterThan(strong.chase + 4);
    expect(hits(at(walking(beyond, 3, { hpFrac: 0.2 })))).toBe(false);
    // A target standing still past the chase is no chase at all.
    expect(hits(at(enemy(9, past, { hpFrac: 0.5 })))).toBe(false);
  });

  it('follows a target into the bush to where it was last seen, and stops after 4 s', () => {
    const seen = along(here, east, 7, R);
    const rec = (at: number, hpFrac = 0.3) => ({
      id: 9,
      x: seen.x,
      y: seen.y,
      z: seen.z,
      at,
      hpFrac,
    });
    const followed = whys({ ...obs(here, { royale: { dusk: phase1 } }), lastSeen: [rec(17)] });
    expect(followed.why).toEqual(['follow']);
    expect(dist(point(followed.a), seen)).toBeLessThan(0.01);
    const stale = whys({ ...obs(here, { royale: { dusk: phase1 } }), lastSeen: [rec(16)] });
    expect(stale.why).not.toContain('follow');
    // Not a fight the bot was winning: let be.
    const even = whys({ ...obs(here, { royale: { dusk: phase1 } }), lastSeen: [rec(19, 1)] });
    expect(even.why).not.toContain('follow');
  });

  it('backs off a losing fight only toward an exit, and answers with none', () => {
    const at = along(here, east, 4, R);
    const self = { ...quiet, hp: 120, hpFrac: 0.2, struckAt: 19.8 };
    const on = (units: ObsUnit[], over: Partial<ObsRoyale> = {}, extra = {}) =>
      whys(obs(here, { units, royale: { dusk: phase1, ...over } }, { ...self, ...extra }), normal);
    // A pad within 15 m the bot reaches first.
    const padAt = along(here, north, 8, R);
    const pad = { id: 0, at: padAt, to: along(padAt, north, 40, R) };
    const viaPad = on([enemy(9, at)], { pads: [pad] });
    expect(viaPad.why).toEqual(['exit']);
    expect(dist(point(viaPad.a), padAt)).toBeLessThan(0.01);
    // A pad nearer the pursuer is no way out.
    const behind = { id: 0, at: along(at, east, 3, R), to: along(at, east, 40, R) };
    expect(on([enemy(9, at)], { pads: [behind] }).why).not.toEqual(['exit']);
    // Another enemy it reaches before its pursuer: dragged into a third fight.
    const thirdAt = along(here, north, 9, R);
    const third = on([enemy(9, at), enemy(10, thirdAt)]);
    expect(third.why).toEqual(['exit']);
    expect(dist(point(third.a), thirdAt)).toBeLessThan(0.01);
    // Its escape (Elowen's E) away from the pursuer.
    const elowen = {
      championId: 'elowen',
      abilityReady: { Q: false, W: false, E: true, R: false },
    };
    const fled = on([enemy(9, at)], {}, elowen);
    expect(fled.why).toEqual(['exit']);
    expect(fled.a.kind).toBe('cast');
    expect(dist(point(fled.a), at)).toBeGreaterThan(dist(here, at));
    // No exit and the odds within NO_EXIT_MARGIN of its nerve: it answers.
    const worn = on([enemy(9, at, { hpFrac: 0.25 })]);
    expect(worn.why).toEqual(['answer']);
    expect(hits(worn.a)).toBe(true);
    // No exit and no chance: a step away.
    const lost = on([enemy(9, at)]);
    expect(lost.why).toEqual(['back-off']);
    expect(dist(point(lost.a), at)).toBeGreaterThan(dist(here, at));
  });

  it('presses the Zephyr after a target leaving its reach and the Sear on a low one', () => {
    const self = { ...quiet, sigils: ['zephyr', 'sear'], sigilReady: [true, true], attackRange: 6 };
    const on = (u: ObsUnit) =>
      decide(obs(here, { units: [u], royale: { dusk: phase1 } }, self), new Rng(1), layout, strong);
    const leavingAt8 = on(walking(along(here, east, 8, R), 3, { hpFrac: 0.5 }));
    expect(leavingAt8).toMatchObject({ kind: 'sigil', slot: 0 });
    const lowAt5 = along(here, east, 5, R);
    const sear = on(enemy(9, lowAt5, { hpFrac: 0.3 }));
    expect(sear).toMatchObject({ kind: 'sigil', slot: 1 });
    expect(dist(point(sear), lowAt5)).toBeLessThan(0.01);
    // A healthy one standing in reach: struck, no sigil spent.
    expect(on(enemy(9, lowAt5, { hpFrac: 0.5 })).kind).toBe('attack');
    // Out of the Sear's reach: no Sear.
    const lowAt8 = on(enemy(9, along(here, east, 8, R), { hpFrac: 0.3 }));
    expect(lowAt8.kind).toBe('attack');
    // The Zephyr as the escape of a losing fight.
    const losing = decide(
      obs(
        here,
        { units: [enemy(9, along(here, east, 4, R))], royale: { dusk: phase1 } },
        { ...quiet, hp: 120, hpFrac: 0.2, struckAt: 19.8, sigils: ['zephyr'], sigilReady: [true] },
      ),
      new Rng(1),
      layout,
      normal,
    );
    expect(losing).toMatchObject({ kind: 'sigil', slot: 0 });
  });
});

describe('the calm and the sharpening', () => {
  it("raises the odds a fight must show by CALM_NERVE in One life's calm only, unless struck", () => {
    const e = enemy(9, along(here, east, 8, R));
    const at = (royaleOver: Partial<ObsRoyale>, self = {}) =>
      decide(
        obs(here, { units: [e], royale: royaleOver }, { ...quiet, ...self }),
        new Rng(1),
        layout,
        strong,
      );
    expect(hits(at({}))).toBe(false);
    expect(hits(at({ dusk: phase1 }))).toBe(true);
    expect(hits(at({ variant: 'respawn' }))).toBe(true);
    expect(hits(at({}, { struckAt: 19.5 }))).toBe(true);
    const sense = (d: DuskState, variant: 'one_life' | 'respawn' = 'one_life') =>
      buildSense(
        obs(here, { units: [e], royale: { dusk: d, variant } }),
        royale({ dusk: d, variant }),
        layout,
        normal,
      );
    const calm = wholeDusk(sph(1, 0, 0));
    expect(nerveOf(sense(calm), false) - nerveOf(sense(phase1), false)).toBeCloseTo(CALM_NERVE, 9);
    expect(nerveOf(sense(calm, 'respawn'), false)).toBeCloseTo(normal.fightOdds, 9);
  });

  it('plays a seat as normal from a score of 2, as strong from 4, a gentle one as normal from phase 3', () => {
    const at = (score: number, phase = 0) =>
      royale({ score, dusk: { ...wholeDusk(sph(1, 0, 0)), phase } });
    expect(effectiveSkill(gentle, at(1)).id).toBe('gentle');
    expect(effectiveSkill(gentle, at(2)).id).toBe('normal');
    expect(effectiveSkill(gentle, at(4)).id).toBe('strong');
    expect(effectiveSkill(normal, at(3)).id).toBe('normal');
    expect(effectiveSkill(normal, at(4)).id).toBe('strong');
    expect(effectiveSkill(strong, at(0)).id).toBe('strong');
    expect(effectiveSkill(gentle, at(0, 2)).id).toBe('gentle');
    expect(effectiveSkill(gentle, at(0, 3)).id).toBe('normal');
    expect(effectiveSkill(normal, at(0, 5)).id).toBe('normal');
  });
});

describe('the calls', () => {
  function seedfall(at: Vec3, over: Partial<ObsSeedfall> = {}): ObsSeedfall {
    return { id: 1, x: at.x, y: at.y, z: at.z, landsAt: 40, landed: false, ...over };
  }
  const callOf = (o: Observation, skill = normal) =>
    royaleCall(buildSense(o, o.royale!, layout, skill));

  it('races to a Seedfall only while it can arrive by 5 s past the landing', () => {
    const at = along(here, east, 40, R);
    const walk = dist(here, at) / CALL_WALK_SPEED;
    const landsAt = 20 + walk - SEEDFALL_LATE_S;
    const on = (t: number) =>
      callOf(obs(here, { royale: { seedfalls: [seedfall(at, { landsAt: t })] } }));
    expect(on(landsAt)?.kind).toBe('seedfall');
    expect(on(landsAt + 15)?.kind).toBe('seedfall');
    expect(on(landsAt - DT)).toBeNull();
  });

  it('hears a Seedfall within its skill reach and not a meter past it', () => {
    for (const skill of [gentle, normal, strong]) {
      const reach = skill.seedfallM;
      const inside = along(here, east, reach - 0.01, R);
      const outside = along(here, east, reach + 0.5, R);
      expect(dist(here, inside)).toBeLessThanOrEqual(reach);
      expect(dist(here, outside)).toBeGreaterThan(reach);
      const on = (p: Vec3) =>
        callOf(obs(here, { royale: { seedfalls: [seedfall(p, { landed: true })] } }), skill);
      expect(on(inside)?.kind).toBe('seedfall');
      expect(on(outside)).toBeNull();
    }
    // Hurt: no call at all.
    const at = along(here, east, 10, R);
    const hurt = obs(
      here,
      { royale: { seedfalls: [seedfall(at, { landed: true })] } },
      { hpFrac: 0.59 },
    );
    expect(callOf(hurt)).toBeNull();
  });

  it('waits off the point out of the impact, then opens its cache', () => {
    const at = along(here, east, 20, R);
    const sf = seedfall(at, { landsAt: 25 });
    const go = whys(obs(here, { royale: { seedfalls: [sf] } }), normal);
    expect(go.why).toEqual(['seedfall']);
    expect(dist(point(go.a), at)).toBeCloseTo(SEEDFALL_STANDOFF_M, 0);
    const off = along(at, dirTo(at, here) as Vec3, SEEDFALL_STANDOFF_M, R);
    expect(whys(obs(off, { royale: { seedfalls: [sf] } }), normal).a.kind).toBe('stop');
    const held = obs(off, { royale: { seedfalls: [sf] } }, { holding: true });
    expect(whys(held, normal).a.kind).toBe('noop');
    const cache = { id: 7, x: at.x, y: at.y, z: at.z, golden: false, kind: 'seedfall' as const };
    const landed = { ...sf, landed: true };
    const open = whys(obs(off, { royale: { seedfalls: [landed], caches: [cache] } }), normal);
    expect(open.why).toEqual(['seedfall']);
    expect(dist(point(open.a), at)).toBeLessThan(0.01);
  });

  describe('the ambush', () => {
    const seed = along(here, east, 10, R);
    const bushAt = along(seed, north, 9, R);
    const bushy = { ...layout, bushes: [{ at: bushAt, r: 2 }] };
    const sf = seedfall(seed, { landsAt: 25 });
    const opener = enemy(9, along(seed, east, 3, R));
    const on = (over: {
      at?: Vec3;
      sf?: ObsSeedfall;
      e?: ObsUnit;
      time?: number;
      lay?: typeof layout;
      self?: object;
    }) => {
      const o = obs(
        over.at ?? here,
        { units: [over.e ?? opener], royale: { seedfalls: [over.sf ?? sf] } },
        over.self ?? {},
      );
      return whys({ ...o, time: over.time ?? 20 }, normal, over.lay ?? bushy);
    };

    it('waits in the nearest bush beside a Seedfall another champion stands at', () => {
      const wait = on({});
      expect(wait.why).toEqual(['ambush-wait']);
      expect(dist(point(wait.a), bushAt)).toBeLessThan(0.01);
      expect(on({ at: bushAt }).a.kind).toBe('stop');
      expect(on({ at: bushAt, self: { holding: true } }).a.kind).toBe('noop');
    });

    it('strikes when the opening starts, the opener falls under 60%, or 10 s past the landing', () => {
      const opening = on({
        at: bushAt,
        sf: { ...sf, landed: true, opener: { id: 9, since: 26 } },
        time: 27,
      });
      expect(opening.why).toEqual(['ambush-strike']);
      expect(hits(opening.a)).toBe(true);
      const worn = on({ at: bushAt, e: { ...opener, hpFrac: 0.55 } });
      expect(worn.why).toEqual(['ambush-strike']);
      expect(on({ at: bushAt, time: 25 + AMBUSH_WAIT_S - DT }).why).toEqual(['ambush-wait']);
      expect(on({ at: bushAt, time: 25 + AMBUSH_WAIT_S }).why).toEqual(['ambush-strike']);
    });

    it('strikes at once with no bush, and fights as ever once struck', () => {
      expect(on({ lay: layout }).why).toEqual(['ambush-strike']);
      expect(on({ self: { struckAt: 19.5 } }).why).not.toContain('ambush-wait');
    });

    it("holds its cue in One life while the field's pace asks more of a fight, never in Respawn", () => {
      // Twenty fallen ten seconds after the landing: the pace's whole nerve.
      const ahead = (variant: 'one_life' | 'respawn') => {
        const o = obs(
          bushAt,
          {
            units: [opener],
            royale: {
              variant,
              alive: 30,
              seedfalls: [{ ...sf, landed: true, opener: { id: 9, since: 26 } }],
            },
          },
          {},
        );
        return whys({ ...o, time: 27 }, normal, bushy);
      };
      const held = ahead('one_life');
      expect(held.why).toEqual(['ambush-hold']);
      expect(hits(held.a)).toBe(false);
      expect(ahead('respawn').why).toEqual(['ambush-strike']);
      // Away from its bush, it walks back to it.
      const o = obs(here, { units: [opener], royale: { alive: 30, seedfalls: [sf] } }, {});
      const back = whys({ ...o, time: 25 + AMBUSH_WAIT_S }, normal, bushy);
      expect(back.why).toEqual(['ambush-hold']);
      expect(dist(point(back.a), bushAt)).toBeLessThan(0.01);
    });
  });

  describe('the Clamor', () => {
    const clamorAt = along(here, east, 25, R);
    const clamor = (at = 19, p = clamorAt) => ({ x: p.x, y: p.y, z: p.z, at });
    const on = (over: Partial<ObsRoyale>, skill = normal, self = {}) =>
      whys(obs(here, { royale: { clamors: [clamor()], ...over } }, self), skill);
    const late = { ...wholeDusk(sph(1, 0, 0)), phase: CLAMOR_PHASE };

    it('draws normal and strong bots in late One life only', () => {
      expect(on({ alive: 26 }).why).not.toContain('clamor');
      const answered = on({ dusk: late });
      expect(answered.why).toEqual(['clamor']);
      expect(dist(point(answered.a), clamorAt)).toBeLessThan(0.01);
      expect(on({ alive: CLAMOR_ALIVE }).why).toEqual(['clamor']);
      expect(on({ dusk: late, variant: 'respawn' }).why).not.toContain('clamor');
      expect(on({ dusk: late }, gentle).why).not.toContain('clamor');
      expect(on({ dusk: late }, normal, { hpFrac: 0.69 }).why).not.toContain('clamor');
      expect(on({ dusk: late, clamors: [clamor(17)] }).why).not.toContain('clamor');
    });

    it('hears it within 30 m for a normal bot and 45 m for a strong one', () => {
      for (const skill of [normal, strong]) {
        const inside = along(here, east, skill.clamorM - 0.01, R);
        const outside = along(here, east, skill.clamorM + 0.5, R);
        expect(dist(here, outside)).toBeGreaterThan(skill.clamorM);
        const at = (p: Vec3) => on({ dusk: late, clamors: [clamor(19, p)] }, skill).why;
        expect(at(inside)).toEqual(['clamor']);
        expect(at(outside)).not.toContain('clamor');
      }
    });
  });

  it('roams toward a Seedfall within 80 m rather than wander', () => {
    const at = along(here, east, 60, R);
    const to = whys(obs(here, { royale: { seedfalls: [seedfall(at, { landsAt: 200 })] } }), gentle);
    expect(to.why).toEqual(['roam']);
    expect(dist(point(to.a), at)).toBeLessThan(dist(here, at) - 40);
    const far = along(here, east, 84, R);
    expect(dist(here, far)).toBeGreaterThan(ROAM_GOAL_M);
    const wander = whys(
      obs(here, { royale: { seedfalls: [seedfall(far, { landsAt: 200 })] } }),
      gentle,
    );
    expect(dist(point(wander.a), here)).toBeLessThanOrEqual(12);
  });
});

describe('a dead Respawn seat', () => {
  const at = along(here, east, 30, R);
  const sf = (landsAt: number) => ({ id: 1, x: at.x, y: at.y, z: at.z, landsAt, landed: false });
  const dead = (landsAt: number, over: Partial<ObsRoyale> = {}) =>
    decide(
      obs(
        here,
        { royale: { variant: 'respawn', seedfalls: [sf(landsAt)], drop: null, ...over } },
        { dead: true },
      ),
      new Rng(1),
      layout,
      normal,
    );

  it('picks to come back beside a Seedfall landing within 20 s of its return', () => {
    const back = 20 + RESPAWN_S;
    const pick = dead(back + RESPAWN_PICK_S);
    expect(pick.kind).toBe('drop');
    expect(dist(point2(pick), at)).toBeLessThan(0.01);
    expect(dead(back - RESPAWN_PICK_S).kind).toBe('drop');
    expect(dead(back + RESPAWN_PICK_S + DT).kind).toBe('noop');
    expect(dead(back + RESPAWN_PICK_S, { variant: 'one_life' }).kind).toBe('noop');
  });

  it('picks the point inside the light nearest a Seedfall outside it', () => {
    const d: DuskState = { ...phase1, now: { center: here, radius: 12 } };
    const pick = dead(30, { dusk: d });
    expect(pick.kind).toBe('drop');
    expect(insideCap(d.now, point2(pick))).toBe(true);
    expect(dist(point2(pick), at)).toBeLessThan(dist(here, at));
  });
});

function point2(a: Action): Vec3 {
  if (a.kind !== 'drop') throw new Error(`no drop in ${a.kind}`);
  return { x: a.x, y: a.y, z: a.z };
}

describe("One life's pace", () => {
  it('reads the pace off the minutes since the landing', () => {
    const r = royale();
    expect(paceAlive(r, 10)).toBe(ONE_LIFE_PACE[0]);
    expect(paceAlive(r, 70)).toBeCloseTo(ONE_LIFE_PACE[1]!, 9);
    expect(paceAlive(r, 100)).toBeCloseTo((ONE_LIFE_PACE[1]! + ONE_LIFE_PACE[2]!) / 2, 9);
    expect(paceAlive(r, 10_000)).toBe(ONE_LIFE_PACE[ONE_LIFE_PACE.length - 1]);
  });

  it('asks more of a fight for every champion fallen ahead of the pace, never less, in One life only', () => {
    // A minute after the landing the pace expects 44 still in.
    const at = 70;
    expect(paceNerve(royale({ alive: 44 }), at)).toBeCloseTo(0, 9);
    expect(paceNerve(royale({ alive: 41 }), at)).toBeCloseTo(3 * PACE_NERVE_PER_SEAT, 9);
    expect(paceNerve(royale({ alive: 48 }), at)).toBe(0);
    expect(paceNerve(royale({ alive: 5 }), at)).toBe(PACE_NERVE_MAX);
    expect(paceNerve(royale({ alive: 30, variant: 'respawn' }), at)).toBe(0);
    // A struck bot reads its own nerve.
    const e = enemy(9, along(here, east, 8, R));
    const ahead = { alive: 41, dusk: phase1 };
    const calm = obs(here, { units: [e], royale: ahead });
    const sense = buildSense({ ...calm, time: at }, royale(ahead), layout, normal);
    expect(nerveOf(sense, false)).toBeCloseTo(normal.fightOdds + 3 * PACE_NERVE_PER_SEAT, 9);
    const hit = obs(here, { units: [e], royale: ahead }, { struckAt: at - 1 });
    const struck = buildSense({ ...hit, time: at }, royale(ahead), layout, normal);
    expect(nerveOf(struck, false)).toBeCloseTo(normal.fightOdds, 9);
  });
});

describe('holding its fire', () => {
  // The sim's idle defense strikes any enemy in reach of a champion standing
  // idle: a bot that has not chosen a fight holds instead.
  const e = enemy(9, along(here, east, 5, R));
  const unnoticedSlot = (self: object) => {
    // Gentle's eye misses the enemy on some slots: find one.
    for (let seed = 1; seed < 50; seed++) {
      const o = obs(here, { units: [e], royale: { dusk: phase1 } }, self);
      const r = whys(o, gentle, layout, seed);
      if (r.why[0] === 'unnoticed') return r.a;
    }
    throw new Error('no unnoticed slot');
  };

  it('holds on a slot its eye is elsewhere, but never throws a swing or a long walk away', () => {
    expect(unnoticedSlot({}).kind).toBe('stop');
    expect(unnoticedSlot({ holding: true }).kind).toBe('noop');
    expect(unnoticedSlot({ attackSwingUntil: 20.2 }).kind).toBe('noop');
    const far = along(here, north, 10, R);
    expect(unnoticedSlot({ dest: far }).kind).toBe('noop');
    // A walk about to end holds before its end leaves the bot idle.
    const near = along(here, north, SETTLE_M - 0.5, R);
    expect(unnoticedSlot({ dest: near }).kind).toBe('stop');
  });

  it('holds where it stands rather than walk to where it already is', () => {
    const at = along(here, north, 0.5, R);
    expect(moveTo(buildSense(obs(here), royale(), layout, normal), at).kind).toBe('stop');
    const held = buildSense(obs(here, {}, { holding: true }), royale(), layout, normal);
    expect(moveTo(held, at).kind).toBe('noop');
    const away = along(here, north, ARRIVED_M + 1, R);
    expect(moveTo(buildSense(obs(here), royale(), layout, normal), away).kind).toBe('move');
  });

  it('takes no camp, nor walks to one, with an enemy champion beside it', () => {
    const campAt = along(here, north, 10, R);
    const camp = {
      x: campAt.x,
      y: campAt.y,
      z: campAt.z,
      kind: 'spinecrest' as const,
      seenAt: null,
      up: null,
      downSince: null,
    };
    const body: ObsUnit = {
      id: 30,
      kind: 'camp',
      friendly: false,
      x: campAt.x,
      y: campAt.y,
      z: campAt.z,
      hpFrac: 1,
      radius: 0.6,
    };
    const alone = whys({ ...obs(here, { units: [body] }), camps: [camp] }, gentle);
    expect(alone.why).toEqual(['neutral']);
    const beside = enemy(9, along(here, east, CAMP_CLEAR_M - 1, R));
    for (let seed = 1; seed < 10; seed++) {
      const o = { ...obs(here, { units: [body, beside] }), camps: [camp] };
      const r = whys(o, gentle, layout, seed);
      expect(r.why).not.toContain('neutral');
      expect(r.why).not.toContain('camp');
    }
  });
});

describe('a fight passed on', () => {
  it('gives an enemy close by room rather than loot beside it', () => {
    // The calm and a field fallen ahead of the pace: an even fight is passed on.
    const at = along(here, east, ROOM_M - 1, R);
    const e = enemy(9, at);
    const loot = along(here, east, 3, R);
    const caches = [{ id: 1, x: loot.x, y: loot.y, z: loot.z, golden: false }];
    const r = whys(obs(here, { units: [e], royale: { caches, alive: 40 } }), strong);
    expect(r.why).toEqual(['give-room']);
    expect(dist(point(r.a), at)).toBeGreaterThan(dist(here, at));
    // Farther off, it goes about its business.
    const far = enemy(9, along(here, east, ROOM_M + 2, R));
    const r2 = whys(obs(here, { units: [far], royale: { caches, alive: 40 } }), strong);
    expect(r2.why).not.toContain('give-room');
  });
});
