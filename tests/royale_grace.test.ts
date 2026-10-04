// The Grace (CONTEXT.md: Arrival; src/sim/royale/grace.ts): a fresh champion
// on the planet (a Respawn return, a drop-in's Arrival) cannot be damaged or
// targeted for ARRIVAL_GRACE_S, ended early by its own first attack or cast;
// readable in the observation (its own, and the graced champions in sight)
// so the bots do not waste attacks on it; on the wire for the shimmer; in
// the world checkpoint. And the shimmer's own pure rules.

import { describe, expect, it } from 'vitest';
import { royaleSimOf } from '../server/royale_build';
import { arrivalBlock } from '../server/royale_snapshot_blocks';
import { gracesOf, ownGraceUntil } from '../src/net/royale_client';
import { freshGraces, shimmerOpacity } from '../src/render/planet_grace';
import { dealDamage } from '../src/sim/combat/damage';
import { ROYALE_SKILLS } from '../src/sim/content/bots/royale_skills';
import { dist, type Vec3 } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { Rng } from '../src/sim/rng';
import { pickTarget } from '../src/sim/royale/bot/fight';
import { buildSense } from '../src/sim/royale/bot/sense';
import { ARRIVAL_GRACE_S, inGrace } from '../src/sim/royale/grace';
import { along, randomHeading } from '../src/sim/royale/layout';
import type { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import type { Unit } from '../src/sim/unit';
import { landed } from './royale_contract_fixture';

// A champion down, back on the next tick (the respawn loop), in its Grace.
function returned() {
  const built = landed('respawn');
  const { sim, unitIds } = built;
  const u = sim.units.get(unitIds[1]!)!;
  u.dead = true;
  u.hp = 0;
  u.respawnAt = sim.time;
  const backAt = sim.time;
  sim.tick();
  return { ...built, u, backAt };
}

// Another seat set down beside `u`, `m` meters off.
function beside(sim: Sim, u: Unit, other: Unit, m: number): void {
  const R = sim.royaleMode!.layout.radius;
  other.pos = along(u.pos as Vec3, randomHeading(new Rng(other.id), u.pos as Vec3), m, R);
  other.path = [];
}

function ctxOf(sim: Sim): CombatCtx {
  return (sim as unknown as { ctx(): CombatCtx }).ctx();
}

function tickUntil(sim: Sim, t: number): void {
  while (sim.time < t - 1e-9) sim.tick();
}

describe('the Grace of a Respawn return', () => {
  it('begins as the champion comes back, for ARRIVAL_GRACE_S', () => {
    const { sim, u, backAt } = returned();
    expect(u.dead).toBe(false);
    expect(sim.royale!.arriving.has(u.id)).toBe(true);
    expect(sim.royaleMode!.graces.get(u.id)).toEqual({
      since: backAt,
      until: backAt + ARRIVAL_GRACE_S,
      held: true,
    });
    // Holding its fire meanwhile, let go when it ends.
    expect(u.holding).toBe(true);
    expect(u.statuses).toContainEqual({ kind: 'untargetable', until: backAt + ARRIVAL_GRACE_S });
  });

  it('cannot be damaged, nor attacked, until it runs out', () => {
    const { sim, unitIds, u, backAt } = returned();
    const foe = sim.units.get(unitIds[2]!)!;
    beside(sim, u, foe, 2);
    const hp = u.hp;
    dealDamage(ctxOf(sim), foe.id, u, 500, 'true');
    expect(u.hp).toBe(hp);
    sim.orderAttack(foe.id, u.id);
    for (let i = 0; i < 20; i++) sim.tick();
    expect(u.hp).toBe(hp);
    expect(foe.attackTargetId).toBeNull();
    // Holding its fire, it never swung back: still in its Grace.
    expect(sim.royale!.arriving.has(u.id)).toBe(true);
    tickUntil(sim, backAt + ARRIVAL_GRACE_S);
    expect(inGrace(sim.royaleMode!, u.id, sim.time)).toBe(false);
    sim.tick();
    expect(sim.royale!.arriving.has(u.id)).toBe(false);
    expect(u.statuses.some((s) => s.kind === 'untargetable')).toBe(false);
    expect(u.holding).toBe(false);
    dealDamage(ctxOf(sim), foe.id, u, 100, 'true');
    expect(u.hp).toBeLessThan(hp);
  });

  it('ends at its own first cast, a kit status of its own kept', () => {
    const { sim, unitIds, u, backAt } = returned();
    const foe = sim.units.get(unitIds[2]!)!;
    beside(sim, u, foe, 4);
    // A kit's own untargetable status outlasting the Grace.
    u.statuses.push({ kind: 'untargetable', until: backAt + 10 });
    const cast = (['Q', 'W', 'E'] as const).some((k) =>
      sim.castAbility(u.id, k, { x: foe.pos.x, y: foe.pos.y, z: foe.pos.z }),
    );
    expect(cast).toBe(true);
    sim.tick();
    expect(sim.royale!.arriving.has(u.id)).toBe(false);
    expect(sim.royaleMode!.graces.has(u.id)).toBe(false);
    expect(u.statuses).toContainEqual({ kind: 'untargetable', until: backAt + 10 });
  });

  it('ends at its own first attack, ordered or struck by itself', () => {
    const ordered = returned();
    const foe = ordered.sim.units.get(ordered.unitIds[2]!)!;
    beside(ordered.sim, ordered.u, foe, 2);
    ordered.sim.orderAttack(ordered.u.id, foe.id);
    expect(ordered.sim.royale!.arriving.has(ordered.u.id)).toBe(true);
    ordered.sim.tick();
    expect(ordered.sim.royale!.arriving.has(ordered.u.id)).toBe(false);

    const idle = returned();
    const other = idle.sim.units.get(idle.unitIds[2]!)!;
    idle.u.pendingAttack = {
      targetId: other.id,
      resolveAt: idle.sim.time + 0.3,
      start: { ...idle.u.pos },
    };
    idle.sim.tick();
    expect(idle.sim.royale!.arriving.has(idle.u.id)).toBe(false);
  });

  it('is in the world checkpoint', () => {
    const { sim, u } = returned();
    const snap = sim.snapshot();
    const graces = structuredClone(sim.royaleMode!.graces);
    tickUntil(sim, sim.time + ARRIVAL_GRACE_S + 0.5);
    expect(sim.royaleMode!.graces.size).toBe(0);
    sim.restore(snap);
    expect(sim.royaleMode!.graces).toEqual(graces);
    expect(sim.royale!.arriving.has(u.id)).toBe(true);
  });
});

describe('the Grace in the observation', () => {
  it('tells the seat its own, and every seat in sight the graced champions', () => {
    const { sim, unitIds, u, backAt } = returned();
    const near = sim.units.get(unitIds[2]!)!;
    const far = sim.units.get(unitIds[3]!)!;
    beside(sim, u, near, 3);
    beside(sim, u, far, 70);
    sim.tick();
    expect(buildObservation(sim, u.id)!.royale!.arriving).toBe(true);
    expect(buildObservation(sim, u.id)!.royale).not.toHaveProperty('graced');
    expect(buildObservation(sim, near.id)!.royale!.graced).toEqual([
      { id: u.id, until: backAt + ARRIVAL_GRACE_S },
    ]);
    expect(buildObservation(sim, near.id)!.royale).not.toHaveProperty('arriving');
    expect(sim.isVisible(far.team, u.id)).toBe(false);
    expect(buildObservation(sim, far.id)!.royale).not.toHaveProperty('graced');
  });

  it('keeps a bot from picking a graced enemy, and not once it runs out', () => {
    const { sim, unitIds, u, backAt } = returned();
    const bot = sim.units.get(unitIds[2]!)!;
    for (const id of unitIds) {
      if (id !== u.id && id !== bot.id) beside(sim, u, sim.units.get(id)!, 70);
    }
    // Within close sight: seen through any bush.
    beside(sim, u, bot, 2.5);
    sim.tick();
    const layout = sim.royaleMode!.layout;
    const senseNow = () => {
      const obs = buildObservation(sim, bot.id)!;
      return buildSense(obs, obs.royale!, layout, ROYALE_SKILLS.strong);
    };
    const graced = senseNow();
    expect(graced.enemies.map((e) => e.id)).toContain(u.id);
    expect(pickTarget(graced, 30)).toBeNull();
    tickUntil(sim, backAt + ARRIVAL_GRACE_S + 0.1);
    beside(sim, u, bot, 2.5);
    sim.tick();
    expect(pickTarget(senseNow(), 30)?.id).toBe(u.id);
  });
});

describe('the Grace on the wire', () => {
  it('lists the graced champions the viewer sees, itself included', () => {
    const { sim, unitIds, u, backAt } = returned();
    const near = sim.units.get(unitIds[2]!)!;
    const far = sim.units.get(unitIds[3]!)!;
    beside(sim, u, near, 3);
    beside(sim, u, far, 70);
    sim.tick();
    const rs = royaleSimOf(sim);
    const ctx = { seat: () => undefined, seats: 4, people: 4, caches: false };
    const viewer = (v: Unit) => ({
      unitId: v.id,
      team: v.team,
      known: new Set<number>(),
      seat: { ack: 0, ackAt: 0 },
    });
    const own = arrivalBlock(rs, viewer(u), ctx)!;
    expect(own).toHaveLength(1);
    expect(own[0]![0]).toBe(u.id);
    expect(own[0]![1]).toBeCloseTo(backAt + ARRIVAL_GRACE_S, 2);
    expect(dist({ x: own[0]![2], y: own[0]![3], z: own[0]![4] }, u.pos)).toBeLessThan(0.01);
    expect(arrivalBlock(rs, viewer(near), ctx)!.map((g) => g[0])).toEqual([u.id]);
    expect(arrivalBlock(rs, viewer(far), ctx)).toBeUndefined();
    // The client reads it back.
    expect(gracesOf({ ar: own })).toEqual([
      { unitId: u.id, until: own[0]![1], at: [own[0]![2], own[0]![3], own[0]![4]] },
    ]);
    expect(ownGraceUntil({ ar: own }, u.id)).toBe(own[0]![1]);
    expect(ownGraceUntil({ ar: own }, near.id)).toBeNull();
    expect(gracesOf({ ar: [[1, 2], 'x', [1, 2, 3, 4, 'z']] })).toEqual([]);
    expect(gracesOf(null)).toEqual([]);
    // Gone once it runs out.
    tickUntil(sim, backAt + ARRIVAL_GRACE_S + 0.1);
    expect(arrivalBlock(rs, viewer(u), ctx)).toBeUndefined();
  });
});

describe('the shimmer', () => {
  it('pulses softly and fades through its last half second', () => {
    for (const ms of [0, 130, 300, 777]) {
      const o = shimmerOpacity(10, 7, ms);
      expect(o).toBeGreaterThanOrEqual(0.25 - 1e-9);
      expect(o).toBeLessThanOrEqual(0.45 + 1e-9);
    }
    expect(shimmerOpacity(10, 9.75, 0)).toBeCloseTo(shimmerOpacity(10, 7, 0) / 2, 9);
    expect(shimmerOpacity(10, 10, 0)).toBe(0);
    expect(shimmerOpacity(10, 11, 0)).toBe(0);
  });

  it('raises the dust once, for a Grace just begun', () => {
    const seen = new Set<number>();
    const g = (unitId: number, until: number) => ({ unitId, until, at: [0, 80, 0] as const });
    const fresh = [g(1, 5 + ARRIVAL_GRACE_S), g(2, 5 + 1)];
    // Seat 2 walked into sight two seconds into its Grace: no dust.
    const first = freshGraces(
      seen,
      fresh.map((x) => ({ ...x, at: [...x.at] as [number, number, number] })),
      5,
    );
    expect(first.map((x) => x.unitId)).toEqual([1]);
    expect(freshGraces(seen, [{ ...g(1, 8), at: [0, 80, 0] }], 5.1)).toEqual([]);
    expect(freshGraces(seen, [], 6)).toEqual([]);
    expect(seen.size).toBe(0);
  });
});
