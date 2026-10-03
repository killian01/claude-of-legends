// The champions' kits on the Wanderseed's sphere (ADR 0029): every spell of
// the ten, cast at a dummy six meters away, resolves on the sphere and
// leaves what it makes (a bolt, a field, a leap) on it; the effect seam's
// pushes and pulls follow the great circles; a camp, a ring's creature and
// the Warden leash on the sphere. The world is the sphere tests' shared
// planet (tests/sphere_world.ts): a sphere of radius 80 open everywhere,
// reached through the ground seam (src/sim/ground.ts) as the planet's own
// grid will be, under a map record with nothing of the 5v5 on it.

import { describe, expect, it } from 'vitest';
import {
  CAMP_FIRST_SPAWN_S,
  CAMP_LEASH_RANGE,
  initialCampStates,
  stepCamps,
} from '../src/sim/camps';
import { castAbility, executeCast, stepWindups } from '../src/sim/combat/casting';
import { dealDamage } from '../src/sim/combat/damage';
import { applyEffects, type EffectCtx, evaluatePredicate } from '../src/sim/combat/effects';
import { CAMPS } from '../src/sim/content/camps';
import { CHAMPION_LIST, CHAMPIONS } from '../src/sim/content/champions/index';
import type { GameMap, RingSite } from '../src/sim/content/map';
import { SIGILS } from '../src/sim/content/sigils';
import {
  advance,
  carry,
  copy,
  cross,
  delta,
  dirTo,
  dist,
  dot,
  heading,
  offset,
  segmentDist,
  turnLeft,
  turnRight,
} from '../src/sim/geo';
import type { Ground } from '../src/sim/ground';
import { NavGrid } from '../src/sim/navgrid';
import { initialObjectiveState, stepObjectives, WARDEN_LEASH_RANGE } from '../src/sim/objectives';
import type { Projectile } from '../src/sim/projectiles';
import { initialRingStates, stepRings } from '../src/sim/rings';
import { Rng } from '../src/sim/rng';
import type { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { TeamBuffs } from '../src/sim/team_buffs';
import { type AbilityKey, DT, type TeamId, type Vec2 } from '../src/sim/types';
import { createChampion, type Unit } from '../src/sim/unit';
import { finite, HOME, offGround, offTangent, openSphere, PLANET, planetSim } from './sphere_world';

const KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];

// Every unit, bolt and field of a world, and every leap in flight, read for
// anything off the ground; the list is empty when all stands on it.
function strays(
  world: {
    units: Map<number, Unit>;
    projectiles: Map<number, Projectile>;
    zones: CombatCtx['zones'];
  },
  label: string,
  directions: boolean,
): string[] {
  const out: string[] = [];
  const note = (what: string, why: string | null) => {
    if (why) out.push(`${label} ${what}: ${why}`);
  };
  for (const u of world.units.values()) {
    note(`unit ${u.id} (${u.kind})`, offGround(u.pos));
    if (!Number.isFinite(u.hp)) out.push(`${label} unit ${u.id} hp ${u.hp}`);
    if (u.activeDash) {
      note(`dash of ${u.id} from`, offGround(u.activeDash.from));
      if (directions) note(`dash of ${u.id} heading`, offTangent(u.activeDash.dir, u.pos));
      else if (!finite(u.activeDash.dir)) out.push(`${label} dash of ${u.id}: heading not finite`);
    }
  }
  for (const p of world.projectiles.values()) {
    note(`bolt ${p.id} (${p.vfx})`, offGround(p.pos));
    if (directions) note(`bolt ${p.id} heading`, offTangent(p.dir, p.pos));
    else if (!finite(p.dir)) out.push(`${label} bolt ${p.id}: heading not finite`);
  }
  for (const z of world.zones.values()) note(`field ${z.id} (${z.vfx})`, offGround(z.pos));
  return out;
}

let nextId = 100_000;

// A combat context over a world at a time, on the open sphere unless a
// ground is given.
function ctxOf(
  world: Pick<Sim, 'rng' | 'nav' | 'units' | 'projectiles' | 'zones' | 'walls' | 'teamBuffs'>,
  time: number,
  ground: Ground = openSphere(),
): CombatCtx {
  return {
    time,
    rng: world.rng,
    nav: world.nav,
    ground,
    units: world.units,
    projectiles: world.projectiles,
    zones: world.zones,
    walls: world.walls,
    events: [],
    dead: new Set(),
    killers: new Map(),
    teamBuffs: world.teamBuffs,
    allocId: () => nextId++,
  };
}

