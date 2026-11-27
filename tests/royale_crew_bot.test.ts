// The battle royale bot in Crews (ADR 0034, src/sim/royale/bot/): back to
// the crew's anchor once too far from it (brain.ts regroup), its crewmates
// in reach weighed in a fight's odds (fight.ts royaleOdds), a crewmate's
// mark nobody's hunt (calls.ts); and a drop-in's Arrival beside a crewmate
// clear of any fight (grace.ts arrive).

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import { RoyaleMatch } from '../server/royale_match';
import type { RoyalePerson } from '../server/royale_seats';
import { ROYALE_SKILLS } from '../src/sim/content/bots/royale_skills';
import { dist, type Vec3 } from '../src/sim/geo';
import type { Observation, ObsRoyale, ObsUnit } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import { decide, REGROUP_M, REGROUP_NEAR_M, regroup } from '../src/sim/royale/bot/brain';
import { markCall } from '../src/sim/royale/bot/calls';
import { pickCast, royaleOdds } from '../src/sim/royale/bot/fight';
import { buildSense } from '../src/sim/royale/bot/sense';
import { CREW_LAND_MAX_M } from '../src/sim/royale/crews';
import { DROP_S, type DuskState } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { fakeLayout, R, sph } from './royale_fixture';
import { loadPlanet } from './royale_planet';

const layout = fakeLayout();
const here = sph(1, 0.2, 0.1);

function wholeDusk(): DuskState {
  const center = sph(1, 0, 0);
  return {
    phase: 0,
    now: { center, radius: 2 * R },
    next: { center, radius: 88 },
    phaseEndsAt: 100,
    shrinking: false,
    burn: 0,
  };
}

function champion(id: number, at: Vec3, friendly: boolean, extra: Partial<ObsUnit> = {}): ObsUnit {
  return {
    id,
    kind: 'champion',
    friendly,
    x: at.x,
    y: at.y,
    z: at.z,
    hpFrac: 1,
    radius: 0.65,
    level: 3,
    items: [],
    championId: 'dain',
    ...extra,
  };
}

function obs(units: ObsUnit[], royale: Partial<ObsRoyale> = {}): Observation {
  return {
    tick: 400,
    time: 20,
    winner: null,
    self: {
      id: 5,
      team: 1,
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
    },
    units,
    royale: {
      variant: 'respawn',
      stage: 'play',
      dropEndsAt: 10,
      endsAt: 610,
      dusk: wholeDusk(),
      caches: [],
      pads: [],
      drop: null,
      opening: null,
      flying: false,
      score: 0,
      alive: 48,
      leader: null,
      ...royale,
    },
  };
}

const sense = (o: Observation, skill = ROYALE_SKILLS.normal) =>
  buildSense(o, o.royale!, layout, skill);
const far = sph(1, 0.6, 0.1);
const near = sph(1, 0.25, 0.1);

describe('the crew bot', () => {
  it('walks back to its anchor once farther than the leash, to a few steps of it', () => {
    expect(dist(here, far)).toBeGreaterThan(REGROUP_M);
    const s = sense(obs([champion(2, far, true)], { anchor: 2 }));
    const a = regroup(s);
    expect(a?.kind).toBe('move');
    if (a?.kind !== 'move') return;
    expect(dist({ x: a.x, y: a.y ?? 0, z: a.z }, far)).toBeLessThan(REGROUP_NEAR_M + 0.5);
    // And the house brain takes it when nothing else calls.
    expect(
      decide(obs([champion(2, far, true)], { anchor: 2 }), new Rng(1), layout, ROYALE_SKILLS.normal)
        .kind,
    ).toBe('move');
  });

  it('keeps to its own play within the leash, as the anchor, in Solo and with the anchor down', () => {
    expect(dist(here, near)).toBeLessThan(REGROUP_M);
    expect(regroup(sense(obs([champion(2, near, true)], { anchor: 2 })))).toBeNull();
    expect(regroup(sense(obs([champion(2, far, true)], { anchor: 5 })))).toBeNull();
    expect(regroup(sense(obs([champion(2, far, true)])))).toBeNull();
    expect(regroup(sense(obs([champion(2, far, true, { hpFrac: 0 })], { anchor: 2 })))).toBeNull();
  });

  it('walks a way back to its anchor out, past the leash on the way in', () => {
    const mid = sph(1, 0.35, 0.1);
    expect(dist(here, mid)).toBeLessThan(REGROUP_M);
    expect(dist(here, mid)).toBeGreaterThan(REGROUP_NEAR_M + 1);
    const back = obs([champion(2, mid, true)], { anchor: 2 });
    back.self.dest = { x: mid.x, y: mid.y, z: mid.z };
    expect(regroup(sense(back))?.kind).toBe('move');
    // A walk of its own elsewhere, within the leash: its own play.
    const own = obs([champion(2, mid, true)], { anchor: 2 });
    own.self.dest = { x: far.x, y: far.y, z: far.z };
    expect(regroup(sense(own))).toBeNull();
  });

  it('stands with its crew against a far stronger enemy rather than flee', () => {
    const foe = champion(9, sph(1, 0.27, 0.1), false, { level: 12 });
    const beside = (id: number) => champion(id, sph(1, 0.215, 0.1), true, { level: 6 });
    const hurt = { hpFrac: 0.5, level: 6 };
    const alone = obs([foe]);
    Object.assign(alone.self, hurt);
    const crew = obs([foe, beside(2), beside(3)]);
    Object.assign(crew.self, hurt);
    const strong = ROYALE_SKILLS.strong;
    expect(royaleOdds(sense(alone, strong), foe, 0)).toBeLessThan(0.3);
    expect(royaleOdds(sense(crew, strong), foe, 0)).toBeGreaterThan(0.5);
  });

  it('weighs its crewmates in reach in a fight', () => {
    const foe = champion(9, near, false);
    const alone = royaleOdds(sense(obs([foe])), foe);
    const together = royaleOdds(sense(obs([foe, champion(2, sph(1, 0.21, 0.1), true)])), foe);
    expect(alone).toBeCloseTo(0.5, 5);
    expect(together).toBeGreaterThan(0.6);
  });

  it("hunts no crewmate's mark", () => {
    const mark = { kind: 'lodestar' as const, level: 1, at: near, shownAt: 19 };
    const strong = ROYALE_SKILLS.strong;
    const enemyMark = sense(obs([], { marks: [{ id: 9, ...mark }] }), strong);
    expect(markCall(enemyMark, 0)?.kind).toBe('mark');
    const mateMark = sense(obs([champion(2, far, true)], { marks: [{ id: 2, ...mark }] }), strong);
    expect(markCall(mateMark, 0)).toBeNull();
  });
});

