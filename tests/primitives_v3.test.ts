// The engine primitives the scout kit is built from, on generic content:
// the fumble (attacks miss), a store of charges, a hidden pod that bursts
// under an enemy champion's step, the lurk (hidden while keeping still or
// keeping to a brush), an empower arming several strikes, and a dot a new
// one renews rather than stacks beside. Nisk's own kit end to end is
// tests/nisk.test.ts.

import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../src/sim/combat/casting';
import { chargesOf, rechargeSeconds } from '../src/sim/combat/charges';
import { applyEffects } from '../src/sim/combat/effects';
import { addStatus, consumeEmpower, isStealthed } from '../src/sim/combat/status';
import { CHAMPIONS, type ChampionDef } from '../src/sim/content/champions';
import { buildObservation } from '../src/sim/observe';
import { Sim } from '../src/sim/sim';
import { DT, type TeamId, type Vec2 } from '../src/sim/types';
import { createChampion, createMinion, type Unit } from '../src/sim/unit';

let nextId = 50_000;

// A roster body with a kit and passive of the test's own.
function custom(
  sim: Sim,
  team: TeamId,
  pos: Vec2,
  over: { R?: AbilityDef; lurk?: ChampionDef['passive']['lurk'] },
): Unit {
  const base = CHAMPIONS.vesk!;
  const def: ChampionDef = {
    ...base,
    id: 'vesk',
    passive: { ...base.passive, ...(over.lurk ? { lurk: over.lurk } : {}) },
    abilities: { ...base.abilities, ...(over.R ? { R: over.R } : {}) },
  };
  const u = createChampion(nextId++, team, pos, def);
  u.abilityRanks = { Q: 1, W: 1, E: 1, R: 1 };
  u.level = 6;
  sim.units.set(u.id, u);
  return u;
}

const POD: AbilityDef = {
  name: 'Test pod',
  manaCost: 0,
  cooldown: 1,
  castRange: 6,
  charges: { max: 2, every: 10 },
  spec: {
    kind: 'trap',
    radius: 1,
    duration: 20,
    armDelay: 0.5,
    seenWithin: 3,
    maxLive: 2,
    burst: { radius: 2, duration: 1, onEnter: [{ kind: 'damage', base: 50, dtype: 'true' }] },
  },
};

function ticks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

describe('the fumble', () => {
  it('spends a striker swing for nothing, and an armed empower waits for a strike that lands', () => {
    const sim = new Sim(5);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'dain');
    const b = sim.addChampion(1, { x: 77, z: 75 }, 'torv');
    sim.orderStop(b.id);
    addStatus(a, { kind: 'fumble', until: 2 });
    addStatus(a, {
      kind: 'empower',
      until: 60,
      bonus: [{ kind: 'damage', base: 10, dtype: 'true' }],
      splashRadius: 0,
      splash: [],
      scale: 1,
      hits: 1,
    });
    sim.orderAttack(a.id, b.id);
    let missed = 0;
    for (let i = 0; i < Math.floor(1.9 / DT); i++) {
      for (const ev of sim.tick()) if (ev.type === 'miss') missed++;
    }
    expect(missed).toBeGreaterThan(0);
    expect(b.hp).toBe(b.maxHp);
    expect(a.statuses.some((s) => s.kind === 'empower')).toBe(true);
    ticks(sim, Math.ceil(2 / DT));
    expect(b.hp).toBeLessThan(b.maxHp);
  });
});

describe('the charges', () => {
  it('open with one, refill one each recharge up to the store, and gate the cast', () => {
    const sim = new Sim(5);
    const a = custom(sim, 0, { x: 75, z: 75 }, { R: POD });
    expect(chargesOf(a, 'R')).toBe(0);
    ticks(sim, 1);
    expect(chargesOf(a, 'R')).toBe(1);
    expect(sim.castAbility(a.id, 'R', { x: 79, z: 75 })).toBe(true);
    expect(chargesOf(a, 'R')).toBe(0);
    ticks(sim, Math.ceil(1.2 / DT));
    // The beat between casts has passed but the store is empty.
    expect(sim.castAbility(a.id, 'R', { x: 79, z: 76 })).toBe(false);
    ticks(sim, Math.ceil(rechargeSeconds(POD.charges!, 1) / DT));
    expect(chargesOf(a, 'R')).toBe(1);
    ticks(sim, Math.ceil(rechargeSeconds(POD.charges!, 1) / DT));
    expect(chargesOf(a, 'R')).toBe(2);
    expect(buildObservation(sim, a.id)!.self.abilityCharges).toEqual({ R: 2 });
  });

  it('come back faster at a higher rank, as a cooldown does', () => {
    expect(rechargeSeconds(POD.charges!, 3)).toBeLessThan(rechargeSeconds(POD.charges!, 1));
  });
});

