// Hidden traps (CONTEXT.md: Sourpod): a zone planted on the ground that
// lies unseen by the caster's enemies, arms after a beat, and bursts when an
// enemy champion steps on it, leaving a field behind (Nisk's poison cloud).
// Walking near one shows nothing: the team's own see theirs always, and an
// enemy team only while one of its reveal zones covers it (vision.ts
// revealShows, the rule a stealthed champion is shown by), every one of its
// seats at once, people and bots by the one rule (trapSeen), which the
// wire, the observation and the offline renderer all read. The cloud a
// burst leaves is an ordinary zone everyone in sight sees. A caster keeps
// at most `maxLive` of them; planting one more takes the oldest away. On
// the planet the pod and its cloud are discs of the sphere like every zone
// (geo.ts).

import type { EffectSpec, Power } from './combat/effects';
import { copy, dist } from './geo';
import type { CombatCtx } from './sim_context';
import { isSpellTarget } from './spell_targets';
import type { TeamId, Vec2 } from './types';
import type { Unit } from './unit';
import { revealShows } from './vision';
import type { Zone } from './zones';

// The field a burst leaves: a zone's ticks and entry payload.
export interface TrapBurst {
  radius: number;
  duration: number;
  tickEvery?: number;
  onEnter?: readonly EffectSpec[];
  onTick?: readonly EffectSpec[];
}

export interface TrapSpec {
  kind: 'trap';
  // How close an enemy champion must step to burst it (plus its body).
  radius: number;
  // How long it lies, seconds.
  duration: number;
  // Seconds after planting before a step bursts it.
  armDelay: number;
  // The caster's pods on the ground at once; one more takes the oldest.
  maxLive: number;
  burst: TrapBurst;
}

// What a zone carries while it is a pod.
export interface TrapState {
  armAt: number;
  burst: TrapBurst;
}

// The vfx tag a pod is drawn by: its ability's tag with a suffix, so the
// cloud it leaves keeps the plain tag and the two read apart.
export const TRAP_VFX_SUFFIX = '_trap';

function blankZone(
  id: number,
  sourceId: number,
  team: TeamId,
  pos: Vec2,
  radius: number,
  until: number,
  tickEvery: number,
  time: number,
  power: Power,
  vfx: string | null,
): Zone {
  return {
    id,
    sourceId,
    team,
    pos: copy(pos),
    radius,
    until,
    tickEvery,
    nextTickAt: time + tickEvery,
    power,
    onEnter: [],
    onTick: [],
    allyOnTick: [],
    detonateAt: null,
    onDetonate: [],
    entered: new Set(),
    reveal: false,
    boundary: null,
    boundaryNextAt: new Map(),
    insideIds: new Set(),
    leaveZone: null,
    vfx,
  };
}

// The caster's pods on the ground, oldest first (ids grow with time).
function podsOf(ctx: CombatCtx, sourceId: number): Zone[] {
  const out: Zone[] = [];
  for (const z of ctx.zones.values()) if (z.trap && z.sourceId === sourceId) out.push(z);
  return out.sort((a, b) => a.id - b.id);
}

export function plantTrap(
  ctx: CombatCtx,
  caster: Unit,
  spec: TrapSpec,
  at: Vec2,
  power: Power,
  vfx: string | null,
): void {
  const pods = podsOf(ctx, caster.id);
  for (let i = 0; i <= pods.length - spec.maxLive; i++) ctx.zones.delete(pods[i]!.id);
  const id = ctx.allocId();
  const zone = blankZone(
    id,
    caster.id,
    caster.team,
    at,
    spec.radius,
    ctx.time + spec.duration,
    spec.duration,
    ctx.time,
    power,
    vfx !== null ? `${vfx}${TRAP_VFX_SUFFIX}` : null,
  );
  zone.trap = { armAt: ctx.time + spec.armDelay, burst: spec.burst };
  ctx.zones.set(id, zone);
}

// The enemy champion stepping on an armed pod, if any (the lowest id when
// several do, so every host bursts it for the same one).
function stepper(ctx: CombatCtx, z: Zone): Unit | null {
  let found: Unit | null = null;
  for (const u of ctx.units.values()) {
    if (u.kind !== 'champion' || u.neutral || u.team === z.team) continue;
    if (u.dead || ctx.dead.has(u.id) || !isSpellTarget(u)) continue;
    if (dist(u.pos, z.pos) > z.radius + u.radius) continue;
    if (found === null || u.id < found.id) found = u;
  }
  return found;
}

// One tick of a pod: gone when its time is up, burst into its cloud when an
// enemy champion steps on it armed. Returns true when the pod left the
// ground this tick.
export function stepTrap(ctx: CombatCtx, z: Zone): boolean {
  const trap = z.trap;
  if (!trap) return false;
  if (ctx.time >= z.until) {
    ctx.zones.delete(z.id);
    return true;
  }
  if (ctx.time < trap.armAt) return false;
  const victim = stepper(ctx, z);
  if (!victim) return false;
  ctx.zones.delete(z.id);
  const burst = trap.burst;
  const tickEvery = burst.tickEvery ?? 0.5;
  const id = ctx.allocId();
  const tag = z.vfx?.endsWith(TRAP_VFX_SUFFIX)
    ? z.vfx.slice(0, -TRAP_VFX_SUFFIX.length)
    : (z.vfx ?? null);
  const cloud = blankZone(
    id,
    z.sourceId,
    z.team,
    z.pos,
    burst.radius,
    ctx.time + burst.duration,
    tickEvery,
    ctx.time,
    z.power,
    tag,
  );
  cloud.onEnter = burst.onEnter ?? [];
  cloud.onTick = burst.onTick ?? [];
  ctx.zones.set(id, cloud);
  ctx.events.push({ type: 'trap', zoneId: z.id, unitId: victim.id, sourceId: z.sourceId });
  return true;
}

// Whether `team` sees the pod: its own team always, an enemy only while one
// of the enemy team's live reveal zones covers it (the pod's disc touching
// the zone's area). Standing close, even on it, shows nothing. A zone that
// is no pod answers false: its sight is the ordinary point rule.
export function trapSeen(
  zones: ReadonlyMap<number, Zone>,
  team: TeamId,
  z: Zone,
  time: number,
): boolean {
  if (!z.trap) return false;
  if (z.team === team) return true;
  for (const r of zones.values()) {
    if (r.team === team && revealShows(r, time, z.pos, z.radius)) return true;
  }
  return false;
}