describe('an Arrival in Crews', () => {
  it('comes down beside a crewmate clear of any fight', () => {
    const person: RoyalePerson = {
      clientId: 7,
      owner: 7,
      name: 'late',
      guest: true,
      pick: { championId: 'dain', sigils: ['riftstep', 'mend'], skin: 0 },
    };
    const match = new RoyaleMatch(1, 31, 'respawn', [], royaleFactory(loadPlanet), 15, 3);
    const sim = match.sim as unknown as Sim;
    while (sim.time < DROP_S + 2) match.tick();
    const p = match.takeBotSeat(person)!;
    const me = sim.units.get(p.unitId)!;
    const mates = [...sim.units.values()].filter(
      (u) => u.kind === 'champion' && u.team === me.team && u.id !== me.id && !u.dead,
    );
    expect(mates.length).toBeGreaterThan(0);
    const nearest = Math.min(...mates.map((u) => dist(u.pos as Vec3, me.pos as Vec3)));
    expect(nearest).toBeLessThanOrEqual(CREW_LAND_MAX_M + 0.1);
  });
});

// Ysmer's In My Stead in Crews: a crewmate under the rescue line with an
// enemy on it is traded out before anything else is cast; a whole crewmate
// leaves the ultimate to the enemy gates.
describe('a Ysmer bot in a crew', () => {
  const ysmerObs = (allyHp: number): Observation => {
    const o = obs([
      champion(7, near, true, { hpFrac: allyHp, championId: 'vesk' }),
      champion(9, sph(1, 0.27, 0.11), false),
    ]);
    o.self = {
      ...o.self,
      championId: 'ysmer',
      attackRange: 5.5,
      abilityReady: { Q: false, W: false, E: false, R: true },
      abilityRanks: { Q: 1, W: 1, E: 1, R: 1 },
    };
    return o;
  };

  it('trades places with a hurt crewmate an enemy is on', () => {
    const o = ysmerObs(0.2);
    const foe = o.units.find((u) => !u.friendly)!;
    const a = pickCast(sense(o), foe, new Rng(1));
    expect(a?.kind).toBe('cast');
    if (a?.kind !== 'cast') return;
    expect(a.key).toBe('R');
    expect(dist({ x: a.x, y: a.y ?? 0, z: a.z }, near)).toBeLessThan(0.01);
  });

  it('keeps In My Stead while the crewmate is whole and the enemy too', () => {
    const o = ysmerObs(0.9);
    const foe = o.units.find((u) => !u.friendly)!;
    expect(pickCast(sense(o), foe, new Rng(1))).toBeNull();
  });

  it('holds an armed Hung Lantern while well, and takes the way back when hurt', () => {
    const o = ysmerObs(0.9);
    o.self = {
      ...o.self,
      abilityReady: { Q: false, W: true, E: false, R: false },
      recastArmed: 'W',
    };
    const foe = o.units.find((u) => !u.friendly)!;
    expect(pickCast(sense(o), foe, new Rng(1))).toBeNull();
    o.self = { ...o.self, hp: 120, hpFrac: 0.2 };
    const a = pickCast(sense(o), foe, new Rng(1));
    expect(a?.kind === 'cast' && a.key).toBe('W');
  });
});
