// The marks (src/sim/royale/marks.ts, CONTEXT.md: Lodestar, Ablaze): the
// Lodestar (Respawn's leader at 5 or more, One life's most takedowns, 2 or
// more, from the second closing), shown every 20 s and every 10 s while it
// leads by 8; Ablaze at a run of 3 (One life) or 5 (Respawn), the three
// longest only, shown every 15 s; each show 4 s long, the point held still
// while hidden; what a takedown on a mark pays.

import { describe, expect, it } from 'vitest';
import { buildRoyaleSim, type ReplayPick } from '../src/net/replay';
import { dealDamage } from '../src/sim/combat/damage';
import {
  ABLAZE_EVERY_S,
  LODESTAR_EVERY_S,
  LODESTAR_RUNAWAY_EVERY_S,
  WRATH_EVERY_S,
} from '../src/sim/content/royale_events';
import { buildObservation } from '../src/sim/observe';
import {
  ablazeRuns,
  lodestarOf,
  type MarkSeat,
  markEvery,
  markPayout,
  markShown,
  stepMarks,
} from '../src/sim/royale/marks';
import {
  DROP_S,
  LEADER_TAKEDOWN_SCORE,
  MARK_SHOWN_S,
  type RoyaleVariant,
} from '../src/sim/royale/types';
import type { Sim, SimEvent } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { DT } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { loadPlanet } from './royale_planet';

function seat(id: number, score: number, streak = 0, alive = true): MarkSeat {
  return { id, score, deaths: 0, alive, streak };
}

function picks(n: number): ReplayPick[] {
  const ids = ['dain', 'vesk', 'sylra', 'korrath', 'maera'];
  return Array.from({ length: n }, (_, i) => ({
    name: `seat${i}`,
    team: i,
    championId: ids[i % ids.length]!,
    sigils: ['riftstep', 'mend'] as [string, string],
  }));
}

function build(n: number, variant: RoyaleVariant) {
  const built = buildRoyaleSim(loadPlanet(), 5, picks(n), variant);
  // Landed, and past the landing's Grace (royale/grace.ts).
  run(built.sim, DROP_S + 4);
  return built;
}

function run(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...sim.tick());
  return out;
}

