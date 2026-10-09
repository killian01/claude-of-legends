// The house bots against the fumble and the hidden pods, through the same
// observation and budget as a person (ADR 0002, ADR 0003): a bot walks
// round a pod its team reveals instead of onto it, never knows of one its
// team has not revealed, and while its own attacks would miss it gives
// ground instead of swinging. Nisk's own bot is tests/nisk_bots.test.ts.

import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../src/sim/combat/casting';
import { addStatus } from '../src/sim/combat/status';
import { LANER } from '../src/sim/content/bots/laner';
import { CHAMPIONS, type ChampionDef } from '../src/sim/content/champions';
import { hypot } from '../src/sim/exact';
import { buildObservation } from '../src/sim/observe';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { TeamId, Vec2 } from '../src/sim/types';
import { createChampion, type Unit } from '../src/sim/unit';

const POD: AbilityDef = {
  name: 'Test pod',
  manaCost: 0,
  cooldown: 1,
  castRange: 6,
  spec: {
    kind: 'trap',
    radius: 0.9,
    duration: 60,
    armDelay: 1,
    maxLive: 3,
    burst: { radius: 2, duration: 1, onEnter: [{ kind: 'damage', base: 50, dtype: 'true' }] },
  },
};

// A reveal zone and nothing else: what shows a team an enemy pod.
const EYE: AbilityDef = {
  name: 'Test eye',
  manaCost: 0,
  cooldown: 1,
  castRange: 10,
  spec: { kind: 'zone', radius: 2.5, duration: 3, reveal: true },
};

function custom(sim: Sim, id: number, team: TeamId, pos: Vec2, R: AbilityDef): Unit {
  const base = CHAMPIONS.torv!;
  const def: ChampionDef = { ...base, abilities: { ...base.abilities, R } };
  const u = createChampion(id, team, pos, def);
  u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  u.level = 6;
  sim.units.set(u.id, u);
  return u;
}

function planter(sim: Sim, team: TeamId, pos: Vec2): Unit {
  return custom(sim, 60_000, team, pos, POD);
}

function ready(u: Unit): void {
  u.skillPoints = 0;
  u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  u.level = 6;
}

function act(sim: Sim, unitId: number): ReturnType<typeof LANER.policy> {
  sim.tick();
  const obs = buildObservation(sim, unitId);
  if (!obs) throw new Error('no observation');
  return LANER.policy(obs, new Rng(3));
}

describe('a bot and a pod', () => {
  it('walks round a pod its team reveals instead of onto it', () => {
    const sim = new Sim(31);
    const a = planter(sim, 0, { x: 75, z: 75 });
    const b = sim.addChampion(1, { x: 120, z: 120 }, 'vesk');
    ready(b);
    const eye = custom(sim, 60_001, 1, { x: 86, z: 81 }, EYE);
    expect(sim.castAbility(a.id, 'R', { x: 80, z: 75 })).toBe(true);
    a.pos = { x: 40, z: 40 };
    b.pos = { x: 82, z: 75 };
    b.path = [];
    expect(sim.castAbility(eye.id, 'R', { x: 80, z: 77 })).toBe(true);
    const action = act(sim, b.id);
    expect(action.kind).toBe('move');
    if (action.kind === 'move') {
      expect(hypot(action.x - 80, action.z - 75)).toBeGreaterThan(hypot(82 - 80, 0));
    }
  });

  it('knows nothing of a pod its team has not revealed, even beside it', () => {
    const sim = new Sim(31);
    const a = planter(sim, 0, { x: 75, z: 75 });
    const b = sim.addChampion(1, { x: 120, z: 120 }, 'vesk');
    ready(b);
    expect(sim.castAbility(a.id, 'R', { x: 80, z: 75 })).toBe(true);
    a.pos = { x: 40, z: 40 };
    b.pos = { x: 82, z: 75 };
    b.path = [];
    sim.tick();
    const seen = buildObservation(sim, b.id)!;
    expect((seen.zones ?? []).length).toBe(0);
    // The same moment with no pod on the ground reads the same: the bot
    // decides exactly as if none lay there, so it walks wherever it was
    // going, onto the pod too.
    const pod = [...sim.zones.values()].find((z) => z.trap)!;
    sim.zones.delete(pod.id);
    expect(buildObservation(sim, b.id)).toEqual(seen);
  });
});

describe('a bot that fumbles', () => {
  it('gives ground while its own attacks would miss, and strikes once they land again', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'vesk');
    ready(a);
    a.abilityRanks = { Q: 0, W: 0, E: 0, R: 0 };
    a.level = 1;
    const b = sim.addChampion(1, { x: 79, z: 75 }, 'torv');
    ready(b);
    b.hp = b.maxHp * 0.25;
    addStatus(a, { kind: 'fumble', until: 1.5 });
    const fumbling = act(sim, a.id);
    expect(fumbling.kind).not.toBe('attack');
    // The same moment without the fumble (idle defense left no swing in
    // the air to wait on).
    a.statuses = a.statuses.filter((s) => s.kind !== 'fumble');
    a.pendingAttack = null;
    a.attackReadyAt = 0;
    const clear = LANER.policy(buildObservation(sim, a.id)!, new Rng(3));
    expect(clear.kind).toBe('attack');
  });
});
