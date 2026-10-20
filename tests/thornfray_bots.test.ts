// The house bots in a bout (ADR 0035; docs/design/thornfray.md, How a bot
// plays a bout; docs/plan-thornfray.md slice 4): the same brain reading the
// kind's numbers (content/bots/bout_skills.ts) in place of the fifty seat
// tunings, from the observation's bout block alone. On a faked observation
// (the tests/royale_burr_bot.test.ts pattern), each beside the same scene
// on the planet: a Starglean bot at 45 percent on its way to a called
// Seedfall fights the enemy within 6 m where the planet's errand walks
// past; a Lastwick bot strikes at its skill's odds from the landing, with
// no calm nerve and no pace; it still flees a far stronger enemy in a 14 m
// light, cornered only under 8 m; the glean errand walks to a Seedfall
// across the Thornyard, races for the seed it is first to, and takes a
// cache in sight an enemy farther off would reach first, before a roam; a
// landed seed's held opening a step away is begun by a bot nobody strikes;
// the drop's pick stands inside the Thornyard on seeds 1 to 100; the
// planet's Respawn errand never runs. Then whole bouts of eight house
// bots through buildBoutSim on seeds 1 to 3: Lastwick lands at least four
// takedowns, the first before its second closing, and mostly ends before
// the light goes out; Starglean opens every burst's three Seedfall caches.

import { describe, expect, it } from 'vitest';
import { buildBoutSim } from '../src/net/replay';
import {
  GLEAN_STEP_IN_M,
  LASTWICK_BOTS,
  STARGLEAN_BOTS,
} from '../src/sim/content/bots/bout_skills';
import {
  CALM_NERVE,
  PACE_NERVE_MAX,
  PACE_NERVE_PER_SEAT,
  ROYALE_SKILLS,
  type RoyaleSkill,
} from '../src/sim/content/bots/royale_skills';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { LASTWICK } from '../src/sim/content/bouts/lastwick';
import { BOUT_SEATS } from '../src/sim/content/bouts/match';
import { STARGLEAN } from '../src/sim/content/bouts/starglean';
import type { BoutBots, BoutKind } from '../src/sim/content/bouts/types';
import { dirTo, dist, settle, type Vec3 } from '../src/sim/geo';
import type {
  Action,
  ObsBout,
  ObsCache,
  Observation,
  ObsRoyale,
  ObsSeedfall,
  ObsUnit,
} from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import {
  BOUT_CALLS,
  boutCall,
  calledSeedfall,
  gleanCall,
  raceRank,
} from '../src/sim/royale/bot/bout_calls';
import {
  corneredLightOf,
  decide,
  errandPast,
  LAST_LIGHT_M,
  nerveOf,
} from '../src/sim/royale/bot/brain';
import { seedfallErrand } from '../src/sim/royale/bot/calls';
import { BOUT_DROP_EDGE_M, pickDropPoint } from '../src/sim/royale/bot/drop_pick';
import { buildSense } from '../src/sim/royale/bot/sense';
import { beatDusk, duskMarginOf } from '../src/sim/royale/bot/travel';
import { boutSeed, drawBouts } from '../src/sim/royale/bouts/ledger';
import { thornyardOf } from '../src/sim/royale/bouts/plan';
import { landingIn } from '../src/sim/royale/drop';
import { depthInside, insideCap } from '../src/sim/royale/dusk';
import { boutSeatSkills } from '../src/sim/royale/fill';
import { along, REGION_IDS } from '../src/sim/royale/layout';
import { royaleGround } from '../src/sim/royale/mode';
import { royaleLayoutOf } from '../src/sim/royale/planet_map';
import type { DuskState } from '../src/sim/royale/types';
import { fakeLayout, R, sph } from './royale_fixture';
import { loadPlanet } from './royale_planet';
import { type BoutArgs, boutReplay, buildBout, land } from './thornfray_fixture';

const layout = fakeLayout();
const { gentle, normal, strong } = ROYALE_SKILLS;
const SKILLS = [gentle, normal, strong];
const here = sph(1, 0.2, 0.1);
const east = dirTo(here, sph(0, 0, 1)) as Vec3;
const north = dirTo(here, sph(0, 1, 0)) as Vec3;
const south = dirTo(here, sph(0, -1, 0)) as Vec3;
// The slot's time: ten seconds after the landing (dropEndsAt 10).
const NOW = 20;

