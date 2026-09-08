// Traveling dashes (kits-v2): a dash declared with a speed is a real
// flight, not a teleport. The unit is committed and visibly on its line
// every tick, terrain and ability walls stop it early, enemies crossed by a
// pass-through dash are struck en route, and the landing payload resolves
// where the flight actually ends, with the traveled distance as an effect
// fact. Dashes declared without a speed keep the legacy instant blink.

import { applyEffects, type EffectSpec, type Power } from './combat/effects';
import { hypot } from './exact';
import type { CombatCtx } from './sim_context';
import { isSpellTarget } from './spell_targets';
import type { Vec2 } from './types';
import { hostile, type Unit } from './unit';

export interface DashState {
  from: Vec2;
  dir: Vec2;
  speed: number;
  remaining: number;
  traveled: number;
  landRadius: number;
  onLand: readonly EffectSpec[];
  selfEffects: readonly EffectSpec[];
  passThrough: readonly EffectSpec[];
  hitIds: Set<number>;
  power: Power;
  vfx: string | null;
}

const SAMPLE_STEP = 0.3;

function land(ctx: CombatCtx, u: Unit, dash: DashState): void {
  u.activeDash = null;
  u.path = [];
  const fx = {
    center: { x: u.pos.x, z: u.pos.z },
    distance: dash.traveled,
    lineFrom: dash.from,
    lineDir: dash.dir,
  };
  if (dash.onLand.length > 0 && dash.landRadius > 0) {
    for (const other of ctx.units.values()) {
      if (!hostile(u, other) || other.dead || ctx.dead.has(other.id)) continue;
      if (!isSpellTarget(other)) continue;
      const d = hypot(other.pos.x - u.pos.x, other.pos.z - u.pos.z);
      if (d > dash.landRadius + other.radius) continue;
      applyEffects(ctx, u.id, dash.power, other, dash.onLand, 'ability', fx);
    }
  }
  if (dash.selfEffects.length > 0) {
    applyEffects(ctx, u.id, dash.power, u, dash.selfEffects, 'ability', fx);
  }
}

export function stepDashes(ctx: CombatCtx, dt: number): void {
  for (const u of ctx.units.values()) {
    const dash = u.activeDash;
    if (!dash) continue;
    if (u.dead || ctx.dead.has(u.id)) {
      u.activeDash = null;
      continue;
    }
    const budget = Math.min(dash.speed * dt, dash.remaining);
    const from = { x: u.pos.x, z: u.pos.z };
    // Advance in small samples so a wall raised mid-flight stops the dash
    // at its face instead of being tunneled through.
    let advanced = 0;
    const steps = Math.max(1, Math.ceil(budget / SAMPLE_STEP));
    let blocked = false;
    for (let i = 1; i <= steps; i++) {
      const t = (budget * i) / steps;
      const x = from.x + dash.dir.x * t;
      const z = from.z + dash.dir.z * t;
      if (!ctx.nav.isWalkableAt(x, z)) {
        blocked = true;
        break;
      }
      advanced = t;
      u.pos.x = x;
      u.pos.z = z;
    }
    dash.remaining -= advanced;
    dash.traveled += advanced;

    // Pass-through strikes: everyone crossed this step, once per unit.
    if (dash.passThrough.length > 0 && advanced > 0) {
      for (const other of ctx.units.values()) {
        if (!hostile(u, other) || other.dead || ctx.dead.has(other.id)) continue;
        if (!isSpellTarget(other)) continue;
        if (dash.hitIds.has(other.id)) continue;
        const d = segmentDistance(other.pos, from, u.pos);
        if (d > 0.9 + other.radius) continue;
        dash.hitIds.add(other.id);
        applyEffects(ctx, u.id, dash.power, other, dash.passThrough, 'ability', {
          distance: dash.traveled,
          lineFrom: dash.from,
          lineDir: dash.dir,
        });
      }
    }

    if (blocked || dash.remaining <= 1e-9) land(ctx, u, dash);
  }
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = 0;
  if (len2 > 0) t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2));
  return hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}
