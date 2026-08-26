// The Warden (CONTEXT.md): the neutral river objective. Spawns in one of
// two mirrored pits on an announced clock, alternating pits per spawn,
// fights back against champions that damage it, leashes hard to its pit,
// and on death hands the killing team the Warden's Boon (team_buffs.ts).
// Called from the fixed tick order in sim.ts right after waves.

import type { GameMap } from './content/map';
import type { CombatCtx } from './sim_context';
import type { Vec2 } from './types';
import { createWarden, hostile, type Unit } from './unit';

export const WARDEN_FIRST_SPAWN_S = 210;
export const WARDEN_RESPAWN_S = 240;
// Beyond this range from its pit the Warden resets: full heal, walk home.
export const WARDEN_LEASH_RANGE = 13;
// How long after the last hit it keeps fighting before resetting.
export const WARDEN_CALM_S = 5;

export interface ObjectiveState {
  wardenId: number | null;
  nextSpawnAt: number;
  spawnIndex: number;
}

export function initialObjectiveState(): ObjectiveState {
  return { wardenId: null, nextSpawnAt: WARDEN_FIRST_SPAWN_S, spawnIndex: 0 };
}

function pitOf(map: GameMap, state: ObjectiveState): Vec2 {
  return map.wardenPits[(state.spawnIndex - 1 + map.wardenPits.length) % map.wardenPits.length]!;
}

function nearestHostileChampion(ctx: CombatCtx, w: Unit, range: number): Unit | null {
  let best: Unit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const u of ctx.units.values()) {
    if (u.kind !== 'champion' || u.dead || ctx.dead.has(u.id)) continue;
    if (!hostile(w, u)) continue;
    const d = Math.hypot(u.pos.x - w.pos.x, u.pos.z - w.pos.z);
    if (d <= range && d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

export function stepObjectives(ctx: CombatCtx, map: GameMap, state: ObjectiveState): void {
  if (state.wardenId === null) {
    if (ctx.time >= state.nextSpawnAt) {
      const pit = map.wardenPits[state.spawnIndex % map.wardenPits.length]!;
      const id = ctx.allocId();
      ctx.units.set(id, createWarden(id, pit));
      state.wardenId = id;
      state.spawnIndex += 1;
    }
    return;
  }

  const w = ctx.units.get(state.wardenId);
  if (!w || w.dead || ctx.dead.has(w.id)) return;

  const pit = pitOf(map, state);
  const fromPit = Math.hypot(w.pos.x - pit.x, w.pos.z - pit.z);
  const angry = ctx.time - w.lastDamagedAt <= WARDEN_CALM_S;

  // Leash: pulled too far, or left alone while hurt or displaced, it
  // resets to full at its pit.
  if (fromPit > WARDEN_LEASH_RANGE || (!angry && (w.hp < w.maxHp || fromPit > 1))) {
    w.hp = w.maxHp;
    w.pos = { x: pit.x, z: pit.z };
    w.path = [];
    w.attackTargetId = null;
    w.statuses = [];
    return;
  }

  // Retaliate: while angry, keep a hostile champion in the pit targeted.
  if (angry) {
    const target = w.attackTargetId !== null ? ctx.units.get(w.attackTargetId) : undefined;
    const targetOk =
      target &&
      !target.dead &&
      !ctx.dead.has(target.id) &&
      Math.hypot(target.pos.x - pit.x, target.pos.z - pit.z) <= WARDEN_LEASH_RANGE;
    if (!targetOk) {
      const next = nearestHostileChampion(ctx, w, WARDEN_LEASH_RANGE);
      w.attackTargetId = next ? next.id : null;
    }
  } else {
    w.attackTargetId = null;
  }
}

// Called by the sim's death processing when the Warden dies: the respawn
// clock starts (the Boon grant itself lives with the sim's TeamBuffs).
export function onWardenSlain(state: ObjectiveState, time: number): void {
  state.wardenId = null;
  state.nextSpawnAt = time + WARDEN_RESPAWN_S;
}