describe('the hidden pod', () => {
  it('is seen by its own team, and by an enemy only from close by', () => {
    const sim = new Sim(5);
    const a = custom(sim, 0, { x: 75, z: 75 }, { R: POD });
    const b = sim.addChampion(1, { x: 75, z: 83 }, 'torv');
    ticks(sim, 1);
    expect(sim.castAbility(a.id, 'R', { x: 79, z: 75 })).toBe(true);
    const pod = [...sim.zones.values()].find((z) => z.trap)!;
    expect(sim.zoneSeen(0, pod)).toBe(true);
    expect(sim.zoneSeen(1, pod)).toBe(false);
    b.pos = { x: 79, z: 77.5 };
    expect(sim.zoneSeen(1, pod)).toBe(true);
    // A minion standing on it neither sees it for its team nor bursts it.
    b.pos = { x: 75, z: 90 };
    const m = createMinion(nextId++, 1, 'melee', 'mid', { x: 79, z: 75 });
    sim.units.set(m.id, m);
    expect(sim.zoneSeen(1, pod)).toBe(false);
    ticks(sim, Math.ceil(1 / DT));
    expect(sim.zones.has(pod.id)).toBe(true);
  });

  it('bursts under an enemy champion step, leaving its field, and the oldest goes past the cap', () => {
    const sim = new Sim(5);
    const a = custom(sim, 0, { x: 75, z: 75 }, { R: POD });
    const b = sim.addChampion(1, { x: 75, z: 90 }, 'torv');
    sim.orderStop(b.id);
    ticks(sim, 1);
    a.charges.R = { count: 2, nextAt: 99 };
    expect(sim.castAbility(a.id, 'R', { x: 78, z: 75 })).toBe(true);
    ticks(sim, Math.ceil(1.1 / DT));
    expect(sim.castAbility(a.id, 'R', { x: 79, z: 77 })).toBe(true);
    a.charges.R = { count: 1, nextAt: 99 };
    ticks(sim, Math.ceil(1.1 / DT));
    expect(sim.castAbility(a.id, 'R', { x: 80, z: 79 })).toBe(true);
    const pods = [...sim.zones.values()].filter((z) => z.trap);
    expect(pods).toHaveLength(2);
    expect(pods.some((z) => Math.abs(z.pos.x - 78) < 1e-6)).toBe(false);
    ticks(sim, Math.ceil(0.6 / DT));
    b.pos = { x: 79, z: 77 };
    const hp = b.hp;
    ticks(sim, 3);
    expect([...sim.zones.values()].filter((z) => z.trap)).toHaveLength(1);
    expect(b.hp).toBeLessThan(hp);
  });
});

describe('the lurk', () => {
  it('hides a champion whose passive declares it, and nobody else', () => {
    const sim = new Sim(5);
    const a = custom(
      sim,
      0,
      { x: 75, z: 75 },
      { lurk: { after: 1, burst: { asPct: 0.5, duration: 2 } } },
    );
    const plain = sim.addChampion(0, { x: 72, z: 75 }, 'vesk');
    ticks(sim, Math.ceil(1.2 / DT));
    expect(isStealthed(a, sim.time)).toBe(true);
    expect(isStealthed(plain, sim.time)).toBe(false);
  });
});

describe('the multi-strike empower and the refreshing dot', () => {
  it('arms as many strikes as it says, then leaves', () => {
    const sim = new Sim(5);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'vesk');
    addStatus(a, {
      kind: 'empower',
      until: 60,
      bonus: [],
      splashRadius: 0,
      splash: [],
      scale: 1,
      hits: 3,
    });
    expect(consumeEmpower(a, sim.time)).not.toBeNull();
    expect(consumeEmpower(a, sim.time)).not.toBeNull();
    expect(consumeEmpower(a, sim.time)).not.toBeNull();
    expect(consumeEmpower(a, sim.time)).toBeNull();
  });

  it('renews one dot of a source instead of stacking a second', () => {
    const sim = new Sim(5);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'vesk');
    const b = sim.addChampion(1, { x: 77, z: 75 }, 'torv');
    const ctx = (sim as unknown as { ctx(): Parameters<typeof applyEffects>[0] }).ctx();
    const dot = {
      kind: 'dot' as const,
      duration: 2,
      perSecond: 10,
      adRatio: 0.1,
      dtype: 'magic' as const,
      refresh: true,
    };
    applyEffects(ctx, a.id, { ad: 100, ap: 0 }, b, [dot]);
    applyEffects(ctx, a.id, { ad: 100, ap: 0 }, b, [dot]);
    const dots = b.statuses.filter((s) => s.kind === 'dot');
    expect(dots).toHaveLength(1);
    if (dots[0]?.kind === 'dot') expect(dots[0].perSecond).toBeCloseTo(20, 9);
    // Without refresh two stack, as every dot always has.
    applyEffects(ctx, a.id, { ad: 100, ap: 0 }, b, [{ ...dot, refresh: false }]);
    expect(b.statuses.filter((s) => s.kind === 'dot')).toHaveLength(2);
  });
});
