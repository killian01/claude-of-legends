// A committed ground slam resolves on one fixed disk. It uses the ordinary
// damage pipeline, preserving mitigation, shields, death and kill credit.
import { VOIDMAUL_SLAM } from '../content/voidmaul_slam';
import { addScaled, copy, dirTo, heading, norm, offset, scale, turnRight, within } from '../geo';
import type { CombatCtx } from '../sim_context';
import type { Vec2 } from '../types';
import { hostile, type Unit } from '../unit';
import { dealDamage } from './damage';
import { isUntargetable } from './status';

export interface VoidmaulSlamEvent {
  type: 'voidmaul_slam';
  unitId: number;
  targetId: number;
  x: number;
  z: number;
  y?: number;
  radius: number;
  at: number;
}

export interface VoidmaulSlamPlan {
  point: Vec2;
  radius: number;
}

export function voidmaulSlamPoint(attacker: Pick<Unit, 'pos' | 'ascendant'>, target: Vec2): Vec2 {
  const forward = dirTo(attacker.pos, target) ?? heading(attacker.pos, Math.PI / 2);
  const right = turnRight(forward, attacker.pos);
  const size = attacker.ascendant ? VOIDMAUL_SLAM.ascendantScale : 1;
  const travel = addScaled(
    scale(forward, VOIDMAUL_SLAM.pawForward * size),
    right,
    VOIDMAUL_SLAM.pawSide * size,
  );
  const distance = norm(travel);
  return offset(attacker.pos, scale(travel, 1 / distance), distance);
}

export function prepareVoidmaulSlam(u: Unit, target: Unit): VoidmaulSlamPlan | undefined {
  if (u.kind !== 'creature' || u.creatureId !== 'voidmaul') return;
  return {
    point: voidmaulSlamPoint(u, target.pos),
    radius: u.ascendant ? VOIDMAUL_SLAM.ascendantRadius : VOIDMAUL_SLAM.radius,
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
  });
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
