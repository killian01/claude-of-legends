// The bots and the Burr (src/sim/royale/bot: sense.ts, calls.ts burrCall,
// fight.ts pickTarget and burrMargin): a bot reads its own Burr off its
// observation, walks after the carrier within BURR_CALL_M when no bigger
// call holds and its odds reach its nerve (a normal or strong skill), and
// in sight weighs the carrier a little ahead of the others and fights it
// on a little less. A bounded preference: never past BURR_CALL_M, never
// over a Seedfall, never instead of the fight in front of it.

import { describe, expect, it } from 'vitest';
import {
  BURR_CALL_M,
  BURR_MARGIN,
  BURR_TARGET_PULL,
  ROYALE_SKILLS,
} from '../src/sim/content/bots/royale_skills';
import { dirTo, dist, type Vec3 } from '../src/sim/geo';
import type { Action, ObsBurr, Observation, ObsRoyale, ObsUnit } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import { decide } from '../src/sim/royale/bot/brain';
import { burrCall, royaleCall } from '../src/sim/royale/bot/calls';
import { burrMargin, pickTarget, royaleOdds, TARGET_M_WEIGHT } from '../src/sim/royale/bot/fight';
import { buildSense } from '../src/sim/royale/bot/sense';
import { along } from '../src/sim/royale/layout';
import type { DuskState } from '../src/sim/royale/types';
import { fakeLayout, R, sph } from './royale_fixture';

const layout = fakeLayout();
const { gentle, normal, strong } = ROYALE_SKILLS;
const here = sph(1, 0.2, 0.1);
const east = dirTo(here, sph(0, 0, 1)) as Vec3;
const north = dirTo(here, sph(0, 1, 0)) as Vec3;

function dusk(): DuskState {
  const center = sph(1, 0, 0);
  return {
    phase: 1,
    now: { center, radius: 2 * R },
    next: { center, radius: 88 },
    phaseEndsAt: 100,
    shrinking: false,
    burn: 0,
  };
}

function royale(over: Partial<ObsRoyale> = {}): ObsRoyale {
  return {
    variant: 'respawn',
    stage: 'play',
    dropEndsAt: 10,
    endsAt: 610,
    dusk: dusk(),
    caches: [],
    pads: [],
    drop: null,
    opening: null,
    flying: false,
    score: 0,
    alive: 50,
    leader: null,
    ...over,
  };
}

