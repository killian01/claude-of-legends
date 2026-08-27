// The observable-threat contract (additive v0): projectiles and zones the
// team can see, plus windup telegraphs on visible champion rows, so a
// Policy CAN dodge; and the Laner's dodge reflex over those fields. Without
// this block nothing a bot fights ever counts as avoidable.

import { describe, expect, it } from 'vitest';
import { BOTS, DEFAULT_BOT_ID } from '../src/sim/content/bots';
import { buildObservation } from '../src/sim/observe';
import type { Observation, ObsSelf } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

const laner = BOTS[DEFAULT_BOT_ID]!.policy;

describe('observation threats', () => {
  it('exposes a flying skillshot to both sides, fog permitting', () => {
    const sim = new Sim(11);
    const watcher = sim.addChampion(0, { x: 70, z: 75 });
    const caster = sim.addChampion(1, { x: 75, z: 75 }, 'sylra');
    caster.abilityRanks = { Q: 1, W: 0, E: 0, R: 0 };
    sim.tick();
    expect(sim.castAbility(caster.id, 'Q', { x: 65, z: 75 })).toBe(true);
    sim.tick();
    const watcherObs = buildObservation(sim, watcher.id)!;
    const hostile = (watcherObs.projectiles ?? []).filter((p) => !p.friendly && !p.homing);
    expect(hostile.length).toBeGreaterThanOrEqual(1);
    expect(hostile[0]!.dirX).toBeLessThan(0);
    const casterObs = buildObservation(sim, caster.id)!;
    expect((casterObs.projectiles ?? []).some((p) => p.friendly)).toBe(true);
  });

  it('hides projectiles no friendly unit can see', () => {
    const sim = new Sim(11);
    const blind = sim.addChampion(0, { x: 20, z: 20 });
    const caster = sim.addChampion(1, { x: 75, z: 75 }, 'sylra');
    caster.abilityRanks = { Q: 1, W: 0, E: 0, R: 0 };
    sim.tick();
    expect(sim.castAbility(caster.id, 'Q', { x: 65, z: 75 })).toBe(true);
    sim.tick();
    const obs = buildObservation(sim, blind.id)!;
    expect((obs.projectiles ?? []).filter((p) => !p.friendly)).toHaveLength(0);
  });

  it('exposes a delayed zone with its detonation clock', () => {
    const sim = new Sim(11);
    const victim = sim.addChampion(0, { x: 72, z: 75 });
    const caster = sim.addChampion(1, { x: 75, z: 75 }, 'dain');
    caster.level = 6;
    caster.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
    sim.tick();
    expect(sim.castAbility(caster.id, 'R', { x: 72, z: 75 })).toBe(true);
    sim.tick();
    const obs = buildObservation(sim, victim.id)!;
    const hostileZones = (obs.zones ?? []).filter((z) => !z.friendly);
    expect(hostileZones).toHaveLength(1);
    expect(hostileZones[0]!.detonateAt).not.toBeNull();
    expect(hostileZones[0]!.detonateAt!).toBeGreaterThan(sim.time);
  });

  it('exposes a visible windup on the caster row, landing on the caster for cones', () => {
    const sim = new Sim(11);
    const victim = sim.addChampion(0, { x: 77, z: 75 });
    const caster = sim.addChampion(1, { x: 75, z: 75 }, 'korrath');
    caster.abilityRanks = { Q: 1, W: 0, E: 0, R: 0 };
    sim.tick();
    expect(sim.castAbility(caster.id, 'Q', { x: 77, z: 75 })).toBe(true);
    sim.tick();
    const obs = buildObservation(sim, victim.id)!;
    const row = obs.units.find((u) => u.id === caster.id)!;
    expect(row.windup).toBeDefined();
    expect(row.windup!.key).toBe('Q');
    expect(row.windup!.x).toBeCloseTo(caster.pos.x, 5);
    expect(row.windup!.resolveAt).toBeGreaterThan(sim.time);
  });
});

// Synthetic observations keep the policy tests exact: one threat, one
// expected reflex, no whole-sim timing in the way.
function syntheticObs(partial: Partial<Observation>): Observation {
  const self: ObsSelf = {
    id: 1,
    team: 0,
    x: 75,
    z: 75,
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
    sigilReady: [true, true],
    items: [],
    championId: 'korrath',
    lane: 'mid',
  };
  return {
    tick: 100,
    time: 5,
    winner: null,
    self,
    units: [],
    objectiveSpawnAt: null,
    projectiles: [],
    zones: [],
    ...partial,
  };
}

describe('the Laner dodges', () => {
  it('sidesteps a skillshot on a collision course, perpendicular to it', () => {
    const obs = syntheticObs({
      projectiles: [
        {
          x: 68,
          z: 75,
          dirX: 1,
          dirZ: 0,
          speed: 24,
          radius: 0.7,
          friendly: false,
          homing: false,
        },
      ],
    });
    const action = laner(obs, new Rng(3));
    expect(action.kind).toBe('move');
    if (action.kind === 'move') {
      // The bolt flies along +x: the step must be in z, off the line.
      expect(Math.abs(action.z - obs.self.z)).toBeGreaterThan(1.5);
    }
  });

  it('ignores homing bolts and friendly fire', () => {
    const obs = syntheticObs({
      projectiles: [
        { x: 68, z: 75, dirX: 1, dirZ: 0, speed: 30, radius: 0.4, friendly: false, homing: true },
        { x: 70, z: 75, dirX: 1, dirZ: 0, speed: 24, radius: 0.7, friendly: true, homing: false },
      ],
    });
    const action = laner(obs, new Rng(3));
    // Nothing to dodge: the bot goes about its lane business instead.
    if (action.kind === 'move') {
      expect(Math.abs(action.z - obs.self.z)).toBeGreaterThan(4);
    }
  });

  it('walks out of a hostile zone about to detonate', () => {
    const obs = syntheticObs({
      zones: [{ x: 75.5, z: 75, radius: 3, friendly: false, detonateAt: 5.6 }],
    });
    const action = laner(obs, new Rng(3));
    expect(action.kind).toBe('move');
    if (action.kind === 'move') {
      const d = Math.hypot(action.x - 75.5, action.z - 75);
      expect(d).toBeGreaterThan(3.5);
    }
  });

  it('steps off an enemy windup landing on it', () => {
    const obs = syntheticObs({
      units: [
        {
          id: 9,
          kind: 'champion',
          friendly: false,
          x: 76.5,
          z: 75,
          hpFrac: 1,
          radius: 0.68,
          windup: { key: 'Q', x: 76.5, z: 75, resolveAt: 5.3 },
        },
      ],
    });
    const action = laner(obs, new Rng(3));
    expect(action.kind).toBe('move');
    if (action.kind === 'move') {
      const before = Math.hypot(obs.self.x - 76.5, obs.self.z - 75);
      const after = Math.hypot(action.x - 76.5, action.z - 75);
      expect(after).toBeGreaterThan(before);
    }
  });
});
