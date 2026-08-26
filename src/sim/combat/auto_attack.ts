// Auto-attacks: a unit with an attack order chases its target until in edge
// range, then fires on its attack speed cadence. Ranged units fire a homing
// bolt (like the genre, it cannot be dodged); melee units strike directly.
// Taunts force the attack order; stuns pause everything; firing breaks
// stealth.

import type { NavGrid } from '../navgrid';
import { findPath } from '../pathfind';
import type { CombatCtx } from '../sim_context';
import type { Unit } from '../unit';
import { dealDamage } from './damage';
import { attackSpeedBonusPct, breakStealth, isStealthed, isStunned, tauntSourceId } from './status';

const RANGED_THRESHOLD = 2;
const BOLT_SPEED = 30;
const REPATH_DISTANCE = 2;

function fire(ctx: CombatCtx, u: Unit, target: Unit): void {
  breakStealth(u);
  if (u.stats.attackRange > RANGED_THRESHOLD) {
    const id = ctx.allocId();
    ctx.projectiles.set(id, {
      id,
      sourceId: u.id,
      team: u.team,
      pos: { x: u.pos.x, z: u.pos.z },
      dir: { x: 0, z: 0 },
      speed: BOLT_SPEED,
      radius: 0.35,
      maxRange: Number.POSITIVE_INFINITY,
      traveled: 0,
      homingTargetId: target.id,
      pierce: false,
      hitIds: new Set(),
      power: { ad: u.stats.ad, ap: u.stats.ap },
      onHit: [{ kind: 'damage', base: 0, adRatio: 1, dtype: 'physical' }],
      allyEffects: [],
    });
  } else {
    dealDamage(ctx, u.id, target, u.stats.ad, 'physical');
  }
  const cadence = Math.max(0.1, u.stats.attackSpeed * (1 + attackSpeedBonusPct(u, ctx.time)));
  u.attackReadyAt = ctx.time + 1 / cadence;
}

export function stepAutoAttacks(ctx: CombatCtx, nav: NavGrid): void {
  for (const u of ctx.units.values()) {
    if (ctx.dead.has(u.id) || u.dead) continue;
    if (isStunned(u, ctx.time)) continue;

    // A taunt overrides any order.
    const tauntId = tauntSourceId(u, ctx.time);
    if (tauntId !== null) {
      const source = ctx.units.get(tauntId);
      if (source && !source.dead && source.team !== u.team) u.attackTargetId = tauntId;
    }

    if (u.attackTargetId === null) continue;
    const target = ctx.units.get(u.attackTargetId);
    if (
      !target ||
      target.dead ||
      ctx.dead.has(target.id) ||
      target.team === u.team ||
      isStealthed(target, ctx.time)
    ) {
      u.attackTargetId = null;
      continue;
    }
    const edgeDist =
      Math.hypot(target.pos.x - u.pos.x, target.pos.z - u.pos.z) - u.radius - target.radius;
    if (edgeDist > u.stats.attackRange) {
      if (u.moveSpeed <= 0) continue;
      const end = u.path[u.path.length - 1];
      if (!end || Math.hypot(end.x - target.pos.x, end.z - target.pos.z) > REPATH_DISTANCE) {
        u.path = findPath(nav, u.pos, target.pos);
      }
    } else {
      u.path = [];
      if (u.stats.attackSpeed > 0 && ctx.time >= u.attackReadyAt) fire(ctx, u, target);
    }
  }
}
