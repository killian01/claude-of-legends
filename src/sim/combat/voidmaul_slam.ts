// A committed ground slam resolves on one fixed disk. It uses the ordinary
// damage pipeline, preserving mitigation, shields, death and kill credit.
import { VOIDMAUL_SLAM, type VoidmaulAttackKind } from '../content/voidmaul_slam';
import { addScaled, copy, dirTo, heading, norm, offset, scale, turnRight, within } from '../geo';
import type { CombatCtx } from '../sim_context';
import type { Vec2 } from '../types';
import { hostile, type Unit } from '../unit';
import { dealDamage } from './damage';
import { isUntargetable } from './status';
import { throwStones } from './voidmaul_stones';

export interface VoidmaulSlamEvent {
  type: 'voidmaul_slam';
  unitId: number;
  targetId: number;
  x: number;
  z: number;
  y?: number;
  radius: number;
  at: number;
  kind?: VoidmaulAttackKind;
  // A crush's two paws, the left then the right: its stones leave from
  // under each (combat/voidmaul_stones.ts).
  paws?: [Vec2, Vec2];
}

export interface VoidmaulSlamPlan {
  point: Vec2;
  radius: number;
  kind?: VoidmaulAttackKind;
  paws?: [Vec2, Vec2];
}

export function voidmaulSlamPoint(
  attacker: Pick<Unit, 'pos' | 'ascendant'>,
  target: Vec2,
  kind: VoidmaulAttackKind = 'slam',
): Vec2 {
  const forward = dirTo(attacker.pos, target) ?? heading(attacker.pos, Math.PI / 2);
  const right = turnRight(forward, attacker.pos);
  const size = attacker.ascendant ? VOIDMAUL_SLAM.ascendantScale : 1;
  const travel = addScaled(
    scale(
      forward,
      (kind === 'crush' ? VOIDMAUL_SLAM.crushPawForward : VOIDMAUL_SLAM.pawForward) * size,
    ),
    right,
    (kind === 'crush' ? VOIDMAUL_SLAM.crushPawSide : VOIDMAUL_SLAM.pawSide) * size,
  );
  const distance = norm(travel);
  return offset(attacker.pos, scale(travel, 1 / distance), distance);
}

// A crush lands both forepaws about its midpoint: the left one back by the
// measured half spread across and along the body, the right one ahead.
export function voidmaulCrushPaws(
  attacker: Pick<Unit, 'pos' | 'ascendant'>,
  target: Vec2,
  point: Vec2,
): [Vec2, Vec2] {
  const forward = dirTo(attacker.pos, target) ?? heading(attacker.pos, Math.PI / 2);
  const right = turnRight(forward, attacker.pos);
  const size = attacker.ascendant ? VOIDMAUL_SLAM.ascendantScale : 1;
  const spread = addScaled(
    scale(right, VOIDMAUL_SLAM.crushPawSpread * size),
    forward,
    VOIDMAUL_SLAM.crushPawSpreadForward * size,
  );
  const reach = norm(spread);
  return [
    offset(point, scale(spread, -1 / reach), reach),
    offset(point, scale(spread, 1 / reach), reach),
  ];
}

export function prepareVoidmaulSlam(u: Unit, target: Unit): VoidmaulSlamPlan | undefined {
  if (u.kind !== 'creature' || u.creatureId !== 'voidmaul') return;
  const kind = (u.voidmaulAttackCount ?? 0) % 2 === 0 ? 'slam' : 'crush';
  const point = voidmaulSlamPoint(u, target.pos, kind);
  return {
    point,
    radius: u.ascendant ? VOIDMAUL_SLAM.ascendantRadius : VOIDMAUL_SLAM.radius,
    kind,
    ...(kind === 'crush' ? { paws: voidmaulCrushPaws(u, target.pos, point) } : {}),
  };
}

export function resolveVoidmaulSlam(
  ctx: CombatCtx,
  u: Unit,
  targetId: number,
  plan: VoidmaulSlamPlan,
): void {
  const point = copy(plan.point);
  ctx.events.push({
    type: 'voidmaul_slam',
    unitId: u.id,
    targetId,
    ...point,
    radius: plan.radius,
    at: ctx.time,
    kind: plan.kind ?? 'slam',
    ...(plan.paws ? { paws: [copy(plan.paws[0]), copy(plan.paws[1])] } : {}),
  });
  // Only a completed contact advances the authored sequence. Canceled
  // windups retry the same choice, and a ground hit still counts if dodged.
  u.voidmaulAttackCount = (u.voidmaulAttackCount ?? 0) + 1;
  // The broken rock flies across the ring and lands over the next seconds,
  // from under each paw of a crush.
  throwStones(ctx, u, point, plan.radius, plan.paws);
  const hit = new Set<number>();
  for (const other of ctx.units.values()) {
    if (
      hit.has(other.id) ||
      !hostile(u, other) ||
      other.dead ||
      ctx.dead.has(other.id) ||
      isUntargetable(other, ctx.time) ||
      !within(point, other.pos, plan.radius + other.radius)
    ) {
      continue;
    }
    hit.add(other.id);
    const ratio = other.id === targetId ? 1 : VOIDMAUL_SLAM.splashRatio;
    dealDamage(ctx, u.id, other, u.stats.ad * ratio, 'physical', 'attack');
    if (u.bitePct > 0 && other.kind === 'champion') {
      dealDamage(ctx, u.id, other, u.bitePct * other.maxHp * ratio, 'true', 'attack');
    }
  }
}
