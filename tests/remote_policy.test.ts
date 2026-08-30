// Remote policy gate (ADR 0002 phase 2): a Policy running outside the sim
// drives a seat through the same contract, the same decision slot, and the
// same decision budget as one running inside it.

import { describe, expect, it } from 'vitest';
import { parseAction } from '../src/net/policy_wire';
import { dispatchAction } from '../src/sim/action_dispatch';
import { isDecisionSlot, POLICY_PERIOD_TICKS } from '../src/sim/bot_driver';
import { DECISION_CAP } from '../src/sim/decision_budget';
import { buildObservation } from '../src/sim/observe';
import type { Action, Policy } from '../src/sim/policy';
import { Sim } from '../src/sim/sim';

// A deterministic world digest: every unit's id, position, health and gold.
// Two sims agree only if nothing at all diverged.
function digest(sim: Sim): string {
  return [...sim.units.values()]
    .sort((a, b) => a.id - b.id)
    .map(
      (u) =>
        `${u.id}:${u.pos.x.toFixed(6)}:${u.pos.z.toFixed(6)}:${u.hp.toFixed(6)}:${u.gold.toFixed(6)}`,
    )
    .join('|');
}

const TARGET = { x: 100, z: 100 };
// Draws no randomness, so the in-sim path and the remote path consume the
// rng stream identically and any divergence is the dispatch, not the seed.
const CONSTANT: Action = { kind: 'move', x: TARGET.x, z: TARGET.z };
const constantPolicy: Policy = () => CONSTANT;

describe('remote policy parity', () => {
  it('drives a seat exactly like the same policy attached in-sim', () => {
    const build = (): { sim: Sim; unitId: number } => {
      const sim = new Sim(4242);
      const me = sim.addChampion(0, { x: 75, z: 75 });
      sim.addChampion(1, { x: 95, z: 95 });
      return { sim, unitId: me.id };
    };

    const inSim = build();
    inSim.sim.attachPolicy(inSim.unitId, constantPolicy);

    const remote = build();
    expect(remote.sim.addRemoteSeat(remote.unitId)).toBe(true);

    for (let i = 0; i < 200; i++) {
      inSim.sim.tick();
      // The remote holder re-queues every tick; only the slot consumes it.
      remote.sim.queueRemoteAction(remote.unitId, CONSTANT);
      remote.sim.tick();
    }

    expect(remote.sim.tickCount).toBe(inSim.sim.tickCount);
    expect(digest(remote.sim)).toBe(digest(inSim.sim));
  });

  it('gives a remote seat the same lane a scripted one would get', () => {
    const sim = new Sim(7);
    const a = sim.addChampion(0);
    const b = sim.addChampion(0);
    sim.attachPolicy(a.id, constantPolicy);
    sim.addRemoteSeat(b.id);
    expect(a.lane).not.toBeNull();
    expect(b.lane).not.toBeNull();
    // Round robin counts both kinds, so two seats never stack on one lane.
    expect(a.lane).not.toBe(b.lane);
  });
});

describe('the decision slot', () => {
  it('hands out exactly one observation and one dispatch per period', () => {
    const sim = new Sim(11);
    const me = sim.addChampion(0, { x: 75, z: 75 });
    sim.addRemoteSeat(me.id);
    const seat = sim.remoteSeats.get(me.id)!;

    let observations = 0;
    for (let i = 0; i < POLICY_PERIOD_TICKS * 8; i++) {
      // Flooding the queue between slots buys nothing: the latest wins.
      for (let j = 0; j < 20; j++) sim.queueRemoteAction(me.id, CONSTANT);
      sim.tick();
      if (sim.takeRemoteObservation(me.id)) observations++;
    }
    expect(observations).toBe(8);
    expect(seat.dispatched).toBe(8);
  });

  it('puts the remote seat on the same schedule as an attached policy', () => {
    const sim = new Sim(11);
    const me = sim.addChampion(0);
    sim.addRemoteSeat(me.id);
    let slots = 0;
    for (let tick = 0; tick < POLICY_PERIOD_TICKS * 4; tick++) {
      if (isDecisionSlot(tick, me.id)) slots++;
    }
    expect(slots).toBe(4);
  });

  it('drops the queue of a dead seat instead of replaying it on respawn', () => {
    const sim = new Sim(11);
    const me = sim.addChampion(0, { x: 75, z: 75 });
    const killer = sim.addChampion(1, { x: 77, z: 75 });
    sim.addRemoteSeat(me.id);
    me.hp = 1;
    sim.orderAttack(killer.id, me.id);
    for (let i = 0; i < 100 && !me.dead; i++) sim.tick();
    expect(me.dead).toBe(true);
    const seat = sim.remoteSeats.get(me.id)!;
    const before = seat.dispatched;
    sim.queueRemoteAction(me.id, CONSTANT);
    for (let i = 0; i < POLICY_PERIOD_TICKS; i++) sim.tick();
    expect(seat.pending).toBeNull();
    expect(seat.observation).toBeNull();
    expect(seat.dispatched).toBe(before);
  });
});