// A skill whose eye never misses a slot: the tests read the decision, not
// the attention's roll.
const sure = (s: RoyaleSkill): RoyaleSkill => ({ ...s, attention: 1 });

// A bout's calm around `center`: the Thornyard lit, its first closing next.
function yard(center: Vec3 = here, over: Partial<DuskState> = {}): DuskState {
  return {
    phase: 0,
    now: { center, radius: 40 },
    next: { center, radius: 26 },
    phaseEndsAt: 70,
    shrinking: false,
    burn: 0.04,
    ...over,
  };
}

function boutOf(kind: BoutKind): ObsBout {
  return { kind: kind.id, index: 0, of: 6, double: false, count: 0, place: 1, best: 0 };
}

// The royale block of `kind`'s bout, or (inBout false) the same scene on
// the planet in the kind's variant.
function royale(kind: BoutKind, inBout: boolean, over: Partial<ObsRoyale> = {}): ObsRoyale {
  return {
    variant: kind.base,
    stage: 'play',
    dropEndsAt: 10,
    endsAt: 10 + kind.playS,
    dusk: yard(),
    caches: [],
    pads: [],
    drop: null,
    opening: null,
    flying: false,
    score: 0,
    alive: 8,
    leader: null,
    ...(inBout ? { bout: boutOf(kind) } : {}),
    ...over,
  };
}

