import { describe, expect, it } from 'vitest';
import { stepAutoAttacks } from '../src/sim/combat/auto_attack';
import { voidmaulSlamPoint } from '../src/sim/combat/voidmaul_slam';
import { CREATURES, VOIDMAUL_SLAM_WINDUP_S } from '../src/sim/content/rings';
import { VOIDMAUL_SLAM } from '../src/sim/content/voidmaul_slam';
import { copy, dirTo, dist, heading, offset } from '../src/sim/geo';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import type { TeamId, Vec2 } from '../src/sim/types';
import { createCreature } from '../src/sim/unit';
import { HOME, offGround, planetSim } from './sphere_world';

function fixture(
  creature: 'voidmaul' | 'pyrefang' = 'voidmaul',
  ascendant = false,
  sphere = false,
) {
  const sim = sphere ? planetSim() : new Sim(17);
  sim.units.clear();
  const pos = sphere ? copy(HOME) : { x: 75, z: 75 };
  const boss = createCreature(100_000, CREATURES[creature], pos, ascendant ? null : 'bulwark', 390);
  boss.stats.ad = 100;
  boss.bitePct = 0.01;
  sim.units.set(boss.id, boss);
  const add = (at: Vec2, team: TeamId = 1) => {
    const u = sim.addChampion(team, at, 'korrath');
    u.hp = 1000;
    u.maxHp = 1000;
    u.stats.armor = 0;
    return u;
  };
  const target = add(offset(pos, heading(pos, Math.PI / 2), 2.5));
  boss.attackTargetId = target.id;
  let nextId = 200_000;
  const ctx: CombatCtx & { time: number } = {
    time: 0,
    rng: sim.rng,
    nav: sim.nav,
    ground: sim.ground,
    units: sim.units,
    projectiles: sim.projectiles,
    zones: sim.zones,
    walls: sim.walls,
    teamBuffs: sim.teamBuffs,
    dead: new Set(),
    killers: new Map(),
    events: [],
    allocId: () => nextId++,
  };
  const step = (at: number) => {
    ctx.time = at;
    stepAutoAttacks(ctx);
  };
  return { sim, boss, target, ctx, step, add };
}

