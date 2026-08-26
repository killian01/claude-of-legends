// Jungle camps (systems review): neutral map treasure, deliberately WITHOUT
// a jungler role. Camps spawn at match start on the mirrored spots in
// content/map.ts, respawn on a clock after being cleared, retaliate inside
// a short leash and reset when left alone, and pay through the normal kill
// reward path. The buff camp additionally grants its killer a personal
// attack speed buff. Called from the fixed tick order right after the
// Warden step.

import { addStatus } from './combat/status';
import type { CampSpot, GameMap } from './content/map';
import type { CombatCtx } from './sim_context';
import { createCamp, hostile, type Unit } from './unit';

export const CAMP_FIRST_SPAWN_S = 30;
export const CAMP_RESPAWN_S = 90;
export const CAMP_LEASH_RANGE = 10;
export const CAMP_CALM_S = 5;
export const CAMP_BUFF_AS_PCT = 0.15;
export const CAMP_BUFF_DURATION_S = 90;

export interface CampState {
  spot: CampSpot;
  unitId: number | null;
  nextSpawnAt: number;
}

export function initialCampStates(map: GameMap): CampState[] {
  return map.camps.map((spot) => ({ spot, unitId: null, nextSpawnAt: CAMP_FIRST_SPAWN_S }));
}

function nearestHostileChampion(ctx: CombatCtx, from: Unit, range: number): Unit | null {
  let best: Unit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const u of ctx.units.values()) {
    if (u.kind !== 'champion' || u.dead || ctx.dead.has(u.id)) continue;
    if (!hostile(from, u)) continue;
    const d = Math.hypot(u.pos.x - from.pos.x, u.pos.z - from.pos.z);
    if (d <= range && d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

export function stepCamps(ctx: CombatCtx, states: CampState[]): void {
  for (const state of states) {
    if (state.unitId === null) {
      if (ctx.time >= state.nextSpawnAt) {
        const id = ctx.allocId();
        ctx.units.set(id, createCamp(id, { x: state.spot.x, z: state.spot.z }));
        state.unitId = id;
      }
      continue;
    }
    const c = ctx.units.get(state.unitId);
    if (!c || c.dead || ctx.dead.has(c.id)) continue;

    const fromSpot = Math.hypot(c.pos.x - state.spot.x, c.pos.z - state.spot.z);
    const angry = ctx.time - c.lastDamagedAt <= CAMP_CALM_S;

    if (fromSpot > CAMP_LEASH_RANGE || (!angry && (c.hp < c.maxHp || fromSpot > 1))) {
      c.hp = c.maxHp;
      c.pos = { x: state.spot.x, z: state.spot.z };
      c.path = [];
      c.attackTargetId = null;
      c.statuses = [];
      continue;
    }

    if (angry) {
      const target = c.attackTargetId !== null ? ctx.units.get(c.attackTargetId) : undefined;
      const targetOk =
        target &&
        !target.dead &&
        !ctx.dead.has(target.id) &&
        Math.hypot(target.pos.x - state.spot.x, target.pos.z - state.spot.z) <= CAMP_LEASH_RANGE;
      if (!targetOk) {
        const next = nearestHostileChampion(ctx, c, CAMP_LEASH_RANGE);
        c.attackTargetId = next ? next.id : null;
      }
    } else {
      c.attackTargetId = null;
    }
  }
}

// Called by the sim's death processing when a camp dies: the respawn clock
// starts, and the buff camp pays its killer a personal attack speed buff.
export function onCampSlain(
  states: CampState[],
  unitId: number,
  killer: Unit | undefined,
  time: number,
): void {
  const state = states.find((s) => s.unitId === unitId);
  if (!state) return;
  state.unitId = null;
  state.nextSpawnAt = time + CAMP_RESPAWN_S;
  if (state.spot.buff && killer && killer.kind === 'champion' && !killer.dead) {
    addStatus(killer, {
      kind: 'buff',
      until: time + CAMP_BUFF_DURATION_S,
      msPct: 0,
      asPct: CAMP_BUFF_AS_PCT,
      armor: 0,
      mr: 0,
    });
  }
}