describe('remote actions obey the same rules as everyone', () => {
  it('spends the decision budget on casts exactly like any participant', () => {
    const sim = new Sim(31);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    const b = sim.addChampion(1, { x: 79, z: 75 });
    expect(DECISION_CAP).toBe(2);
    const cast = (key: 'Q' | 'W' | 'E'): boolean =>
      dispatchAction(sim, a.id, { kind: 'cast', key, x: b.pos.x, z: b.pos.z });
    expect(cast('Q')).toBe(true);
    expect(cast('W')).toBe(true);
    expect(a.decisionTokens).toBeLessThan(1);
    // The third is refused by the bucket, not by the ability: the remote
    // path buys no extra throughput over a human pressing the key.
    expect(sim.castAbility(a.id, 'E', { x: a.pos.x, z: a.pos.z })).toBe(false);
  });

  it('refuses to attack a unit the team cannot see', () => {
    const sim = new Sim(31);
    const me = sim.addChampion(0, { x: 75, z: 75 });
    const hidden = sim.addChampion(1, { x: 145, z: 145 });
    sim.tick();
    expect(sim.isVisible(me.team, hidden.id)).toBe(false);
    expect(dispatchAction(sim, me.id, { kind: 'attack', targetId: hidden.id })).toBe(false);
    expect(me.attackTargetId).toBeNull();
  });

  it('a recall action starts the channel and the observation reports it', () => {
    const sim = new Sim(31);
    const me = sim.addChampion(0, { x: 75, z: 75 });
    expect(dispatchAction(sim, me.id, { kind: 'recall' })).toBe(true);
    expect(me.statuses.some((s) => s.kind === 'recall')).toBe(true);
    const obs = buildObservation(sim, me.id);
    expect(obs?.self.recalling).toBe(true);
  });

  it('refuses malformed coordinates', () => {
    const sim = new Sim(31);
    const me = sim.addChampion(0, { x: 75, z: 75 });
    expect(dispatchAction(sim, me.id, { kind: 'move', x: Number.NaN, z: 0 })).toBe(false);
    expect(me.path.length).toBe(0);
  });
});

describe('the action wire parser', () => {
  it('accepts every shape of the frozen action space', () => {
    expect(parseAction({ kind: 'noop' })).toEqual({ kind: 'noop' });
    expect(parseAction({ kind: 'move', x: 1, z: 2 })).toEqual({ kind: 'move', x: 1, z: 2 });
    expect(parseAction({ kind: 'attack', targetId: 3 })).toEqual({ kind: 'attack', targetId: 3 });
    expect(parseAction({ kind: 'cast', key: 'Q', x: 1, z: 2 })).toEqual({
      kind: 'cast',
      key: 'Q',
      x: 1,
      z: 2,
    });
    expect(parseAction({ kind: 'sigil', slot: 1, x: 1, z: 2 })).toEqual({
      kind: 'sigil',
      slot: 1,
      x: 1,
      z: 2,
    });
    expect(parseAction({ kind: 'buy', itemId: 'x' })).toEqual({ kind: 'buy', itemId: 'x' });
    expect(parseAction({ kind: 'level', key: 'R' })).toEqual({ kind: 'level', key: 'R' });
    expect(parseAction({ kind: 'recall' })).toEqual({ kind: 'recall' });
  });

  it('rejects everything else', () => {
    for (const bad of [
      null,
      42,
      'move',
      {},
      { kind: 'fly' },
      { kind: 'move', x: 'a', z: 2 },
      { kind: 'move', x: Number.NaN, z: 2 },
      { kind: 'cast', key: 'Z', x: 1, z: 2 },
      { kind: 'sigil', slot: 5, x: 1, z: 2 },
      { kind: 'attack', targetId: 1.5 },
      { kind: 'buy', itemId: 7 },
    ]) {
      expect(parseAction(bad)).toBeNull();
    }
  });
});