function obs(units: ObsUnit[], r: Partial<ObsRoyale> = {}, self = {}): Observation {
  return {
    tick: 2400,
    time: 120,
    winner: null,
    self: {
      id: 1,
      team: 0,
      x: here.x,
      y: here.y,
      z: here.z,
      hp: 600,
      maxHp: 600,
      hpFrac: 1,
      mana: 300,
      maxMana: 300,
      level: 3,
      gold: 0,
      dead: false,
      abilityReady: { Q: false, W: false, E: false, R: false },
      abilityRanks: { Q: 1, W: 1, E: 1, R: 0 },
      skillPoints: 0,
      sigils: ['riftstep', 'mend'],
      sigilReady: [false, false],
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
    units,
    royale: royale(r),
  };
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

function burrOn(id: number, at: Vec3 | null, extra: Partial<ObsBurr> = {}): ObsBurr {
  return { id, level: 3, until: 150, ...(at ? { at: { ...at } } : {}), ...extra };
}

function sense(o: Observation, skill = normal) {
  return buildSense(o, o.royale!, layout, skill);
}

function whyOf(o: Observation, skill = normal, seed = 1): { why: string; a: Action } {
  let why = '';
  const a = decide(o, new Rng(seed), layout, skill, (w) => {
    why = w;
  });
  return { why, a };
}

describe('a bot reads its own Burr', () => {
  it('while it lasts, and not after', () => {
    const b = burrOn(9, along(here, east, 20, R));
    expect(sense(obs([], { burr: b })).burr).toEqual(b);
    expect(sense(obs([], { burr: { ...b, until: 119.9 } })).burr).toBeNull();
    expect(sense(obs([])).burr).toBeNull();
  });
});

describe("the Burr's call", () => {
  it('walks after the carrier within BURR_CALL_M, and not a meter past it', () => {
    const inside = along(here, east, BURR_CALL_M - 0.5, R);
    const outside = along(here, east, BURR_CALL_M + 0.5, R);
    expect(dist(here, outside)).toBeGreaterThan(BURR_CALL_M);
    for (const skill of [normal, strong]) {
      const call = royaleCall(sense(obs([], { burr: burrOn(9, inside) }), skill), skill.fightOdds);
      expect(call).toMatchObject({ kind: 'burr', x: inside.x, y: inside.y, z: inside.z });
      expect(burrCall(sense(obs([], { burr: burrOn(9, outside) }), skill), 0.45)).toBeNull();
    }
  });

  it('never calls a gentle bot, a hurt one, nor one the carrier outweighs', () => {
    const at = along(here, east, 20, R);
    const b = burrOn(9, at);
    expect(burrCall(sense(obs([], { burr: b }), gentle), gentle.fightOdds)).toBeNull();
    expect(royaleCall(sense(obs([], { burr: b }, { hpFrac: 0.59 })), 0.45)).toBeNull();
    const fed = burrOn(9, at, { level: 12 });
    expect(burrCall(sense(obs([], { burr: fed })), normal.fightOdds)).toBeNull();
  });

  it('has nowhere to walk while the carrier is down, or in the dark', () => {
    expect(burrCall(sense(obs([], { burr: burrOn(9, null) })), 0.45)).toBeNull();
    const small: DuskState = {
      ...dusk(),
      now: { center: here, radius: 30 },
      next: { center: here, radius: 20 },
    };
    const b = burrOn(9, along(here, east, 35, R));
    expect(burrCall(sense(obs([], { burr: b, dusk: small })), 0.45)).toBeNull();
    // The same carrier in a light that holds it: called.
    expect(burrCall(sense(obs([], { burr: b })), 0.45)?.kind).toBe('burr');
  });

  it('gives way to a Seedfall', () => {
    const sf = along(here, north, 25, R);
    const o = obs([], {
      burr: burrOn(9, along(here, east, 20, R)),
      seedfalls: [{ id: 1, x: sf.x, y: sf.y, z: sf.z, landsAt: 125, landed: false }],
    });
    expect(royaleCall(sense(o), normal.fightOdds)?.kind).toBe('seedfall');
  });

  it('walks the bot toward the carrier with nothing in sight', () => {
    const at = along(here, east, 30, R);
    const { why, a } = whyOf(obs([], { burr: burrOn(9, at) }));
    expect(why).toBe('burr');
    expect(a.kind).toBe('move');
  });

  it('never keeps the bot from the fight in front of it', () => {
    const front = enemy(7, along(here, north, 5, R));
    const o = obs([front], { burr: burrOn(9, along(here, east, 30, R)) });
    const { why, a } = whyOf(o, strong);
    expect(why).toBe('fight');
    expect(a).toMatchObject({ kind: 'attack', targetId: 7 });
  });
});

describe('the carrier in sight', () => {
  it('is weighed BURR_TARGET_PULL ahead of the others, a bounded pull', () => {
    const near = enemy(7, along(here, east, 8, R));
    const pullM = BURR_TARGET_PULL / TARGET_M_WEIGHT;
    expect(pullM).toBeCloseTo(2, 6);
    const within = enemy(9, along(here, north, 8 + pullM - 0.5, R));
    const past = enemy(9, along(here, north, 8 + pullM + 0.5, R));
    const at = (u: ObsUnit) => ({ x: u.x, y: u.y!, z: u.z });
    const pick = (carrier: ObsUnit) =>
      pickTarget(sense(obs([near, carrier], { burr: burrOn(9, at(carrier)) }), strong));
    expect(pick(within)?.id).toBe(9);
    expect(pick(past)?.id).toBe(7);
    // With no Burr, the nearer one.
    expect(pickTarget(sense(obs([near, within]), strong))?.id).toBe(7);
  });

  it('is fought on odds BURR_MARGIN under the nerve, anyone else not', () => {
    const at = along(here, east, 9, R);
    const foe = enemy(9, at);
    // Three quarters of its health against a whole even foe: 0.43, under
    // the strong bot's 0.46 and within BURR_MARGIN of it.
    const self = { hpFrac: 0.75, hp: 450 };
    const hunting = obs([foe], { burr: burrOn(9, at) }, self);
    const odds = royaleOdds(sense(hunting, strong), foe);
    expect(odds).toBeLessThan(strong.fightOdds);
    expect(odds).toBeGreaterThanOrEqual(strong.fightOdds - BURR_MARGIN);
    expect(burrMargin(sense(hunting, strong), foe)).toBe(BURR_MARGIN);
    expect(whyOf(hunting, strong).why).toBe('fight');
    const plain = obs([foe], {}, self);
    expect(burrMargin(sense(plain, strong), foe)).toBe(0);
    expect(whyOf(plain, strong).why).not.toBe('fight');
  });
});