describe('Voidmaul committed area slam', () => {
  it('resolves on the authored contact beat with one primary hit and reduced splash, without a bolt or repeated damage', () => {
    const { boss, target, ctx, step, add } = fixture();
    const impact = voidmaulSlamPoint(boss, target.pos);
    // The neutral boss threatens both champion teams.
    const nearby = add(impact, 0);
    step(0);
    expect(boss.pendingAttack?.resolveAt).toBe(VOIDMAUL_SLAM_WINDUP_S);
    expect(target.hp).toBe(1000);
    expect(nearby.hp).toBe(1000);
    expect(ctx.events.filter((e) => e.type === 'voidmaul_slam')).toHaveLength(0);
    step(VOIDMAUL_SLAM_WINDUP_S - 0.001);
    expect(target.hp).toBe(1000);
    expect(nearby.hp).toBe(1000);
    step(VOIDMAUL_SLAM_WINDUP_S);
    expect(target.hp).toBe(890);
    expect(nearby.hp).toBe(928.5);
    expect(ctx.projectiles.size).toBe(0);
    expect(ctx.events.filter((e) => e.type === 'voidmaul_slam')).toEqual([
      {
        type: 'voidmaul_slam',
        unitId: boss.id,
        targetId: target.id,
        ...impact,
        radius: 5.5,
        at: VOIDMAUL_SLAM_WINDUP_S,
      },
    ]);
    for (const victim of [target, nearby]) {
      const physical = ctx.events.filter(
        (e) => e.type === 'damage' && e.targetId === victim.id && e.dtype === 'physical',
      );
      expect(physical).toHaveLength(1);
    }
    step(VOIDMAUL_SLAM_WINDUP_S);
    step(2);
    expect(target.hp).toBe(890);
    expect(nearby.hp).toBe(928.5);
    expect(ctx.events.filter((e) => e.type === 'voidmaul_slam')).toHaveLength(1);
  });

  it('keeps the ground point fixed while its primary dodges, and still strikes another enemy in that disk', () => {
    const { boss, target, ctx, step, add } = fixture();
    step(0);
    const point = copy(boss.pendingAttack!.voidmaulSlam!.point);
    const nearby = add(point);
    target.pos = offset(point, heading(point, 0), 15);
    // A later heading or incidental creature drift cannot move the mark.
    boss.pos = offset(boss.pos, heading(boss.pos, 0), 0.2);
    step(VOIDMAUL_SLAM_WINDUP_S);
    const impact = ctx.events.find((e) => e.type === 'voidmaul_slam');
    expect(impact).toMatchObject({ ...point, at: VOIDMAUL_SLAM_WINDUP_S });
    expect(target.hp).toBe(1000);
    expect(nearby.hp).toBe(928.5);
  });

  it('includes touching body edges but skips allies, self, dead and untargetable bodies without duplicating a victim', () => {
    const { boss, target, ctx, step, add } = fixture();
    // Exercise the same hostility rule for a non-neutral ally-controlled
    // body; ordinary neutral Voidmaul intentionally threatens both teams.
    boss.neutral = false;
    const point = voidmaulSlamPoint(boss, target.pos);
    const edge = add(point);
    edge.pos = { x: point.x + VOIDMAUL_SLAM.radius + edge.radius, z: point.z };
    const outside = add({ x: edge.pos.x + 0.00001, z: edge.pos.z });
    const ally = add(point, 0);
    const dead = add(point);
    dead.dead = true;
    const dying = add(point);
    ctx.dead.add(dying.id);
    const invulnerable = add(point);
    invulnerable.statuses.push({ kind: 'untargetable', until: 3 });
    // Even an alias in a malformed caller's map must not double-hit.
    ctx.units.set(300_000, edge);
    const bossHp = boss.hp;
    step(0);
    step(VOIDMAUL_SLAM_WINDUP_S);
    expect(edge.hp).toBe(928.5);
    for (const victim of [outside, ally, dead, dying, invulnerable]) expect(victim.hp).toBe(1000);
    expect(boss.hp).toBe(bossHp);
    expect(
      ctx.events.filter(
        (e) => e.type === 'damage' && e.targetId === edge.id && e.dtype === 'physical',
      ),
    ).toHaveLength(1);
  });

  it('restores the committed paw point through a checkpoint and reproduces the impact after a target dodges', () => {
    const { sim, boss, target, ctx, step, add } = fixture();
    step(0);
    const originalPoint = boss.pendingAttack!.voidmaulSlam!.point;
    const plan = structuredClone(boss.pendingAttack!.voidmaulSlam!);
    const nearby = add(plan.point);
    step(0.8);
    sim.time = ctx.time;
    const checkpoint = structuredClone(sim.snapshot());
    const finish = () => {
      const liveBoss = ctx.units.get(boss.id)!;
      const liveTarget = ctx.units.get(target.id)!;
      liveTarget.pos = offset(plan.point, heading(plan.point, 0), 15);
      liveBoss.pos = offset(liveBoss.pos, heading(liveBoss.pos, 0), 0.2);
      step(VOIDMAUL_SLAM_WINDUP_S);
      return {
        targetHp: liveTarget.hp,
        nearbyHp: ctx.units.get(nearby.id)!.hp,
        events: ctx.events.filter((e) => e.type === 'voidmaul_slam' || e.type === 'damage'),
      };
    };
    const uninterrupted = finish();
    sim.restore(checkpoint);
    ctx.events.length = 0;
    ctx.dead.clear();
    ctx.killers.clear();
    const restored = ctx.units.get(boss.id)!.pendingAttack!.voidmaulSlam!;
    expect(restored).toEqual(plan);
    expect(restored.point).not.toBe(originalPoint);
    expect(finish()).toEqual(uninterrupted);
    expect(uninterrupted.targetHp).toBe(1000);
    expect(uninterrupted.nearbyHp).toBe(928.5);
    expect(uninterrupted.events.filter((e) => e.type === 'voidmaul_slam')).toHaveLength(1);
  });

  it.each(['move', 'stun', 'dead target', 'untargetable target'] as const)(
    'cancels an interrupted windup (%s) without damage or an impact event',
    (reason) => {
      const { boss, target, ctx, step, add } = fixture();
      const nearby = add(voidmaulSlamPoint(boss, target.pos));
      step(0);
      if (reason === 'move') {
        boss.path = [{ x: 70, z: 75 }];
        boss.attackTargetId = null;
      } else if (reason === 'stun') {
        boss.statuses.push({ kind: 'stun', until: 3 });
      } else if (reason === 'dead target') {
        target.dead = true;
      } else {
        target.statuses.push({ kind: 'untargetable', until: 3 });
      }
      step(0.2);
      step(VOIDMAUL_SLAM_WINDUP_S);
      expect(target.hp).toBe(1000);
      expect(nearby.hp).toBe(1000);
      expect(ctx.events.filter((e) => e.type === 'voidmaul_slam')).toHaveLength(0);
      expect(boss.pendingAttack).toBeNull();
    },
  );

  it('uses the normal armor and shield pipeline and records only one death per victim', () => {
    const { boss, target, ctx, step, add } = fixture();
    target.stats.armor = 100;
    target.statuses.push({ kind: 'shield', until: 3, remaining: 20 });
    const frail = add(voidmaulSlamPoint(boss, target.pos));
    frail.hp = 1;
    step(0);
    step(VOIDMAUL_SLAM_WINDUP_S);
    expect(target.hp).toBe(960);
    expect(frail.hp).toBe(0);
    expect(ctx.dead.has(frail.id)).toBe(true);
    expect(ctx.killers.get(frail.id)).toBe(boss.id);
    expect(ctx.events.filter((e) => e.type === 'death' && e.unitId === frail.id)).toHaveLength(1);
  });

  it('grows the Ascendant disk and paw displacement while keeping the impact on spherical ground', () => {
    const regular = fixture();
    const ascendant = fixture('voidmaul', true);
    const point = voidmaulSlamPoint(regular.boss, regular.target.pos);
    const larger = voidmaulSlamPoint(ascendant.boss, ascendant.target.pos);
    expect(dist(ascendant.boss.pos, larger)).toBeCloseTo(
      dist(regular.boss.pos, point) * VOIDMAUL_SLAM.ascendantScale,
      10,
    );
    ascendant.step(0);
    expect(ascendant.boss.pendingAttack!.voidmaulSlam!.radius).toBe(7.25);
    const sphere = fixture('voidmaul', false, true);
    const spherePoint = voidmaulSlamPoint(sphere.boss, sphere.target.pos);
    expect(offGround(spherePoint)).toBeNull();
    const victim = sphere.add(offset(spherePoint, dirTo(spherePoint, sphere.boss.pos)!, 1));
    sphere.step(0);
    sphere.step(VOIDMAUL_SLAM_WINDUP_S);
    const event = sphere.ctx.events.find((e) => e.type === 'voidmaul_slam');
    expect(event).toMatchObject(spherePoint);
    expect(victim.hp).toBe(928.5);
  });

  it('keeps the Pyrefang attack single-target and leaves its event and windup unchanged', () => {
    const { boss, target, ctx, step, add } = fixture('pyrefang');
    const nearby = add(target.pos);
    step(0);
    expect(boss.pendingAttack?.resolveAt).toBe(0.15);
    expect(boss.pendingAttack).not.toHaveProperty('voidmaulSlam');
    step(0.15);
    expect(target.hp).toBe(890);
    expect(nearby.hp).toBe(1000);
    expect(ctx.events.filter((e) => e.type === 'voidmaul_slam')).toHaveLength(0);
  });
});
