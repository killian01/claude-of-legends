// Ground zones: damage-over-time fields, entry triggers, delayed
// detonations, and ally-affecting fields (heals). Enemy effects target the
// zone owner's enemies; allyOnTick targets its allies. A zone is a disc of
// the ground it stands on, the plane's or the planet's (geo.ts).

import { applyEffects, type EffectSpec, type Power } from './combat/effects';
import { copy, dist } from './geo';
import type { CombatCtx } from './sim_context';
import { isSpellTarget } from './spell_targets';
import { stepTrap, type TrapState } from './traps';
import type { TeamId, Vec2 } from './types';
import type { Unit } from './unit';

export interface Zone {
  id: number;
  sourceId: number;
  team: TeamId;
  pos: Vec2;
  radius: number;
  until: number;
  tickEvery: number;
  nextTickAt: number;
  power: Power;
  onEnter: readonly EffectSpec[];
  onTick: readonly EffectSpec[];
  allyOnTick: readonly EffectSpec[];
  detonateAt: number | null;
  onDetonate: readonly EffectSpec[];
  entered: Set<number>;
  // Team sight over the zone's area, brush and stealth included (kits-v2).
  reveal: boolean;
  // Rim punishment for enemies walking out; dashes and blinks pass free.
  boundary: { effects: readonly EffectSpec[]; perUnitEvery: number } | null;
  boundaryNextAt: Map<number, number>;
  // Enemy ids inside last tick, for boundary-crossing detection.
  insideIds: Set<number>;
  // A field left behind at detonation (per-rank upgrades).
  leaveZone: {
    radius: number;
    duration: number;
    tickEvery?: number;
    onTick?: readonly EffectSpec[];
  } | null;
  // Cosmetic source tag ('championId_KEY' or 'sigil_id'). Renderers pick
  // per-ability visuals from it; never gameplay.
  vfx: string | null;
  // A hidden pod (traps.ts): it ticks by its own rule, bursts into its
  // field when an enemy champion steps on it, and is seen only as
  // trapSeen says (an enemy only under its own reveal zone). Absent on
  // every other zone.
  trap?: TrapState;
}

function unitsInside(ctx: CombatCtx, z: Zone, enemies: boolean): Unit[] {
  const out: Unit[] = [];
  for (const u of ctx.units.values()) {
    if (u.dead || ctx.dead.has(u.id) || !isSpellTarget(u)) continue;
    // Neutral units count as enemies for zones and never as allies.
    if (enemies ? !u.neutral && u.team === z.team : u.neutral || u.team !== z.team) continue;
    if (dist(u.pos, z.pos) <= z.radius + u.radius) out.push(u);
  }
  return out;
}

// A unit only this much beyond the rim "walked out"; a blink or long dash
// lands far past the shell and escapes the boundary punishment clean.
const BOUNDARY_SHELL = 1.2;

export function stepZones(ctx: CombatCtx): void {
  for (const z of [...ctx.zones.values()]) {
    if (z.trap) {
      stepTrap(ctx, z);
      continue;
    }
    const inside = unitsInside(ctx, z, true);

    if (z.onEnter.length > 0) {
      for (const u of inside) {
        if (!z.entered.has(u.id)) {
          z.entered.add(u.id);
          applyEffects(ctx, z.sourceId, z.power, u, z.onEnter);
        }
      }
    }

    // Boundary punishment: an enemy inside last tick, now just past the
    // rim on foot, is punished (throwback, damage...) at most once per
    // perUnitEvery seconds. Dashing or blinking clean past the shell, or
    // crossing while the per-unit clock runs, walks free.
    if (z.boundary) {
      const insideNow = new Set(inside.map((u) => u.id));
      for (const id of z.insideIds) {
        if (insideNow.has(id)) continue;
        const u = ctx.units.get(id);
        if (!u || u.dead || ctx.dead.has(id) || u.activeDash) continue;
        const d = dist(u.pos, z.pos);
        if (d - u.radius > z.radius + BOUNDARY_SHELL) continue;
        if ((z.boundaryNextAt.get(id) ?? 0) > ctx.time) continue;
        z.boundaryNextAt.set(id, ctx.time + z.boundary.perUnitEvery);
        applyEffects(ctx, z.sourceId, z.power, u, z.boundary.effects, 'ability', {
          center: z.pos,
        });
      }
      z.insideIds = insideNow;
    }

    if (ctx.time >= z.nextTickAt && (z.onTick.length > 0 || z.allyOnTick.length > 0)) {
      for (const u of inside) {
        applyEffects(ctx, z.sourceId, z.power, u, z.onTick, 'ability', { center: z.pos });
      }
      if (z.allyOnTick.length > 0) {
        for (const u of unitsInside(ctx, z, false)) {
          applyEffects(ctx, z.sourceId, z.power, u, z.allyOnTick, 'ability', { center: z.pos });
        }
      }
      z.nextTickAt += z.tickEvery;
    }

    if (z.detonateAt !== null && ctx.time >= z.detonateAt) {
      for (const u of inside) {
        applyEffects(ctx, z.sourceId, z.power, u, z.onDetonate, 'ability', { center: z.pos });
      }
      // The detonation can leave a lingering field behind (rank upgrades).
      if (z.leaveZone) {
        const tickEvery = z.leaveZone.tickEvery ?? 0.5;
        const id = ctx.allocId();
        ctx.zones.set(id, {
          id,
          sourceId: z.sourceId,
          team: z.team,
          pos: copy(z.pos),
          radius: z.leaveZone.radius,
          until: ctx.time + z.leaveZone.duration,
          tickEvery,
          nextTickAt: ctx.time + tickEvery,
          power: z.power,
          onEnter: [],
          onTick: z.leaveZone.onTick ?? [],
          allyOnTick: [],
          detonateAt: null,
          onDetonate: [],
          entered: new Set(),
          reveal: false,
          boundary: null,
          boundaryNextAt: new Map(),
          insideIds: new Set(),
          leaveZone: null,
          vfx: z.vfx,
        });
      }
      ctx.zones.delete(z.id);
      continue;
    }

    if (ctx.time >= z.until) ctx.zones.delete(z.id);
  }
}