function of<T extends SimEvent['type']>(events: SimEvent[], type: T) {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function takedown(sim: Sim, killer: Unit, victim: Unit): SimEvent[] {
  killer.pos = { ...victim.pos };
  killer.path = [];
  const ctx = (sim as unknown as { ctx(): CombatCtx }).ctx();
  dealDamage(ctx, killer.id, victim, victim.maxHp * 10, 'true');
  return sim.tick();
}

describe('who is marked', () => {
  it('makes Respawn leader the Lodestar from five takedowns', () => {
    expect(lodestarOf('respawn', [seat(1, 4), seat(2, 3)], 0)).toBeNull();
    expect(lodestarOf('respawn', [seat(1, 5), seat(2, 3)], 0)).toBe(1);
    expect(lodestarOf('respawn', [seat(1, 5, 0, false), seat(2, 6)], 0)).toBe(2);
    // A dead leader is still the leader in Respawn.
    expect(lodestarOf('respawn', [seat(1, 7, 0, false), seat(2, 6)], 0)).toBe(1);
  });

  it('makes One life most takedowns the Lodestar from the second closing, two or more', () => {
    const seats = [seat(4, 2), seat(3, 2), seat(1, 1)];
    expect(lodestarOf('one_life', seats, 1)).toBeNull();
    expect(lodestarOf('one_life', seats, 2)).toBe(3);
    expect(lodestarOf('one_life', [seat(1, 1)], 3)).toBeNull();
    expect(lodestarOf('one_life', [seat(1, 5, 0, false), seat(2, 2)], 3)).toBe(2);
  });

  it('marks Ablaze a run of three in One life, five in Respawn, the three longest', () => {
    expect(ablazeRuns('one_life', [seat(1, 0, 2), seat(2, 0, 3)])).toEqual([{ id: 2, streak: 3 }]);
    expect(ablazeRuns('respawn', [seat(1, 0, 4), seat(2, 0, 5)])).toEqual([{ id: 2, streak: 5 }]);
    const many = [seat(1, 0, 3), seat(2, 0, 6), seat(3, 0, 4), seat(4, 0, 4), seat(5, 0, 9)];
    expect(ablazeRuns('one_life', many).map((r) => r.id)).toEqual([5, 2, 3]);
    expect(ablazeRuns('one_life', [seat(1, 0, 4, false)])).toEqual([]);
  });

  it('shows the Lodestar every 20 s, every 10 s with a lead of 8, each show for 4 s', () => {
    expect(markEvery('lodestar', 7)).toBe(LODESTAR_EVERY_S);
    expect(markEvery('lodestar', 8)).toBe(LODESTAR_RUNAWAY_EVERY_S);
    expect([LODESTAR_EVERY_S, LODESTAR_RUNAWAY_EVERY_S]).toEqual([20, 10]);
    expect(markEvery('ablaze')).toBe(ABLAZE_EVERY_S);
    expect(ABLAZE_EVERY_S).toBe(15);
    expect(markEvery('wrath')).toBe(WRATH_EVERY_S);
    expect(WRATH_EVERY_S).toBe(10);
    expect(markEvery('slayer')).toBe(Number.POSITIVE_INFINITY);
    expect(MARK_SHOWN_S).toBe(4);
    expect(markShown({ shownAt: 10 }, 14)).toBe(true);
    expect(markShown({ shownAt: 10 }, 14.05)).toBe(false);
  });
});

describe('what a takedown on a mark pays', () => {
  it('pays the Lodestar double and a piece', () => {
    expect(markPayout('respawn', true, null)).toEqual({
      score: LEADER_TAKEDOWN_SCORE,
      pieces: 1,
      snuffed: null,
    });
    expect(markPayout('one_life', false, null)).toEqual({ score: 1, pieces: 0, snuffed: null });
  });

  it('pays a snuffed run 1 + floor(run / 3) pieces, at most 3, and a point more in Respawn', () => {
    expect(markPayout('one_life', false, 3)).toEqual({ score: 1, pieces: 2, snuffed: 3 });
    expect(markPayout('one_life', false, 5)).toMatchObject({ pieces: 2 });
    expect(markPayout('one_life', false, 6)).toMatchObject({ pieces: 3 });
    expect(markPayout('one_life', false, 12)).toMatchObject({ pieces: 3 });
    expect(markPayout('respawn', false, 5)).toEqual({ score: 2, pieces: 2, snuffed: 5 });
    expect(markPayout('respawn', true, 6)).toEqual({ score: 3, pieces: 4, snuffed: 6 });
  });
});

describe('the marks in a match', () => {
  it('marks the Respawn Lodestar at once, shows it again every 20 s, and holds its point hidden', () => {
    const { sim, unitIds } = build(3, 'respawn');
    const [a, b] = unitIds.map((id) => sim.units.get(id)!) as [Unit, Unit];
    sim.royale!.scores.set(a.id, 5);
    const events = sim.tick();
    expect(of(events, 'royale_mark')).toEqual([
      { type: 'royale_mark', unitId: a.id, kind: 'lodestar' },
    ]);
    const shownAt = sim.royale!.marks[0]!.shownAt;
    expect(shownAt).toBeCloseTo(sim.time - DT, 6);
    let obs = buildObservation(sim, b.id)!.royale!;
    expect(obs.marks).toEqual([
      expect.objectContaining({ id: a.id, kind: 'lodestar', level: a.level, shownAt }),
    ]);
    expect(obs.leader?.at).toBeDefined();
    run(sim, MARK_SHOWN_S + 0.5);
    const held = { ...sim.royale!.marks[0]!.at };
    a.pos = { ...b.pos };
    run(sim, 1);
    expect(sim.royale!.marks[0]!.at).toEqual(held);
    obs = buildObservation(sim, b.id)!.royale!;
    expect(obs.leader?.at).toBeUndefined();
    run(sim, LODESTAR_EVERY_S - MARK_SHOWN_S - 1.5);
    const again = sim.royale!.marks[0]!;
    expect(again.shownAt).toBeCloseTo(shownAt + LODESTAR_EVERY_S, 6);
    expect(again.at.x).toBeCloseTo(a.pos.x, 6);
  });

  it('shows a runaway Lodestar every 10 s', () => {
    const { sim, unitIds } = build(3, 'respawn');
    sim.royale!.scores.set(unitIds[0]!, 9);
    sim.tick();
    const first = sim.royale!.marks[0]!.shownAt;
    run(sim, LODESTAR_RUNAWAY_EVERY_S + DT);
    expect(sim.royale!.marks[0]!.shownAt).toBeCloseTo(first + LODESTAR_RUNAWAY_EVERY_S, 6);
  });

  it('pays a takedown on the Lodestar two and a piece more', () => {
    const { sim, unitIds } = build(3, 'respawn');
    const [a, b] = unitIds.map((id) => sim.units.get(id)!) as [Unit, Unit];
    sim.royale!.scores.set(a.id, 5);
    sim.tick();
    const events = takedown(sim, b, a);
    expect(sim.royale!.scores.get(b.id)).toBe(LEADER_TAKEDOWN_SCORE);
    expect(of(events, 'royale_loot').filter((e) => e.unitId === b.id)).toHaveLength(2);
    expect(sim.royaleMode!.tally.markTakedowns).toBe(1);
  });

  it('marks a One life run of three Ablaze, and pays its snuffing out', () => {
    const { sim, unitIds } = build(3, 'one_life');
    const [a, b] = unitIds.map((id) => sim.units.get(id)!) as [Unit, Unit];
    a.killStreak = 3;
    const events = sim.tick();
    expect(of(events, 'royale_mark')).toEqual([
      { type: 'royale_mark', unitId: a.id, kind: 'ablaze' },
    ]);
    expect(buildObservation(sim, b.id)!.royale!.marks).toEqual([
      expect.objectContaining({ id: a.id, kind: 'ablaze', streak: 3 }),
    ]);
    const after = takedown(sim, b, a);
    expect(of(after, 'royale_snuffed')).toEqual([
      { type: 'royale_snuffed', unitId: a.id, killerId: b.id, streak: 3 },
    ]);
    // The takedown's piece and the snuffing's two.
    expect(of(after, 'royale_loot').filter((e) => e.unitId === b.id)).toHaveLength(3);
    expect(sim.royale!.marks.some((m) => m.unitId === a.id)).toBe(false);
  });

  it('keeps a run under the line unmarked in Respawn', () => {
    const { sim, unitIds } = build(2, 'respawn');
    sim.units.get(unitIds[0]!)!.killStreak = 4;
    expect(of(sim.tick(), 'royale_mark')).toEqual([]);
  });

  it('marks One life Lodestar only from the second closing', () => {
    const { sim, unitIds } = build(3, 'one_life');
    sim.royale!.scores.set(unitIds[1]!, 3);
    sim.tick();
    expect(sim.royale!.marks).toEqual([]);
    // The second closing, as the Dusk's step leaves it before the marks.
    sim.royale!.dusk.phase = 2;
    stepMarks(sim.royaleMode!, sim);
    expect(sim.royale!.marks.map((m) => [m.unitId, m.kind])).toEqual([[unitIds[1]!, 'lodestar']]);
  });
});
