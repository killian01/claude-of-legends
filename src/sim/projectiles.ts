// Projectiles in flight: linear skillshots (optionally piercing, optionally
// affecting allies they pass through) and homing auto-attack bolts. Hit tests
// use point-to-segment distance so fast projectiles cannot tunnel through a
// unit between two ticks.

import { applyEffects, type EffectSpec, type Power } from './combat/effects';
import { isStealthed, isUntargetable } from './combat/status';
import type { DamageVia } from './passive_types';
import { passiveOf, runItemAttackHits } from './passives';
import type { CombatCtx } from './sim_context';
import type { TeamId, Vec2 } from './types';
import type { Unit } from './unit';
import { createWallSegment } from './walls';

export interface Projectile {
  id: number;
  sourceId: number;
  team: TeamId;
  pos: Vec2;
  dir: Vec2;
  speed: number;
  radius: number;
  maxRange: number;
  traveled: number;
  homingTargetId: number | null;
  pierce: boolean;
  // Units already affected by this projectile (piercing hits once per unit).
  hitIds: Set<number>;
  power: Power;
  onHit: readonly EffectSpec[];
  allyEffects: readonly EffectSpec[];
  // One jump to the nearest other enemy near the victim (kits-v2 chain).
  chain: { radius: number; onHit: readonly EffectSpec[] } | null;
  // The traveled line persists as a fissure when the bolt dies at max range.
  leaveWall: { duration: number } | null;
  // Splash around the struck target (empowered auto riders on ranged bolts).
  splashOnHit: { radius: number; effects: readonly EffectSpec[] } | null;
  // 'attack' for auto-attack bolts (feeds on-hit passives); default 'ability'.
  via?: DamageVia;
  // Cosmetic source tag: 'championId_KEY' for abilities, 'sigil_id' for
  // sigils, 'championId_A' for champion auto bolts, null for minion and
  // tower bolts. Renderers pick per-source visuals from it; never gameplay.
  vfx: string | null;
}

function applySplash(ctx: CombatCtx, p: Projectile, around: Unit): void {
  if (!p.splashOnHit) return;
  for (const u of ctx.units.values()) {
    if ((!u.neutral && u.team === p.team) || u.dead || ctx.dead.has(u.id)) continue;
    if (u.id === around.id) continue;
    if (Math.hypot(u.pos.x - around.pos.x, u.pos.z - around.pos.z) > p.splashOnHit.radius) continue;
    applyEffects(ctx, p.sourceId, p.power, u, p.splashOnHit.effects);
  }
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = 0;
  if (len2 > 0) t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  const cx = a.x + abx * t;
  const cz = a.z + abz * t;
  return Math.hypot(p.x - cx, p.z - cz);
}

export function stepProjectiles(ctx: CombatCtx, dt: number): void {
  for (const p of [...ctx.projectiles.values()]) {
    const from = { x: p.pos.x, z: p.pos.z };

    if (p.homingTargetId !== null) {
      const target = ctx.units.get(p.homingTargetId);
      if (!target || target.dead || ctx.dead.has(target.id)) {
        ctx.projectiles.delete(p.id);
        continue;
      }
      const dx = target.pos.x - p.pos.x;
      const dz = target.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const step = p.speed * dt;
      if (d <= step + p.radius + target.radius) {
        const via = p.via ?? 'ability';
        applyEffects(ctx, p.sourceId, p.power, target, p.onHit, via);
        applySplash(ctx, p, target);
        if (via === 'attack') {
          const source = ctx.units.get(p.sourceId);
          if (source && !source.dead) {
            passiveOf(source)?.onAttackHit?.(ctx, source, target);
            runItemAttackHits(ctx, source, target);
          }
        }
        ctx.projectiles.delete(p.id);
        continue;
      }
      p.pos.x += (dx / d) * step;
      p.pos.z += (dz / d) * step;
      continue;
    }

    const step = Math.min(p.speed * dt, Math.max(0, p.maxRange - p.traveled));
    p.pos.x += p.dir.x * step;
    p.pos.z += p.dir.z * step;
    p.traveled += step;

    // Enemies crossed this step, nearest-first for determinism. Neutral
    // units (the Warden) block and take skillshots from both teams.
    const crossed: { u: Unit; d: number }[] = [];
    for (const u of ctx.units.values()) {
      if ((!u.neutral && u.team === p.team) || u.dead || ctx.dead.has(u.id)) continue;
      if (p.hitIds.has(u.id) || u.id === p.sourceId) continue;
      if (segmentDistance(u.pos, from, p.pos) > p.radius + u.radius) continue;
      crossed.push({ u, d: Math.hypot(u.pos.x - from.x, u.pos.z - from.z) });
    }
    crossed.sort((a, b) => a.d - b.d || a.u.id - b.u.id);

    // Where this bolt left its caster; distance to a victim is an effect
    // fact (kits-v2 distance conditionals), the line feeds knock-asides.
    const origin = { x: p.pos.x - p.dir.x * p.traveled, z: p.pos.z - p.dir.z * p.traveled };

    let despawned = false;
    for (const { u } of crossed) {
      p.hitIds.add(u.id);
      applyEffects(ctx, p.sourceId, p.power, u, p.onHit, p.via ?? 'ability', {
        distance: Math.hypot(u.pos.x - origin.x, u.pos.z - origin.z),
        lineFrom: origin,
        lineDir: p.dir,
      });
      if (!p.pierce) {
        // A chain bolt jumps once instead of dying: it homes to the nearest
        // other valid enemy near the victim, carrying its chain payload.
        if (p.chain) {
          let next: Unit | null = null;
          let bestD = Number.POSITIVE_INFINITY;
          for (const c of ctx.units.values()) {
            if ((!c.neutral && c.team === p.team) || c.dead || ctx.dead.has(c.id)) continue;
            if (p.hitIds.has(c.id) || c.id === p.sourceId) continue;
            if (isStealthed(c, ctx.time) || isUntargetable(c, ctx.time)) continue;
            const cd = Math.hypot(c.pos.x - u.pos.x, c.pos.z - u.pos.z);
            if (cd > p.chain.radius || cd >= bestD) continue;
            bestD = cd;
            next = c;
          }
          if (next) {
            p.pos = { x: u.pos.x, z: u.pos.z };
            p.homingTargetId = next.id;
            p.onHit = p.chain.onHit;
            p.chain = null;
            p.leaveWall = null;
            despawned = false;
            break;
          }
        }
        ctx.projectiles.delete(p.id);
        despawned = true;
        break;
      }
    }
    if (despawned) continue;
    if (p.homingTargetId !== null) continue;

    // Piercing waves can also carry effects for allies they pass through.
    if (p.allyEffects.length > 0) {
      for (const u of ctx.units.values()) {
        if (u.team !== p.team || u.id === p.sourceId || u.dead || ctx.dead.has(u.id)) continue;
        if (u.kind !== 'champion' && u.kind !== 'minion') continue;
        if (p.hitIds.has(u.id)) continue;
        if (segmentDistance(u.pos, from, p.pos) > p.radius + u.radius) continue;
        p.hitIds.add(u.id);
        applyEffects(ctx, p.sourceId, p.power, u, p.allyEffects);
      }
    }

    if (p.traveled >= p.maxRange - 1e-9) {
      // A fissure bolt dies into terrain: the traveled line becomes an
      // impassable wall for a few seconds (Torv's Faultline).
      if (p.leaveWall) {
        createWallSegment(ctx, p.sourceId, p.team, origin, p.pos, p.leaveWall.duration);
      }
      ctx.projectiles.delete(p.id);
    }
  }
}