function obs(units: ObsUnit[], r: ObsRoyale, self = {}, at: Vec3 = here): Observation {
  return {
    tick: NOW * 20,
    time: NOW,
    winner: null,
    self: {
      id: 1,
      team: 0,
      x: at.x,
      y: at.y,
      z: at.z,
      hp: 1000,
      maxHp: 1000,
      hpFrac: 1,
      mana: 300,
      maxMana: 300,
      level: 7,
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
    royale: r,
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
    level: 7,
    items: [],
    championId: 'dain',
    vx: 0,
    vy: 0,
    vz: 0,
    ...extra,
  };
}

function seedfall(id: number, at: Vec3, extra: Partial<ObsSeedfall> = {}): ObsSeedfall {
  return { id, x: at.x, y: at.y, z: at.z, landsAt: NOW + 8, landed: false, ...extra };
}

function cache(id: number, at: Vec3, extra: Partial<ObsCache> = {}): ObsCache {
  return { id, x: at.x, y: at.y, z: at.z, golden: false, kind: 'plain', ...extra };
}

function point(a: Action): Vec3 {
  if (a.kind !== 'move' && a.kind !== 'drop') throw new Error(`no point in ${a.kind}`);
  return { x: a.x, y: a.y ?? 0, z: a.z };
}

// The slot's decision and why, with the bout's numbers given to the
// policy (null on the planet).
function play(o: Observation, skill: RoyaleSkill, bots: BoutBots | null, seed = 1) {
  let why = '';
  const a = decide(
    o,
    new Rng(seed),
    layout,
    skill,
    (w) => {
      why = w;
    },
    bots,
  );
  return { why, a };
}

function sense(o: Observation, skill: RoyaleSkill, bots: BoutBots | null) {
  return buildSense(o, o.royale!, layout, skill, bots);
}

const FIGHTS = ['fight', 'finish', 'struck-back', 'answer', 'ambush-strike'];

describe('a bout bot fights first', () => {
  it('fights an enemy within 6 m at 45 percent on its way to a called Seedfall', () => {
    const sf = seedfall(1, along(here, north, 25, R));
    const foe = enemy(9, along(here, east, 5, R), { hpFrac: 0.45 });
    const self = { hpFrac: 0.45, hp: 450 };
    for (const skill of SKILLS) {
      const r = (inBout: boolean) => royale(STARGLEAN, inBout, { seedfalls: [sf] });
      const bout = play(obs([foe], r(true), self), sure(skill), STARGLEAN_BOTS);
      expect(bout.why).toBe('fight');
      expect(bout.a).toEqual({ kind: 'attack', targetId: 9 });
      // On the planet, Respawn's Seedfall errand walks it past that fight.
      const planet = play(obs([foe], r(false), self), sure(skill), null);
      expect(planet.why).toBe('errand');
      expect(planet.a.kind).toBe('move');
    }
  });

  it('never runs the planet errand in a bout', () => {
    const sf = seedfall(1, along(here, north, 25, R));
    const foe = enemy(9, along(here, east, 5, R));
    const at = (inBout: boolean) => obs([foe], royale(STARGLEAN, inBout, { seedfalls: [sf] }));
    const errand = seedfallErrand(sense(at(false), normal, null));
    expect(errand?.kind).toBe('seedfall');
    expect(errandPast(sense(at(false), normal, null), errand)).not.toBeNull();
    expect(errandPast(sense(at(true), normal, STARGLEAN_BOTS), errand)).toBeNull();
  });

  it('strikes in Lastwick at its skill odds from the landing, with no calm and no pace', () => {
    // Two seconds after the landing, the Dusk calm, an even duel 8 m off.
    const foe = enemy(9, along(here, east, 8, R));
    const r = (inBout: boolean) => royale(LASTWICK, inBout);
    const early = { time: 12 };
    for (const skill of SKILLS) {
      const o = (inBout: boolean) => ({ ...obs([foe], r(inBout)), ...early });
      const bout = play(o(true), sure(skill), LASTWICK_BOTS);
      expect(bout.why).toBe('fight');
      expect(bout.a).toEqual({ kind: 'attack', targetId: 9 });
      expect(nerveOf(sense(o(true), skill, LASTWICK_BOTS), false)).toBe(skill.fightOdds);
      // On the planet, One life's calm and its fifty seat pace hold it.
      const planet = play(o(false), sure(skill), null);
      expect(FIGHTS).not.toContain(planet.why);
      expect(planet.a.kind).not.toBe('attack');
    }
  });

  it('flees a far stronger enemy in a 14 m light, cornered only under 8 m', () => {
    // Struck at 40 percent by a level 14 champion 6.5 m off: odds 0.23.
    const foe = enemy(9, along(here, east, 6.5, R), { level: 14 });
    const self = { hpFrac: 0.4, hp: 400, struckAt: NOW - 0.5 };
    const light = (radius: number): DuskState =>
      yard(here, {
        phase: 4,
        now: { center: here, radius },
        next: { center: here, radius: 5 },
        phaseEndsAt: NOW + 5,
        burn: 0.07,
      });
    const at = (radius: number, inBout: boolean) =>
      obs([foe], royale(LASTWICK, inBout, { dusk: light(radius) }), self);
    const fled = play(at(14, true), sure(normal), LASTWICK_BOTS);
    expect(['exit', 'back-off']).toContain(fled.why);
    expect(fled.a.kind).toBe('move');
    // The planet corners a bot under 20 m: it turns and answers.
    expect(play(at(14, false), sure(normal), null).why).toBe('struck-back');
    // Under 8 m a bout's bot is cornered too.
    expect(play(at(7, true), sure(normal), LASTWICK_BOTS).why).toBe('struck-back');
    expect(corneredLightOf(sense(at(14, true), normal, LASTWICK_BOTS))).toBe(8);
    expect(corneredLightOf(sense(at(14, false), normal, null))).toBe(LAST_LIGHT_M);
  });
});

describe('the glean errand', () => {
  it('is the Starglean entry of BOUT_CALLS, and every kind names one or none', () => {
    expect(STARGLEAN.bots.errand).toBe('glean');
    expect(BOUT_CALLS.glean).toBe(gleanCall);
    for (const kind of BOUT_KINDS) {
      if (kind.bots.errand !== null) expect(Object.hasOwn(BOUT_CALLS, kind.bots.errand)).toBe(true);
    }
    expect(LASTWICK.bots.errand).toBeNull();
    const o = (kind: BoutKind) => obs([], royale(kind, true, { caches: [cache(3, here)] }));
    expect(boutCall(sense(o(LASTWICK), normal, LASTWICK_BOTS))).toBeNull();
    expect(boutCall(sense(o(STARGLEAN), normal, STARGLEAN_BOTS))?.why).toBe('glean-cache');
    // On the planet no bout's errand is asked, whatever the policy holds.
    const planet = obs([], royale(STARGLEAN, false, { caches: [cache(3, here)] }));
    expect(boutCall(sense(planet, normal, STARGLEAN_BOTS))).toBeNull();
  });

  it('walks to a called Seedfall across the Thornyard, past every skill hearing', () => {
    const seedAt = along(here, east, 70, R);
    const center = settle(
      { x: (here.x + seedAt.x) / 2, y: (here.y + seedAt.y) / 2, z: (here.z + seedAt.z) / 2 },
      R,
    ) as Vec3;
    const sf = seedfall(1, seedAt, { landsAt: NOW + 10 });
    const far = dist(here, seedAt);
    for (const skill of SKILLS) expect(far).toBeGreaterThan(skill.seedfallM);
    expect(far).toBeLessThan(STARGLEAN_BOTS.reach);
    const r = royale(STARGLEAN, true, { seedfalls: [sf], dusk: yard(center) });
    for (const skill of SKILLS) {
      const { why, a } = play(obs([], r), sure(skill), STARGLEAN_BOTS);
      expect(why).toBe('glean-seedfall');
      expect(dist(point(a), seedAt)).toBeLessThan(far);
    }
    // Past the kind's reach, or under its floor, the errand does not call.
    const short = { ...STARGLEAN_BOTS, reach: 40 };
    expect(play(obs([], r), sure(normal), short).why).not.toBe('glean-seedfall');
    expect(play(obs([], r, { hpFrac: 0.35 }), sure(normal), STARGLEAN_BOTS).why).not.toBe(
      'glean-seedfall',
    );
  });

  it('races for the seed it would reach first as far as it sees', () => {
    // A seed 20 m north with an enemy 8 m from it; another 30 m south
    // nobody in sight is nearer to.
    const a = along(here, north, 20, R);
    const b = along(here, south, 30, R);
    const foe = enemy(9, along(a, north, 8, R));
    const o = obs([foe], royale(STARGLEAN, true, { seedfalls: [seedfall(1, a), seedfall(2, b)] }));
    const s = sense(o, normal, STARGLEAN_BOTS);
    expect(raceRank(s, a)).toBe(1);
    expect(raceRank(s, b)).toBe(0);
    expect(calledSeedfall(s, 80)?.id).toBe(2);
    // With nobody in sight, the nearest.
    const alone = obs([], royale(STARGLEAN, true, { seedfalls: [seedfall(1, a), seedfall(2, b)] }));
    expect(calledSeedfall(sense(alone, normal, STARGLEAN_BOTS), 80)?.id).toBe(1);
  });

  it('takes a cache in sight an enemy farther off would reach first, before a roam', () => {
    const c = cache(3, along(here, east, 25, R));
    const foe = enemy(9, along(here, east, 45, R));
    expect(dist(foe, c)).toBeLessThan(dist(here, c));
    const r = (inBout: boolean, units = [foe], cs = [c]) =>
      obs(units, royale(STARGLEAN, inBout, { caches: cs }));
    const bout = play(r(true), sure(normal), STARGLEAN_BOTS);
    expect(bout.why).toBe('glean-cache');
    expect(dist(point(bout.a), c)).toBeLessThan(0.01);
    // The planet's pick leaves it to the enemy and wanders.
    expect(play(r(false), sure(normal), null).why).toBe('roam');
    // Never one an enemy stands beside: the fight there was passed on.
    const beside = enemy(9, along(c, east, 6, R));
    expect(play(r(true, [beside]), sure(normal), STARGLEAN_BOTS).why).not.toBe('glean-cache');
    // Beside it, the bot holds still and opens it.
    const underfoot = cache(4, along(here, north, 0.5, R));
    const opening = play(r(true, [], [underfoot]), sure(normal), STARGLEAN_BOTS);
    expect(opening).toEqual({ why: 'glean-cache', a: { kind: 'stop' } });
  });
});

describe('the held opening begun', () => {
  // A landed seed and its cache `d` m north; an even enemy 5 m east.
  function scene(d: number, over: Partial<ObsRoyale> = {}, self = {}, inBout = true) {
    const at = along(here, north, d, R);
    const sf = seedfall(1, at, { landsAt: NOW - 1, landed: true });
    const c = cache(7, at, { kind: 'seedfall' });
    const foe = enemy(9, along(here, east, 5, R));
    const r = royale(STARGLEAN, inBout, { seedfalls: [sf], caches: [c], ...over });
    return { o: obs([foe], r, self), at };
  }

  it('begins a landed Seedfall opening underfoot with an enemy in sight', () => {
    const { o } = scene(1.2);
    expect(play(o, sure(normal), STARGLEAN_BOTS)).toEqual({
      why: 'begin-opening',
      a: { kind: 'stop' },
    });
    // The planet's brain fights for it.
    expect(play(scene(1.2, {}, {}, false).o, sure(normal), null).why).not.toBe('begin-opening');
  });

  it('steps in from a step away, and no farther', () => {
    const { o, at } = scene(4);
    const step = play(o, sure(normal), STARGLEAN_BOTS);
    expect(step.why).toBe('step-in');
    expect(dist(point(step.a), at)).toBeLessThan(0.01);
    expect(play(scene(GLEAN_STEP_IN_M + 2).o, sure(normal), STARGLEAN_BOTS).why).not.toBe(
      'step-in',
    );
  });

  it('answers a hit first, and leaves an opening another champion holds', () => {
    const struck = scene(1.2, {}, { struckAt: NOW - 0.5 }).o;
    expect(FIGHTS).toContain(play(struck, sure(normal), STARGLEAN_BOTS).why);
    const theirs = scene(1.2, { seedfalls: [] }).o;
    theirs.royale!.seedfalls = [
      { ...scene(1.2).o.royale!.seedfalls![0]!, opener: { id: 9, since: NOW - 1 } },
    ];
    expect(play(theirs, sure(normal), STARGLEAN_BOTS).why).not.toBe('begin-opening');
    // One life holds no opening: a hit breaks it, so nothing is begun.
    const once = scene(1.2, { variant: 'one_life' }).o;
    expect(play(once, sure(normal), STARGLEAN_BOTS).why).not.toBe('begin-opening');
  });
});

describe("a bout's numbers", () => {
  it('reads the calm nerve and the pace from the kind, never the fifty seat ones', () => {
    // Thirty seconds after the landing, four of eight standing.
    const r = (inBout: boolean) => royale(LASTWICK, inBout, { alive: 4 });
    const o = (inBout: boolean) => ({ ...obs([], r(inBout)), time: 40 });
    for (const skill of SKILLS) {
      expect(nerveOf(sense(o(true), skill, LASTWICK_BOTS), false)).toBe(skill.fightOdds);
      const paced: BoutBots = { ...LASTWICK_BOTS, calm: 0.1, pace: [8, 4, 1] };
      // The pace expects six standing at 30 s: two ahead of it.
      expect(nerveOf(sense(o(true), skill, paced), false)).toBeCloseTo(
        skill.fightOdds + 0.1 + 2 * PACE_NERVE_PER_SEAT,
        9,
      );
      expect(nerveOf(sense(o(false), skill, null), false)).toBeCloseTo(
        skill.fightOdds + CALM_NERVE + PACE_NERVE_MAX,
        9,
      );
    }
  });

  it('keeps half the skill Dusk margin', () => {
    // Four meters outside the next cap, eighteen seconds before it closes.
    const center = along(here, south, 30, R);
    const dusk = yard(center, { phaseEndsAt: NOW + 18 });
    const o = (inBout: boolean) => obs([], royale(LASTWICK, inBout, { dusk }));
    expect(depthInside(dusk.next!, here)).toBeLessThan(0);
    expect(duskMarginOf(sense(o(true), strong, LASTWICK_BOTS))).toBe(strong.duskMargin / 2);
    expect(duskMarginOf(sense(o(false), strong, null))).toBe(strong.duskMargin);
    expect(beatDusk(sense(o(false), strong, null))).not.toBeNull();
    expect(beatDusk(sense(o(true), strong, LASTWICK_BOTS))).toBeNull();
  });
});

describe("a bout bot's drop", () => {
  const planet = loadPlanet();
  const real = royaleLayoutOf(planet.layout);
  const ground = royaleGround(planet.ground());

  it('picks inside the Thornyard on seeds 1 to 100, in every region', () => {
    for (const region of REGION_IDS) {
      const yardOf = thornyardOf(real, region, 40);
      const cap = { center: yardOf.center, radius: yardOf.radius };
      const r = royale(STARGLEAN, true, { stage: 'drop', dusk: yard(cap.center) });
      for (let seed = 1; seed <= 100; seed++) {
        const a = decide(obs([], r), new Rng(seed), real, normal, undefined, STARGLEAN_BOTS);
        expect(a.kind).toBe('drop');
        const p = point(a);
        expect(insideCap(cap, p)).toBe(true);
        expect(depthInside(cap, p)).toBeGreaterThanOrEqual(BOUT_DROP_EDGE_M - 1e-6);
        expect(landingIn(p, cap, real, ground)).not.toBeNull();
      }
    }
  });

  it('picks on the planet as it always has', () => {
    const r = royale(STARGLEAN, false, { stage: 'drop' });
    for (let seed = 1; seed <= 20; seed++) {
      const a = decide(obs([], r), new Rng(seed), real, normal);
      expect(point(a)).toEqual(pickDropPoint(real, new Rng(seed)));
    }
  });
});

// Bout 1 of match `seed`, as the ledger draws it from a pool of the kind
// alone.
function firstBout(kind: BoutKind, seed: number): BoutArgs {
  const region = drawBouts(seed, [kind])[0]!.region;
  return { kind, matchSeed: seed, seed: boutSeed(seed, 0), index: 0, region };
}

describe('eight house bots in a bout', () => {
  it('land four takedowns in Lastwick from the landing, mostly before the light goes out', () => {
    let beforeDark = 0;
    for (const seed of [1, 2, 3]) {
      const { sim, unitIds } = buildBout(firstBout(LASTWICK, seed));
      land(sim);
      const seats = new Set(unitIds);
      const landAt = sim.royale!.dropEndsAt;
      let takedowns = 0;
      let firstFall = Number.POSITIVE_INFINITY;
      while (sim.royale!.stage !== 'over' && sim.time < landAt + 200) {
        for (const e of sim.tick()) {
          if (e.type !== 'death' || !seats.has(e.unitId)) continue;
          firstFall = Math.min(firstFall, sim.time - landAt);
          if (seats.has(e.killerId) && e.killerId !== e.unitId) takedowns++;
        }
      }
      expect(sim.royale!.stage).toBe('over');
      expect(takedowns).toBeGreaterThanOrEqual(4);
      // Fights from the landing: the first fall before the second closing.
      expect(firstFall).toBeLessThan(LASTWICK.dusk.closings[1]!.closeFrom);
      if (sim.time - landAt < LASTWICK.dusk.lightOutS) beforeDark++;
    }
    expect(beforeDark).toBeGreaterThanOrEqual(2);
  });

  for (const seed of [1, 2, 3]) {
    it(`opens every burst's three Seedfall caches in Starglean on seed ${seed}`, () => {
      const { sim } = buildBout(firstBout(STARGLEAN, seed));
      land(sim);
      const mode = sim.royaleMode!;
      const landAt = mode.state.dropEndsAt;
      // Each Seedfall cache's burst, by the seconds of its landing.
      const burstOf = new Map<number, number>();
      const opened = new Map<number, number>();
      while (sim.royale!.stage !== 'over' && sim.time < landAt + 200) {
        const events = sim.tick();
        for (const f of mode.state.seedfalls) {
          if (f.cacheId !== null) burstOf.set(f.cacheId, Math.round(f.landsAt - landAt));
        }
        for (const e of events) {
          if (e.type !== 'royale_cache') continue;
          const burst = burstOf.get(e.cacheId);
          if (burst !== undefined) opened.set(burst, (opened.get(burst) ?? 0) + 1);
        }
      }
      expect(sim.royale!.stage).toBe('over');
      const bursts = STARGLEAN.seedfalls!.at;
      expect(Object.fromEntries(opened)).toEqual(
        Object.fromEntries(bursts.map((at) => [at, STARGLEAN.seedfalls!.seeds])),
      );
    });
  }
});

describe("a bout's seats' skills", () => {
  const count = (skills: readonly string[]) => ({
    gentle: skills.filter((s) => s === 'gentle').length,
    normal: skills.filter((s) => s === 'normal').length,
    strong: skills.filter((s) => s === 'strong').length,
  });

  it('deal four gentle, three normal and one strong, and no strong one when only Guests play', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(count(boutSeatSkills(seed, BOUT_SEATS, false))).toEqual({
        gentle: 4,
        normal: 3,
        strong: 1,
      });
      expect(count(boutSeatSkills(seed, BOUT_SEATS, true))).toEqual({
        gentle: 4,
        normal: 4,
        strong: 0,
      });
    }
  });

  it("are the bout's own seats' skills, softer when only Guests play", () => {
    const skillsOf = (guestsOnly: boolean) => {
      const record = boutReplay({ kind: LASTWICK, matchSeed: 3 });
      const { sim, unitIds } = buildBoutSim(
        loadPlanet(),
        { ...record, royale: { ...record.royale!, guestsOnly } },
        BOUT_KINDS,
      );
      return unitIds.map((id) => sim.royaleMode!.skills.get(id)!);
    };
    expect(skillsOf(false)).toEqual(boutSeatSkills(3, BOUT_SEATS, false));
    expect(skillsOf(true)).toEqual(boutSeatSkills(3, BOUT_SEATS, true));
    expect(count(skillsOf(true)).strong).toBe(0);
  });
});