// A world with no Sim around it, for the effect seam and the creatures.
function bareWorld() {
  return {
    rng: new Rng(3),
    nav: new NavGrid(PLANET.size, PLANET.walls, PLANET.borderMargin),
    units: new Map<number, Unit>(),
    projectiles: new Map<number, Projectile>(),
    zones: new Map() as CombatCtx['zones'],
    walls: new Map() as CombatCtx['walls'],
    teamBuffs: new TeamBuffs(),
  };
}

function champion(
  world: { units: Map<number, Unit> },
  team: TeamId,
  at: Vec2,
  id = 'korrath',
): Unit {
  const u = createChampion(nextId++, team, at, CHAMPIONS[id]!);
  world.units.set(u.id, u);
  return u;
}

// A caster at HOME at level 6 with every spell learned and full mana, an
// enemy dummy six meters away that cannot die, and an ally two meters
// beside the dummy for the jump that goes to one (Dain's Cinder Guard).
// Everyone holds, so nobody walks or swings on their own.
function arena(championId: string) {
  const sim = planetSim({}, 5);
  const caster = sim.addChampion(0, HOME, championId);
  const dummy = sim.addChampion(1, offset(HOME, heading(HOME, 0.6), 6), 'vesk');
  const back = dirTo(dummy.pos, HOME)!;
  const ally = sim.addChampion(0, offset(dummy.pos, turnLeft(back, dummy.pos), 2), 'maera');
  sim.setLevel(caster.id, 6);
  for (const key of KEYS) sim.levelAbility(caster.id, key);
  caster.mana = caster.maxMana;
  dummy.maxHp = 1e6;
  dummy.hp = dummy.maxHp;
  for (const u of [caster, dummy, ally]) sim.orderStop(u.id);
  return { sim, caster, dummy, ally };
}

describe('every spell of the ten on the sphere, as it resolves', () => {
  for (const def of CHAMPION_LIST) {
    it(`${def.name}: Q, W, E and R land their bolts, fields and leaps on the sphere`, () => {
      const out: string[] = [];
      for (const key of KEYS) {
        const { sim, caster, dummy } = arena(def.id);
        const cast = castAbility(ctxOf(sim, sim.time), caster, key, def.abilities[key], dummy.pos);
        expect(cast, `${def.id} ${key} is cast`).toBe(true);
        // The windup waited out: the spell resolves, nothing else steps.
        if (caster.pendingSpell) stepWindups(ctxOf(sim, caster.pendingSpell.resolveAt));
        expect(caster.pendingSpell).toBeNull();
        out.push(...strays(sim, `${def.id} ${key}`, true));
      }
      expect(out).toEqual([]);
    });
  }

  it('a blink lands on the sphere at its range toward the aim', () => {
    const { sim, caster, dummy } = arena('elowen');
    const before = copy(caster.pos);
    expect(sim.castAbility(caster.id, 'E', dummy.pos)).toBe(true);
    expect(offGround(caster.pos)).toBeNull();
    expect(dist(before, caster.pos)).toBeCloseTo(5, 9);
    // Toward the aim: the way to the dummy did not turn.
    expect(dot(dirTo(before, caster.pos)!, dirTo(before, dummy.pos)!)).toBeCloseTo(1, 9);
    // Riftstep is the same blink.
    const other = arena('vesk');
    const sigil = SIGILS.riftstep!;
    const from = copy(other.caster.pos);
    expect(
      executeCast(ctxOf(other.sim, 0), other.caster, sigil.spec, sigil.castRange, other.dummy.pos, {
        ad: 0,
        ap: 0,
      }),
    ).toBe(true);
    expect(offGround(other.caster.pos)).toBeNull();
    expect(dist(from, other.caster.pos)).toBeCloseTo(5.5, 9);
  });

  it("Fenn's recast blinks him back to the very spot he pressed it", () => {
    const { sim, caster, dummy } = arena('fenn');
    const origin = copy(caster.pos);
    const def = CHAMPIONS.fenn!.abilities.R;
    expect(castAbility(ctxOf(sim, 0), caster, 'R', def, dummy.pos)).toBe(true);
    stepWindups(ctxOf(sim, caster.pendingSpell!.resolveAt));
    // Mid-leap, he presses it again.
    caster.pos = offset(origin, dirTo(origin, dummy.pos)!, 3);
    expect(castAbility(ctxOf(sim, 1), caster, 'R', def, dummy.pos)).toBe(true);
    expect(caster.pos).toEqual(origin);
    expect(caster.activeDash).toBeNull();
  });

  it('a cone reads bearings on the sphere: what stands ahead is struck, what stands behind is not', () => {
    const { sim, caster, dummy } = arena('ashvyn');
    const behind = sim.addChampion(1, offset(HOME, heading(HOME, 0.6 + Math.PI), 3), 'vesk');
    const ahead = dummy.hp;
    const rear = behind.hp;
    const ctx = ctxOf(sim, 0);
    expect(castAbility(ctx, caster, 'Q', CHAMPIONS.ashvyn!.abilities.Q, dummy.pos)).toBe(true);
    stepWindups(ctxOf(sim, caster.pendingSpell!.resolveAt));
    expect(dummy.hp).toBeLessThan(ahead);
    expect(behind.hp).toBe(rear);
  });
});

