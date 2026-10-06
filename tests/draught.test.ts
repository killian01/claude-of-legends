// The Sapdraught (CONTEXT.md, docs/plan-potion.md): a drink heals 150 over
// 10 s and leaves the bag; one at a time, alive, never in a royale; damage
// does not stop it and it leaves a recall alone. A policy drinks through the
// same sim command a person's message reaches, live and replayed alike.

import { describe, expect, it } from 'vitest';
import { parseAction } from '../src/net/policy_wire';
import { applySimCommand } from '../src/net/replay';
import { dispatchAction } from '../src/sim/action_dispatch';
import { buildObservation } from '../src/sim/observe';
import { Sim } from '../src/sim/sim';
import { landed } from './royale_contract_fixture';

// 20 ticks a second (DT).
function runFor(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 20); i++) sim.tick();
}

// Two like champions away from every fountain, both hurt; only the first
// carries a Sapdraught, so the gap between them is the drink alone.
function pair() {
  const sim = new Sim(7);
  const me = sim.addChampion(0, { x: 75, z: 75 });
  const twin = sim.addChampion(0, { x: 76, z: 75 });
  for (const u of [me, twin]) u.hp = 100;
  me.items = ['sapdraught', 'iron_blade'];
  return { sim, me, twin };
}

describe('the Sapdraught', () => {
  it('heals 150 over 10 seconds and leaves the bag', () => {
    const { sim, me, twin } = pair();
    expect(sim.drinkItem(me.id, 0)).toBe(true);
    expect(me.items).toEqual(['iron_blade']);
    expect(buildObservation(sim, me.id)?.self.drinking).toBeCloseTo(10, 6);
    runFor(sim, 5);
    expect(me.hp - twin.hp).toBeCloseTo(75, 6);
    runFor(sim, 6);
    expect(me.hp - twin.hp).toBeCloseTo(150, 6);
    expect(buildObservation(sim, me.id)?.self.drinking).toBe(0);
  });

  it('runs one at a time', () => {
    const { sim, me } = pair();
    me.items = ['sapdraught', 'sapdraught'];
    expect(sim.drinkItem(me.id, 0)).toBe(true);
    expect(sim.drinkItem(me.id, 0)).toBe(false);
    expect(me.items).toEqual(['sapdraught']);
    runFor(sim, 10.5);
    expect(sim.drinkItem(me.id, 0)).toBe(true);
    expect(me.items).toEqual([]);
  });

  it('is refused on a slot without one, dead, or in a royale', () => {
    const { sim, me } = pair();
    expect(sim.drinkItem(me.id, 1)).toBe(false);
    expect(sim.drinkItem(me.id, 4)).toBe(false);
    me.dead = true;
    expect(sim.drinkItem(me.id, 0)).toBe(false);
    expect(me.items).toEqual(['sapdraught', 'iron_blade']);

    const royale = landed().sim;
    const u = [...royale.units.values()].find((x) => x.kind === 'champion' && !x.dead)!;
    u.items = ['sapdraught'];
    expect(royale.drinkItem(u.id, 0)).toBe(false);
    expect(u.items).toEqual(['sapdraught']);
  });

  it('keeps healing through damage, and leaves a recall alone', () => {
    const { sim, me } = pair();
    const foe = sim.addChampion(1, { x: 76, z: 76 });
    sim.startRecall(me.id);
    expect(sim.drinkItem(me.id, 0)).toBe(true);
    expect(me.statuses.some((s) => s.kind === 'recall')).toBe(true);
    sim.orderAttack(foe.id, me.id);
    const before = me.hp;
    runFor(sim, 3);
    expect(me.hp).toBeLessThan(before + 45);
    expect(buildObservation(sim, me.id)?.self.drinking).toBeGreaterThan(6);
  });

  it('is sold at the fountain for 50, two carried at most', () => {
    const sim = new Sim(7);
    const me = sim.addChampion(0);
    me.gold = 500;
    expect(sim.buyItem(me.id, 'sapdraught')).toBe(true);
    expect(sim.buyItem(me.id, 'sapdraught')).toBe(true);
    expect(sim.buyItem(me.id, 'sapdraught')).toBe(false);
    expect(me.items).toEqual(['sapdraught', 'sapdraught']);
    expect(me.gold).toBe(400);
    me.pos = { x: 75, z: 75 };
    expect(sim.drinkItem(me.id, 1)).toBe(true);
    expect(sim.buyItem(me.id, 'sapdraught')).toBe(false);
  });
});

describe('the drink action', () => {
  it('parses off the wire, and nothing malformed does', () => {
    expect(parseAction({ kind: 'drink', slot: 2 })).toEqual({ kind: 'drink', slot: 2 });
    expect(parseAction({ kind: 'drink', slot: -1 })).toBeNull();
    expect(parseAction({ kind: 'drink', slot: 0.5 })).toBeNull();
    expect(parseAction({ kind: 'drink' })).toBeNull();
  });

  it('a policy drinks exactly as a person does, live and replayed', () => {
    const a = pair();
    const b = pair();
    expect(dispatchAction(a.sim, a.me.id, { kind: 'drink', slot: 0 })).toBe(true);
    applySimCommand(b.sim, 0, b.me.id, { t: 'drink', slot: 0 });
    for (let i = 0; i < 60; i++) {
      a.sim.tick();
      b.sim.tick();
    }
    expect(a.me.items).toEqual(['iron_blade']);
    expect(a.sim.checksum()).toBe(b.sim.checksum());
    expect(a.me.hp).toBe(b.me.hp);
  });
});
