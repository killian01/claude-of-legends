// The Burr (CONTEXT.md; src/sim/royale/burr.ts): Respawn's score to settle.
// Whoever takes a champion down carries its Burr for BURR_S; taking the
// carrier down while it lasts counts double and pays a piece more; a later
// takedown moves it; paying spends it; an Arrival starts the seat clean;
// One life has none. Only the owner's observation reads it, with the
// carrier's level and where it stands while it stands.

import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { buildObservation } from '../src/sim/observe';
import {
  BURR_PIECES,
  BURR_S,
  BURR_SCORE_FACTOR,
  burrOnTakedown,
  clearBurrs,
  liveBurr,
  NO_BURR,
  settlesBurr,
} from '../src/sim/royale/burr';
import { LEADER_TAKEDOWN_SCORE, RESPAWN_S, type RoyaleState } from '../src/sim/royale/types';
import type { Sim, SimEvent } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { DT } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { landed } from './royale_contract_fixture';
import { FakeRoyaleSim } from './royale_fake';

function playState(variant: 'respawn' | 'one_life' = 'respawn'): RoyaleState {
  const s = new FakeRoyaleSim(variant).royale;
  s.stage = 'play';
  return s;
}

function of<T extends SimEvent['type']>(events: readonly SimEvent[], type: T) {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function takedown(sim: Sim, killer: Unit, victim: Unit): SimEvent[] {
  killer.pos = { ...victim.pos };
  killer.path = [];
  const ctx = (sim as unknown as { ctx(): CombatCtx }).ctx();
  dealDamage(ctx, killer.id, victim, victim.maxHp * 10, 'true');
  return sim.tick();
}

// Ticks until the champion is back from its Respawn death, and past the
// return's Grace.
function backUp(sim: Sim, u: Unit): void {
  for (let i = 0; i < Math.round((RESPAWN_S + 4) / DT) && u.dead; i++) sim.tick();
  for (let i = 0; i < Math.round(4 / DT); i++) sim.tick();
}

function seats(sim: Sim, ids: readonly number[]): Unit[] {
  return ids.map((id) => sim.units.get(id)!);
}

describe('the Burr rules', () => {
  it('hangs the victim Burr on the taker for BURR_S, and pays nothing yet', () => {
    const s = playState();
    expect(burrOnTakedown(s, 2, 1, 100)).toEqual(NO_BURR);
    expect(s.burrs.get(2)).toEqual({ carrierId: 1, until: 100 + BURR_S });
    expect(BURR_S).toBe(60);
    expect(liveBurr(s.burrs, 2, 160)).not.toBeNull();
    expect(liveBurr(s.burrs, 2, 160.05)).toBeNull();
  });

  it('pays the carrier taken down while it lasts double and a piece, and spends it', () => {
    const s = playState();
    burrOnTakedown(s, 2, 1, 100);
    expect(settlesBurr(s.burrs, 2, 1, 130)).toBe(true);
    expect(settlesBurr(s.burrs, 3, 1, 130)).toBe(false);
    expect(burrOnTakedown(s, 1, 2, 130)).toEqual({
      factor: BURR_SCORE_FACTOR,
      pieces: BURR_PIECES,
    });
    expect([BURR_SCORE_FACTOR, BURR_PIECES]).toEqual([2, 1]);
    // Spent, and the carrier's own Burr now on the one who settled it.
    expect(s.burrs.has(2)).toBe(false);
    expect(s.burrs.get(1)).toEqual({ carrierId: 2, until: 130 + BURR_S });
  });

  it('pays nothing once it ran out, or on someone else', () => {
    const s = playState();
    burrOnTakedown(s, 2, 1, 100);
    expect(burrOnTakedown(s, 3, 2, 120)).toEqual(NO_BURR);
    expect(burrOnTakedown(s, 1, 2, 160.1)).toEqual(NO_BURR);
  });

  it('moves to whoever takes the owner down next', () => {
    const s = playState();
    burrOnTakedown(s, 2, 1, 100);
    burrOnTakedown(s, 2, 3, 120);
    expect(s.burrs.get(2)).toEqual({ carrierId: 3, until: 120 + BURR_S });
    expect(burrOnTakedown(s, 1, 2, 125)).toEqual(NO_BURR);
  });

  it('starts a seat clean: its own Burr and the ones it carries go', () => {
    const s = playState();
    burrOnTakedown(s, 2, 1, 100);
    burrOnTakedown(s, 3, 1, 101);
    burrOnTakedown(s, 1, 4, 102);
    clearBurrs(s, 1);
    expect([...s.burrs.keys()]).toEqual([]);
  });

  it('has none in One life, nor outside the play', () => {
    const one = playState('one_life');
    expect(burrOnTakedown(one, 2, 1, 100)).toEqual(NO_BURR);
    expect(one.burrs.size).toBe(0);
    const over = playState();
    over.stage = 'over';
    burrOnTakedown(over, 2, 1, 700);
    expect(over.burrs.size).toBe(0);
  });
});

describe('the Burr in a match', () => {
  it('shows only its owner the carrier, its level and where it stands while it stands', () => {
    const { sim, unitIds } = landed('respawn');
    const [a, b, c] = seats(sim, unitIds);
    takedown(sim, a!, b!);
    const at = sim.time - DT;
    const own = buildObservation(sim, b!.id)!.royale!;
    expect(own.burr).toEqual({
      id: a!.id,
      level: a!.level,
      until: expect.closeTo(at + BURR_S, 6),
      at: { x: a!.pos.x, y: a!.pos.y, z: a!.pos.z },
    });
    expect(buildObservation(sim, a!.id)!.royale).not.toHaveProperty('burr');
    expect(buildObservation(sim, c!.id)!.royale).not.toHaveProperty('burr');
    // The carrier down: no point to show until it stands again.
    takedown(sim, c!, a!);
    expect(buildObservation(sim, b!.id)!.royale!.burr).not.toHaveProperty('at');
  });

  it('counts the carrier taken down double, with a piece more', () => {
    const { sim, unitIds } = landed('respawn');
    const [a, b] = seats(sim, unitIds);
    takedown(sim, a!, b!);
    backUp(sim, b!);
    expect(b!.dead).toBe(false);
    const events = takedown(sim, b!, a!);
    expect(sim.royale!.scores.get(b!.id)).toBe(BURR_SCORE_FACTOR);
    expect(of(events, 'royale_loot').filter((e) => e.unitId === b!.id)).toHaveLength(
      1 + BURR_PIECES,
    );
    expect(sim.royaleMode!.tally.burrTakedowns).toBe(1);
    expect(buildObservation(sim, b!.id)!.royale).not.toHaveProperty('burr');
    expect(buildObservation(sim, a!.id)!.royale!.burr?.id).toBe(b!.id);
  });

  it('doubles a Lodestar takedown too', () => {
    const { sim, unitIds } = landed('respawn');
    const [a, b] = seats(sim, unitIds);
    takedown(sim, a!, b!);
    backUp(sim, b!);
    sim.royale!.scores.set(a!.id, 5);
    sim.tick();
    expect(sim.royale!.marks.some((m) => m.unitId === a!.id && m.kind === 'lodestar')).toBe(true);
    takedown(sim, b!, a!);
    expect(sim.royale!.scores.get(b!.id)).toBe(LEADER_TAKEDOWN_SCORE * BURR_SCORE_FACTOR);
  });

  it('lets a Burr run out after BURR_S', () => {
    const { sim, unitIds } = landed('respawn');
    const [a, b] = seats(sim, unitIds);
    takedown(sim, a!, b!);
    for (let i = 0; i < Math.round((BURR_S + 0.5) / DT); i++) sim.tick();
    expect(sim.royale!.burrs.size).toBe(0);
    expect(buildObservation(sim, b!.id)!.royale).not.toHaveProperty('burr');
    takedown(sim, b!, a!);
    expect(sim.royale!.scores.get(b!.id)).toBe(1);
  });

  it('starts a drop-in clean on its Arrival', () => {
    const { sim, unitIds } = landed('respawn');
    const [a, b, c] = seats(sim, unitIds);
    takedown(sim, a!, b!);
    takedown(sim, c!, a!);
    expect(sim.royale!.burrs.size).toBe(2);
    sim.beginArrival(a!.id);
    expect([...sim.royale!.burrs.keys()]).toEqual([]);
  });

  it('carries none in One life', () => {
    const { sim, unitIds } = landed('one_life');
    const [a, b] = seats(sim, unitIds);
    takedown(sim, a!, b!);
    expect(sim.royale!.burrs.size).toBe(0);
    expect(buildObservation(sim, b!.id)?.royale).not.toHaveProperty('burr');
  });
});