describe('the effect seam on the sphere', () => {
  function pair(gap: number, bearing = 0.4) {
    const world = bareWorld();
    const source = champion(world, 0, HOME);
    const target = champion(world, 1, offset(HOME, heading(HOME, bearing), gap));
    return { world, source, target };
  }

  it('a knockback pushes straight away along the great circle', () => {
    const { world, source, target } = pair(3);
    const way = dirTo(source.pos, target.pos)!;
    applyEffects(ctxOf(world, 0), source.id, { ad: 0, ap: 0 }, target, [
      { kind: 'knockback', distance: 2 },
    ]);
    expect(offGround(target.pos)).toBeNull();
    // Chords on one great circle add up to within a hair of a meter's
    // thousandth at this reach.
    expect(dist(source.pos, target.pos)).toBeCloseTo(5, 2);
    expect(dot(dirTo(source.pos, target.pos)!, way)).toBeCloseTo(1, 9);
  });

  it('a pull drags the target to a stride from its source', () => {
    const { world, source, target } = pair(8);
    applyEffects(ctxOf(world, 0), source.id, { ad: 0, ap: 0 }, target, [
      { kind: 'pull', distance: 6 },
    ]);
    expect(offGround(target.pos)).toBeNull();
    expect(dist(source.pos, target.pos)).toBeCloseTo(2, 2);
  });

  it('a knockback toward a center pulls into the shape', () => {
    const { world, source, target } = pair(3);
    const center = offset(HOME, heading(HOME, 1.2), 1);
    const before = dist(target.pos, center);
    applyEffects(
      ctxOf(world, 0),
      source.id,
      { ad: 0, ap: 0 },
      target,
      [{ kind: 'knockback', distance: 2, direction: 'toCenter' }],
      'ability',
      { center },
    );
    expect(offGround(target.pos)).toBeNull();
    expect(dist(target.pos, center)).toBeCloseTo(before - 2, 2);
  });

  it('a knock-aside pushes off the line on the side the target stands on, whichever way the heading was carried', () => {
    const lineDir = heading(HOME, 0.2);
    // The bolt's heading four meters on, as a flying bolt carries it.
    const mid = copy(HOME);
    const carried = copy(lineDir);
    advance(mid, carried, 4);
    const far = offset(HOME, lineDir, 12);
    for (const side of [1, -1]) {
      const landed: Vec2[] = [];
      for (const dir of [lineDir, carried]) {
        const world = bareWorld();
        const source = champion(world, 0, HOME);
        const across = side > 0 ? turnLeft(carried, mid) : turnRight(carried, mid);
        const target = champion(world, 1, offset(mid, across, 0.8));
        const fx: EffectCtx = { lineFrom: HOME, lineDir: dir };
        applyEffects(
          ctxOf(world, 0),
          source.id,
          { ad: 0, ap: 0 },
          target,
          [{ kind: 'knockback', distance: 2.5, direction: 'aside' }],
          'ability',
          fx,
        );
        expect(offGround(target.pos)).toBeNull();
        expect(segmentDist(target.pos, HOME, far).d).toBeCloseTo(3.3, 2);
        expect(Math.sign(cross(lineDir, delta(HOME, target.pos), HOME))).toBe(side);
        landed.push(target.pos);
      }
      expect(dist(landed[0]!, landed[1]!)).toBeLessThan(1e-9);
    }
    // The heading read back at the line's start is the one it started with.
    expect(dot(carry(carried, HOME, HOME), lineDir)).toBeCloseTo(1, 12);
  });

  // A round of broken ground on the sphere, through the ground seam: a cap
  // of 1.5 m around BLOCK, its nearest walkable point just past the rim.
  const BLOCK = offset(HOME, heading(HOME, 0.4), 5);
  const capped = openSphere({
    isWalkableAt: (p) => dist(p, BLOCK) > 1.5,
    nearestWalkable: (p) => offset(BLOCK, dirTo(BLOCK, p) ?? heading(BLOCK, 0), 1.6),
    lineOfWalk: (a, b) => segmentDist(BLOCK, a, b).d > 1.5,
  });

  it('a push into broken ground lands where the ground says is nearest', () => {
    const { world, source, target } = pair(3);
    applyEffects(ctxOf(world, 0, capped), source.id, { ad: 0, ap: 0 }, target, [
      { kind: 'knockback', distance: 2 },
    ]);
    expect(offGround(target.pos)).toBeNull();
    expect(dist(target.pos, BLOCK)).toBeCloseTo(1.6, 9);
  });

  it('knows terrain beside a target from the ground, eight ways round', () => {
    const near = pair(3).target;
    const world = bareWorld();
    const ctx = ctxOf(world, 0, capped);
    const check = { kind: 'targetNearTerrain', distance: 1.1 } as const;
    // 2 m from the cap's center: the rim is half a meter off.
    near.pos = offset(BLOCK, heading(BLOCK, 2), 2);
    expect(evaluatePredicate(ctx, 0, near, check, {})).toBe(true);
    near.pos = offset(BLOCK, heading(BLOCK, 2), 4);
    expect(evaluatePredicate(ctx, 0, near, check, {})).toBe(false);
    // The open sphere has no terrain anywhere.
    near.pos = offset(BLOCK, heading(BLOCK, 2), 2);
    expect(evaluatePredicate(ctxOf(world, 0), 0, near, check, {})).toBe(false);
  });

  it('refuses a flight whose line the ground blocks, before anything is paid', () => {
    const { sim, caster } = arena('torv');
    const beyond = offset(HOME, heading(HOME, 0.4), 6);
    caster.mana = caster.maxMana;
    const ctx = ctxOf(sim, 0, { ...capped, isWalkableAt: () => true });
    expect(castAbility(ctx, caster, 'Q', CHAMPIONS.torv!.abilities.Q, beyond)).toBe(false);
    expect(caster.mana).toBe(caster.maxMana);
  });
});

