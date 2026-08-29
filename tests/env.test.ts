// The environment gate (ADR 0002 phase 2): a match steppable from outside
// the repo, one step per decision slot, with the Policy contract and
// nothing else crossing the boundary.

import { describe, expect, it } from 'vitest';
import { defaultSeats, Env, TEAM_SIZE } from '../headless/env';
import { handleRequest, parseActions, parseSeats } from '../headless/requests';
import { POLICY_PERIOD_TICKS } from '../src/sim/bot_driver';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { POLICY_CONTRACT_VERSION } from '../src/sim/policy';

describe('the environment', () => {
  it('seats a full 5v5 with no duplicate champion inside a team', () => {
    const seats = defaultSeats();
    expect(seats.length).toBe(TEAM_SIZE * 2);
    for (const team of [0, 1] as const) {
      const ids = seats.filter((s) => s.team === team).map((s) => s.championId);
      expect(ids.length).toBe(TEAM_SIZE);
      expect(new Set(ids).size).toBe(TEAM_SIZE);
    }
    expect(seats.filter((s) => s.remote).length).toBe(1);
  });

  it('reports the contract it speaks', () => {
    const info = new Env({ seed: 3 }).info();
    expect(info.contract).toBe(POLICY_CONTRACT_VERSION);
    expect(info.periodTicks).toBe(POLICY_PERIOD_TICKS);
    expect(info.seats.length).toBe(TEAM_SIZE * 2);
    expect(info.seats.filter((s) => s.remote).map((s) => s.index)).toEqual([0]);
  });

  it('advances exactly one decision slot per step, with one observation', () => {
    const env = new Env({ seed: 5 });
    const first = env.reset();
    expect(env.sim.tickCount).toBe(POLICY_PERIOD_TICKS);
    expect(Object.keys(first.observations)).toEqual(['0']);
    const second = env.step({ 0: { kind: 'move', x: 90, z: 90 } });
    expect(env.sim.tickCount).toBe(POLICY_PERIOD_TICKS * 2);
    expect(Object.keys(second.observations)).toEqual(['0']);
    expect(second.done).toBe(false);
  });

  it('gives the remote seat the fogged observation, never the whole world', () => {
    const env = new Env({ seed: 5 });
    const obs = env.reset().observations[0];
    expect(obs).toBeDefined();
    expect(obs!.self.team).toBe(0);
    // Nine other champions exist; the seat sees only the ones its team sees.
    const champions = obs!.units.filter((u) => u.kind === 'champion');
    expect(champions.length).toBeLessThan(9);
    expect(champions.every((u) => u.id !== obs!.self.id)).toBe(true);
  });

  it('is deterministic: the same seed and the same actions give the same match', () => {
    const run = (): string => {
      const env = new Env({ seed: 77 });
      env.reset();
      for (let i = 0; i < 40; i++) env.step({ 0: { kind: 'move', x: 90, z: 90 } });
      return [...env.sim.units.values()]
        .sort((a, b) => a.id - b.id)
        .map((u) => `${u.id}:${u.pos.x.toFixed(6)}:${u.hp.toFixed(6)}`)
        .join('|');
    };
    expect(run()).toBe(run());
  });

  it('stops at the tick cap instead of spinning forever', () => {
    const env = new Env({ seed: 9, maxTicks: POLICY_PERIOD_TICKS * 3 });
    env.reset();
    env.step();
    const last = env.step();
    expect(last.done).toBe(true);
    expect(env.sim.tickCount).toBeLessThanOrEqual(POLICY_PERIOD_TICKS * 3);
  });
});

describe('the environment request protocol', () => {
  it('answers info, reset and step', () => {
    let env = new Env();
    const info = handleRequest(env, { t: 'info' });
    expect(info.response.t).toBe('info');

    const reset = handleRequest(env, { t: 'reset', seed: 12 });
    env = reset.env;
    expect(reset.response.t).toBe('obs');
    expect(env.seed).toBe(12);

    const step = handleRequest(env, { t: 'step', actions: { 0: { kind: 'noop' } } });
    expect(step.response.t).toBe('obs');
  });

  it('closes on request and refuses what it does not understand', () => {
    const env = new Env();
    expect(handleRequest(env, { t: 'close' }).close).toBe(true);
    expect(handleRequest(env, { t: 'fly' }).response.t).toBe('error');
    expect(handleRequest(env, 'not an object').response.t).toBe('error');
    expect(handleRequest(env, { t: 'reset', seats: 'nope' }).response.t).toBe('error');
  });

  it('validates seats and drops malformed actions rather than guessing', () => {
    const good = parseSeats([{ team: 1, championId: CHAMPION_LIST[0]!.id, remote: true }]);
    expect(good).toEqual([{ team: 1, championId: CHAMPION_LIST[0]!.id, remote: true }]);
    expect(parseSeats([{ team: 0, championId: 'nobody' }])).toBeNull();
    expect(parseSeats([])).toBeNull();

    expect(parseActions({ 0: { kind: 'noop' }, 1: { kind: 'fly' }, x: { kind: 'noop' } })).toEqual({
      0: { kind: 'noop' },
    });
  });
});
