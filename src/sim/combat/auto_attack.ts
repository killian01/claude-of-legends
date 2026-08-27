// Auto-attacks: a unit with an attack order chases its target until in edge
// range, then strikes on its attack speed cadence. Every strike WINDS UP
// first: the attack event fires (the swing starts), and the hit lands a
// beat later. Moving, a stun, or losing the target during the windup
// cancels the strike and refunds the attack timer, so kiting is a timed
// skill (orb-walking) instead of a free action. Ranged units then fire a
// homing bolt (like the genre, it cannot be dodged once loosed); melee
// units strike directly. Taunts force the attack order; firing breaks
// stealth at the start of the windup.

import type { NavGrid } from '../navgrid';
import { passiveOf, runItemAttackHits } from '../passives';
import { findPath } from '../pathfind';
import type { CombatCtx } from '../sim_context';
import { hostile, type Unit } from '../unit';
import { dealDamage } from './damage';
import {
  attackSpeedBonusPct,
  breakStealth,
  isStealthed,
  isStunned,
  isUntargetable,
  tauntSourceId,
} from './status';

// Exported for presentation: the renderer schedules a melee contact spark
// only for attackers below this range (ranged autos flash at bolt impact).
export const RANGED_THRESHOLD = 2;
const BOLT_SPEED = 30;
const REPATH_DISTANCE = 2;

// The windup is a fixed fraction of the attack period, capped so fast
// attackers stay snappy. Champions carry the full beat (the orb-walk
// counterplay lives there); minions and structures get a light one, enough
// for the swing to read without dragging the lane war and the 20-25 minute
// pacing target. Shared with the renderer so the contact spark lands on the
// same beat as the damage.
export const ATTACK_WINDUP_FRACTION = 0.3;
export const ATTACK_WINDUP_MAX = 0.35;
const SWARM_WINDUP_FRACTION = 0.15;
const SWARM_WINDUP_MAX = 0.15;
export function attackWindupSeconds(cadence: number, champion = true): number {
  const fraction = champion ? ATTACK_WINDUP_FRACTION : SWARM_WINDUP_FRACTION;
  const max = champion ? ATTACK_WINDUP_MAX : SWARM_WINDUP_MAX;
  return Math.min(max, fraction / Math.max(0.1, cadence));
}

// A dash (or any scripted displacement) beyond this distance mid-windup
// cancels the strike; minion separation drift stays well below it.
const DISPLACEMENT_CANCEL = 0.8;

// A committed strike still lands on a target that WALKED away (walking
// covers well under this in one windup), but whiffs when the target blinks
// or dashes out of reach. The burned attack timer is the blink's reward.
const STRIKE_GRACE = 2;

// Tower heat (dive punish): each consecutive tower shot at a CHAMPION hits
// harder, like the genre, so diving past shot two is a commitment. Towers
// reuse the generic passiveStacks counter as their heat; tower_ai resets it
// on every target change.
export const TOWER_RAMP_PER_HIT = 0.35;
export const TOWER_RAMP_CAP = 4;

// The strike is announced and the attack timer starts here; the hit itself
// lands in strike() when the windup resolves.
function beginWindup(ctx: CombatCtx, u: Unit, target: Unit): void {
  breakStealth(u);
  // Presentation hook: renderers play a swing animation off this event.
  ctx.events.push({ type: 'attack', unitId: u.id, targetId: target.id });
  const cadence = Math.max(0.1, u.stats.attackSpeed * (1 + attackSpeedBonusPct(u, ctx.time)));
  u.attackReadyAt = ctx.time + 1 / cadence;
  u.pendingAttack = {
    targetId: target.id,
    resolveAt: ctx.time + attackWindupSeconds(cadence, u.kind === 'champion'),
    startX: u.pos.x,
    startZ: u.pos.z,
  };
}

function strike(ctx: CombatCtx, u: Unit, target: Unit): void {
  let ad = u.stats.ad;
  if (u.kind === 'tower' && target.kind === 'champion') {
    ad *= 1 + TOWER_RAMP_PER_HIT * Math.min(u.passiveStacks, TOWER_RAMP_CAP);
    u.passiveStacks += 1;
  }
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
      power: { ad, ap: u.stats.ap },
      onHit: [{ kind: 'damage', base: 0, adRatio: 1, dtype: 'physical' }],
      allyEffects: [],
      via: 'attack',
      // Champion bolts carry a cosmetic auto tag ('vesk_A') so renderers
      // can author per-champion tracers; minion and tower bolts stay null.
      vfx: u.kind === 'champion' && u.championId ? `${u.championId}_A` : null,
    });
  } else {
    dealDamage(ctx, u.id, target, ad, 'physical', 'attack');
    passiveOf(u)?.onAttackHit?.(ctx, u, target);
    runItemAttackHits(ctx, u, target);
  }
}

// Windup upkeep, run for every unit before orders: cancel on stun, on an
// issued move path, on a scripted displacement (dash), or on the target
// becoming invalid; a canceled strike refunds the attack timer. Resolve
// when the beat arrives. The strike lands even if the target has walked
// out of range: the windup itself was the commitment.
function stepPendingAttack(ctx: CombatCtx, u: Unit): void {
  const pa = u.pendingAttack;
  if (!pa) return;
  const target = ctx.units.get(pa.targetId);
  // Displacement cancel is a champion rule (dashes, blinks): minions only
  // ever displace through separation drift, which must not eat their swings
  // in a packed wave.
  const displaced =
    u.kind === 'champion' &&
    Math.hypot(u.pos.x - pa.startX, u.pos.z - pa.startZ) > DISPLACEMENT_CANCEL;
  const canceled =
    isStunned(u, ctx.time) ||
    u.path.length > 0 ||
    displaced ||
    !target ||
    target.dead ||
    ctx.dead.has(target.id) ||
    isStealthed(target, ctx.time) ||
    isUntargetable(target, ctx.time);
  if (canceled) {
    u.pendingAttack = null;
    u.attackReadyAt = ctx.time;
    return;
  }
  if (ctx.time >= pa.resolveAt) {
    u.pendingAttack = null;
    const edge =
      Math.hypot(target.pos.x - u.pos.x, target.pos.z - u.pos.z) - u.radius - target.radius;
    if (edge <= u.stats.attackRange + STRIKE_GRACE) strike(ctx, u, target);
  }
}

export function stepAutoAttacks(ctx: CombatCtx, nav: NavGrid): void {
  for (const u of ctx.units.values()) {
    if (ctx.dead.has(u.id) || u.dead) continue;
    stepPendingAttack(ctx, u);
    // Mid-windup the unit is committed: it neither chases nor re-paths (a
    // self-issued chase path would cancel its own strike). Only an external
    // order, a stun, or a displacement interrupts the swing.
    if (u.pendingAttack) continue;
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
      !hostile(u, target) ||
      isStealthed(target, ctx.time) ||
      isUntargetable(target, ctx.time)
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
      if (u.stats.attackSpeed > 0 && ctx.time >= u.attackReadyAt && !u.pendingAttack) {
        beginWindup(ctx, u, target);
      }
    }
  }
}
