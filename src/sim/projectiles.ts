// Projectiles in flight: linear skillshots (optionally piercing, optionally
// affecting allies they pass through) and homing auto-attack bolts. Hit tests
// use point-to-segment distance so fast projectiles cannot tunnel through a
// unit between two ticks. On the planet a skillshot flies its great circle:
// its heading is advanced with it every step (geo.ts, ADR 0029).

import { applyEffects, type EffectSpec, type Power } from './combat/effects';
import { isStealthed, isUntargetable } from './combat/status';
import { advance, along, carry, copy, dist, offset, segmentDist, stepToward } from './geo';
import type { DamageVia } from './passive_types';
import { passiveOf, runItemAttackHits } from './passives';
import type { CombatCtx } from './sim_context';
import { isSpellTarget } from './spell_targets';
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
  // The traveled line erupts a second time: delayed-detonation zones seeded
  // along the path when the bolt dies at max range (Torv's Faultline).
  aftershock: {
    delay: number;
    radius: number;
    spacing: number;
    effects: readonly EffectSpec[];
  } | null;
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
    if (u.id === around.id || !isSpellTarget(u)) continue;
    if (dist(u.pos, around.pos) > p.splashOnHit.radius) continue;
    applyEffects(ctx, p.sourceId, p.power, u, p.splashOnHit.effects);
  }
}

export function stepProjectiles(ctx: CombatCtx, dt: number): void {
  for (const p of [...ctx.projectiles.values()]) {
    const from = copy(p.pos);

    if (p.homingTargetId !== null) {
      const target = ctx.units.get(p.homingTargetId);
      if (!target || target.dead || ctx.dead.has(target.id)) {
        ctx.projectiles.delete(p.id);
        continue;
      }
      const d = dist(p.pos, target.pos);
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
      stepToward(p.pos, target.pos, step);
      continue;
    }

    const step = Math.min(p.speed * dt, Math.max(0, p.maxRange - p.traveled));
    advance(p.pos, p.dir, step);
    p.traveled += step;

    // Enemies crossed this step, nearest-first for determinism. Neutral
    // units (the Warden) block and take skillshots from both teams.
    const crossed: { u: Unit; d: number }[] = [];
    const spellBolt = (p.via ?? 'ability') !== 'attack';
    for (const u of ctx.units.values()) {
      if ((!u.neutral && u.team === p.team) || u.dead || ctx.dead.has(u.id)) continue;
      // A spell bolt flies OVER structures: it is neither eaten nor blocked
      // by a tower standing on its line.
      if (spellBolt && !isSpellTarget(u)) continue;
      if (p.hitIds.has(u.id) || u.id === p.sourceId) continue;
      if (segmentDist(u.pos, from, p.pos).d > p.radius + u.radius) continue;
      crossed.push({ u, d: dist(u.pos, from) });
    }
    crossed.sort((a, b) => a.d - b.d || a.u.id - b.u.id);

    // Where this bolt left its caster; distance to a victim is an effect
    // fact (kits-v2 distance conditionals), the line feeds knock-asides.
    // The heading there is the one at the bolt carried back (itself on the
    // plane).
    const origin = offset(p.pos, p.dir, -p.traveled);
    const originDir = carry(p.dir, p.pos, origin);

    let despawned = false;
    for (const { u } of crossed) {
      p.hitIds.add(u.id);
      applyEffects(ctx, p.sourceId, p.power, u, p.onHit, p.via ?? 'ability', {
        distance: dist(u.pos, origin),
        lineFrom: origin,
        lineDir: originDir,
      });
      if (!p.pierce) {
        // A chain bolt jumps once instead of dying: it homes to the nearest
        // other valid enemy near the victim, carrying its chain payload.
        if (p.chain) {
          let next: Unit | null = null;
          let bestD = Number.POSITIVE_INFINITY;
          for (const c of ctx.units.values()) {
            if ((!c.neutral && c.team === p.team) || c.dead || ctx.dead.has(c.id)) continue;
            if (spellBolt && !isSpellTarget(c)) continue;
            if (p.hitIds.has(c.id) || c.id === p.sourceId) continue;
            if (isStealthed(c, ctx.time) || isUntargetable(c, ctx.time)) continue;
            const cd = dist(c.pos, u.pos);
            if (cd > p.chain.radius || cd >= bestD) continue;
            bestD = cd;
            next = c;
          }
          if (next) {
            p.pos = copy(u.pos);
            p.homingTargetId = next.id;
            p.onHit = p.chain.onHit;
            p.chain = null;
            p.leaveWall = null;
            p.aftershock = null;
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
        if (segmentDist(u.pos, from, p.pos).d > p.radius + u.radius) continue;
        p.hitIds.add(u.id);
        applyEffects(ctx, p.sourceId, p.power, u, p.allyEffects);
      }
    }

    if (p.traveled >= p.maxRange - 1e-9) {
      // A fissure bolt dies into terrain: the traveled line becomes an
      // impassable wall for a few seconds.
      if (p.leaveWall) {
        createWallSegment(ctx, p.sourceId, p.team, origin, p.pos, p.leaveWall.duration);
      }
      // The earth answers twice: telegraphed eruptions seeded along the
      // whole traveled line, each detonating after the declared delay.
      // Standing on the crack is the mistake (Torv's Faultline).
      if (p.aftershock) {
        const shock = p.aftershock;
        const count = Math.max(1, Math.round(p.traveled / shock.spacing));
        for (let i = 0; i <= count; i++) {
          const t = count === 0 ? 0 : i / count;
          const id = ctx.allocId();
          ctx.zones.set(id, {
            id,
            sourceId: p.sourceId,
            team: p.team,
            pos: along(origin, originDir, p.traveled, t),
            radius: shock.radius,
            until: ctx.time + shock.delay + 0.1,
            tickEvery: 0,
            nextTickAt: Number.POSITIVE_INFINITY,
            power: p.power,
            onEnter: [],
            onTick: [],
            allyOnTick: [],
            detonateAt: ctx.time + shock.delay,
            onDetonate: shock.effects,
            entered: new Set(),
            reveal: false,
            boundary: null,
            boundaryNextAt: new Map(),
            insideIds: new Set(),
            leaveZone: null,
            vfx: p.vfx,
          });
        }
      }
      ctx.projectiles.delete(p.id);
    }
  }
}
