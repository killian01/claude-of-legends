// Traveling dashes (kits-v2): a dash declared with a speed is a real
// flight, not a teleport. The unit is committed and visibly on its line
// every tick, terrain and ability walls stop it early, enemies crossed by a
// pass-through dash are struck en route, and the landing payload resolves
// where the flight actually ends, with the traveled distance as an effect
// fact. Dashes declared without a speed keep the legacy instant blink. On
// the planet the flight keeps to its great circle (geo.ts, ADR 0029).

import { applyEffects, type EffectSpec, type Power } from './combat/effects';
import { assign, copy, dist, offset, onSphere, segmentDist } from './geo';
import type { CombatCtx } from './sim_context';
import { isSpellTarget } from './spell_targets';
import type { Vec2 } from './types';
import { hostile, type Unit } from './unit';

export interface DashState {
  from: Vec2;
  // The heading at `from`.
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

// Where the flight is `s` further on this tick, from `here`. The plane steps
// from where the unit stands, as it always did. The sphere measures every
// point from the flight's start along its first heading: the chord back to
// the start is then the distance flown, and a flight run to its end lands
// exactly on the point it was aimed at, where chords stepped one after
// another along the curve would fall a few millimeters short.
function flightPoint(dash: DashState, here: Vec2, s: number): Vec2 {
  if (onSphere(here)) return offset(dash.from, dash.dir, dash.traveled + s);
  return offset(here, dash.dir, s);
}

function land(ctx: CombatCtx, u: Unit, dash: DashState): void {
  u.activeDash = null;
  u.path = [];
  const fx = {
    center: copy(u.pos),
    distance: dash.traveled,
    lineFrom: dash.from,
    lineDir: dash.dir,
  };
  if (dash.onLand.length > 0 && dash.landRadius > 0) {
    for (const other of ctx.units.values()) {
      if (!hostile(u, other) || other.dead || ctx.dead.has(other.id)) continue;
      if (!isSpellTarget(other)) continue;
      const d = dist(other.pos, u.pos);
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
    const from = copy(u.pos);
    // Advance in small samples so a wall raised mid-flight stops the dash
    // at its face instead of being tunneled through.
    let advanced = 0;
    const steps = Math.max(1, Math.ceil(budget / SAMPLE_STEP));
    let blocked = false;
    for (let i = 1; i <= steps; i++) {
      const t = (budget * i) / steps;
      const at = flightPoint(dash, from, t);
      if (!ctx.ground.isWalkableAt(at)) {
        blocked = true;
        break;
      }
      advanced = t;
      assign(u.pos, at);
    }
    dash.remaining -= advanced;
    dash.traveled += advanced;

    // Pass-through strikes: everyone crossed this step, once per unit.
    if (dash.passThrough.length > 0 && advanced > 0) {
      for (const other of ctx.units.values()) {
        if (!hostile(u, other) || other.dead || ctx.dead.has(other.id)) continue;
        if (!isSpellTarget(other)) continue;
        if (dash.hitIds.has(other.id)) continue;
        const d = segmentDist(other.pos, from, u.pos).d;
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
