// Assists pay in Respawn (src/sim/royale/assists.ts, levels.ts assistXp;
// ADR 0031, amended 2026-10-08): a takedown's last hit is paid in full and
// every other champion that hit the fallen within the sim's assist window
// (rewards.ts assistersOf) learns ASSIST_XP_SHARE of what the takedown
// would have paid it, bots and people alike, a fallen helper too, the
// levels it passes offering their Grafts. One life pays the last hit
// alone. And the 5v5's assists, counted by the same rule, are unchanged.

import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { GRAFT_LEVELS } from '../src/sim/content/grafts';
import { ASSIST_WINDOW_S, assistersOf } from '../src/sim/rewards';
import { ASSIST_XP_SHARE, assistXp, takedownXp } from '../src/sim/royale/levels';
import type { RoyaleVariant } from '../src/sim/royale/types';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { levelTo, xpForNext } from '../src/sim/stats';
import type { Unit } from '../src/sim/unit';
import { landed } from './royale_contract_fixture';

function ctxOf(sim: Sim): CombatCtx {
  return (sim as unknown as { ctx(): CombatCtx }).ctx();
}

// Every experience point a champion holds, its levels' included.
function xpTotal(u: Unit): number {
  let total = u.xp;
  for (let l = 1; l < u.level; l++) total += xpForNext(l);
  return total;
}

// A landed match of four people: the fallen, its taker, a helper who hit it
// within the window, and one whose hit is older than the window.
function scene(variant: RoyaleVariant) {
  const { sim, unitIds } = landed(variant);
  const [victim, taker, helper, late] = unitIds.map((id) => sim.units.get(id)!) as [
    Unit,
    Unit,
    Unit,
    Unit,
  ];
  levelTo(victim, 6);
  levelTo(helper, 4);
  const ctx = ctxOf(sim);
  dealDamage(ctx, helper.id, victim, 1, 'true');
  dealDamage(ctx, late.id, victim, 1, 'true');
  const hit = victim.recentDamagers.find((r) => r.id === late.id)!;
  hit.at = sim.time - ASSIST_WINDOW_S - 0.5;
  return { sim, victim, taker, helper, late };
}

// The taker's last hit, and the tick that settles the fall.
function takedown(sim: Sim, taker: Unit, victim: Unit): void {
  dealDamage(ctxOf(sim), taker.id, victim, victim.maxHp * 10, 'true');
  sim.tick();
}

describe('an assist in Respawn', () => {
  it('pays each helper in the window its share, the last hit in full', () => {
    const { sim, victim, taker, helper, late } = scene('respawn');
    expect(ASSIST_XP_SHARE.respawn).toBeGreaterThan(0);
    const before = new Map([taker, helper, late].map((u) => [u.id, xpTotal(u)]));
    const levels = { victim: victim.level, taker: taker.level, helper: helper.level };
    takedown(sim, taker, victim);
    expect(victim.dead).toBe(true);
    expect(xpTotal(taker) - before.get(taker.id)!).toBeCloseTo(
      takedownXp('respawn', levels.victim, levels.taker),
      6,
    );
    // Weighed by its own level: a lower helper learns more from the same fall.
    expect(xpTotal(helper) - before.get(helper.id)!).toBeCloseTo(
      assistXp('respawn', levels.victim, levels.helper),
      6,
    );
    expect(assistXp('respawn', 6, 4)).toBeCloseTo(
      takedownXp('respawn', 6, 4) * ASSIST_XP_SHARE.respawn,
      9,
    );
    expect(assistXp('respawn', 6, 4)).toBeGreaterThan(assistXp('respawn', 6, 8));
    // Out of the window: nothing, and no assist counted either.
    expect(xpTotal(late)).toBe(before.get(late.id)!);
    expect([helper.assists, late.assists]).toEqual([1, 0]);
  });

  it('pays a helper who is down, and leaves it at no health', () => {
    const { sim, victim, taker, helper } = scene('respawn');
    helper.dead = true;
    helper.hp = 0;
    helper.respawnAt = sim.time + 60;
    helper.xp = xpForNext(helper.level) - 1;
    const level = helper.level;
    takedown(sim, taker, victim);
    expect(helper.level).toBe(level + 1);
    expect(helper.dead).toBe(true);
    expect(helper.hp).toBe(0);
  });

  it('offers the Grafts of the levels an assist passes', () => {
    const { sim, victim, taker, helper } = scene('respawn');
    const level = Number(Object.keys(GRAFT_LEVELS.respawn)[0]);
    levelTo(helper, level - 1);
    helper.xp = xpForNext(helper.level) - 1;
    const offers = sim.royale!.offers.get(helper.id)?.length ?? 0;
    takedown(sim, taker, victim);
    expect(helper.level).toBe(level);
    const queue = sim.royale!.offers.get(helper.id) ?? [];
    expect(queue.length).toBeGreaterThan(offers);
    expect(queue.at(-1)!.grade).toBe(GRAFT_LEVELS.respawn[level]);
  });
});

describe('an assist in One life', () => {
  it('pays nothing: the last hit alone learns', () => {
    const { sim, victim, taker, helper } = scene('one_life');
    expect(ASSIST_XP_SHARE.one_life).toBe(0);
    const before = xpTotal(helper);
    const took = xpTotal(taker);
    takedown(sim, taker, victim);
    expect(helper.assists).toBe(1);
    expect(xpTotal(helper)).toBe(before);
    expect(xpTotal(taker)).toBeGreaterThan(took);
  });
});

describe('who earns an assist', () => {
  it('is every enemy champion that hit within the window, the killer aside, in hit order', () => {
    const sim = new Sim(5);
    const victim = sim.addChampion(0);
    const a = sim.addChampion(1);
    const b = sim.addChampion(1);
    const c = sim.addChampion(1);
    const ally = sim.addChampion(0);
    victim.recentDamagers = [
      { id: b.id, at: 10 },
      { id: a.id, at: 12 },
      { id: c.id, at: 1 },
      { id: ally.id, at: 12 },
    ];
    expect(assistersOf(sim.units, victim, a.id, 12).map((u) => u.id)).toEqual([b.id]);
    expect(assistersOf(sim.units, victim, 0, 12).map((u) => u.id)).toEqual([b.id, a.id]);
    expect(assistersOf(sim.units, victim, 0, 10 + ASSIST_WINDOW_S).map((u) => u.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect(assistersOf(sim.units, victim, 0, 10 + ASSIST_WINDOW_S + 0.1).map((u) => u.id)).toEqual([
      a.id,
    ]);
  });
});