describe('the camps, the rings and the Warden on the sphere', () => {
  it("a camp's bodies rise on the sphere, fanned behind their spot", () => {
    const world = bareWorld();
    const spot = { ...offset(HOME, heading(HOME, 1), 4), kind: 'brackenlings' as const };
    const states = initialCampStates({ ...PLANET, camps: [spot] });
    stepCamps(ctxOf(world, CAMP_FIRST_SPAWN_S), states);
    const bodies = [...world.units.values()];
    expect(bodies).toHaveLength(CAMPS.brackenlings.count);
    for (const b of bodies) expect(offGround(b.pos)).toBeNull();
    expect(bodies[0]!.pos).toEqual(copy(spot));
    const stride = CAMPS.brackenlings.body.radius * 2.4;
    for (const b of bodies.slice(1)) {
      expect(dist(b.pos, spot)).toBeCloseTo(Math.sqrt(stride * stride * (1 + 0.49)), 6);
    }
  });

  it("a camp's leash pulls a creature back when its attacker drags it beyond", () => {
    const world = bareWorld();
    const spot = { ...offset(HOME, heading(HOME, 1), 4), kind: 'spinecrest' as const };
    const states = initialCampStates({ ...PLANET, camps: [spot] });
    let time = CAMP_FIRST_SPAWN_S;
    stepCamps(ctxOf(world, time), states);
    const camp = [...world.units.values()][0]!;
    const toward = heading(spot, 2.2);
    const attacker = champion(world, 0, offset(spot, toward, 12));
    const drag = () => {
      const ctx = ctxOf(world, time);
      dealDamage(ctx, attacker.id, camp, 50, 'physical', 'ability');
      applyEffects(ctx, attacker.id, { ad: 0, ap: 0 }, camp, [{ kind: 'pull', distance: 6 }]);
      time += DT;
      stepCamps(ctxOf(world, time), states);
    };
    drag();
    // Six meters out: inside its leash, angry, and on its attacker.
    expect(offGround(camp.pos)).toBeNull();
    expect(dist(camp.pos, spot)).toBeCloseTo(6, 2);
    expect(camp.hp).toBeLessThan(camp.maxHp);
    expect(camp.attackTargetId).toBe(attacker.id);
    drag();
    // Dragged past its leash: home, whole, and calm.
    expect(dist(camp.pos, spot)).toBe(0);
    expect(camp.pos).toEqual(copy(spot));
    expect(camp.hp).toBe(camp.maxHp);
    expect(camp.attackTargetId).toBeNull();
    expect(CAMP_LEASH_RANGE).toBeLessThan(12);
  });

  it("a ring's creature rises on its circle and resets when dragged off it", () => {
    const world = bareWorld();
    const center = offset(HOME, heading(HOME, -1), 6);
    const site: RingSite = { id: 'bot', lane: 'bot', ...center, r: 5, leash: 7 };
    const states = initialRingStates({ ...PLANET, rings: [site] });
    states[0]!.nextRiseAt = 0;
    stepRings(ctxOf(world, 0), states);
    const creature = world.units.get(states[0]!.unitId!)!;
    expect(creature.pos).toEqual(copy(center));
    const attacker = champion(world, 0, offset(center, heading(center, 0.5), 10));
    const ctx = ctxOf(world, 1);
    dealDamage(ctx, attacker.id, creature, 50, 'physical', 'ability');
    applyEffects(ctx, attacker.id, { ad: 0, ap: 0 }, creature, [{ kind: 'pull', distance: 8 }]);
    expect(dist(creature.pos, center)).toBeGreaterThan(site.leash);
    stepRings(ctxOf(world, 1), states);
    expect(creature.pos).toEqual(copy(center));
    expect(creature.hp).toBe(creature.maxHp);
  });

  it('the Warden resets to its pit on the sphere beyond its leash', () => {
    const world = bareWorld();
    const pit = { ...offset(HOME, heading(HOME, 2.5), 8), name: 'the test pit' };
    const map: GameMap = { ...PLANET, wardenPits: [pit] };
    const state = initialObjectiveState();
    state.nextSpawnAt = 0;
    stepObjectives(ctxOf(world, 0), map, state);
    const warden = world.units.get(state.wardenId!)!;
    expect(warden.pos).toEqual(copy(pit));
    const toward = heading(pit, 0.1);
    warden.pos = offset(pit, toward, WARDEN_LEASH_RANGE + 1);
    warden.lastDamagedAt = 1;
    warden.hp = warden.maxHp / 2;
    stepObjectives(ctxOf(world, 1), map, state);
    expect(warden.pos).toEqual(copy(pit));
    expect(warden.hp).toBe(warden.maxHp);
  });
});

// Three seconds of the whole tick after each cast: walks, leaps in flight,
// bolts, fields and the creatures' steps all carry along the sphere.
describe('every spell of the ten on the sphere, three seconds on', () => {
  for (const def of CHAMPION_LIST) {
    it(`${def.name}: everything stays on the sphere and the dummy is hurt`, () => {
      const out: string[] = [];
      const hurt: AbilityKey[] = [];
      for (const key of KEYS) {
        const { sim, caster, dummy } = arena(def.id);
        expect(sim.castAbility(caster.id, key, copy(dummy.pos)), `${def.id} ${key}`).toBe(true);
        const windup = def.abilities[key].windup ?? 0;
        const ticks = Math.ceil((windup + 3) / DT);
        for (let i = 0; i < ticks; i++) {
          sim.tick();
          out.push(...strays(sim, `${def.id} ${key} at ${sim.time.toFixed(2)}`, false));
        }
        if (dummy.hp < dummy.maxHp) hurt.push(key);
      }
      expect(out).toEqual([]);
      expect(hurt.length, `${def.id} hurts the dummy`).toBeGreaterThan(0);
    });
  }
});
