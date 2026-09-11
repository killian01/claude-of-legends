// The Warden (CONTEXT.md): the neutral objective. Spawns in one of the
// map's pits on an announced clock (the first pit first, then one drawn
// from the match's rng among the others, never the same twice running:
// the plaza and the forest rooms on the Star Orchard, ADR 0023), fights
// back against champions that damage it, leashes hard to its pit, and on
// death hands the killing team the Warden's Boon (team_buffs.ts). Called
// from the fixed tick order in sim.ts right after waves.

import type { GameMap, WardenPit } from './content/map';
import { CREATURE_CALM_REGEN_PER_S } from './content/rings';
import { hypot } from './exact';
import type { Rng } from './rng';
import type { CombatCtx } from './sim_context';
import { DT, type Vec2 } from './types';
import { createWarden, hostile, type Unit } from './unit';

// 720 s: the Warden is the last creature to rise (docs/plan-rings.md), the
// match's prize after the rings' Pyrefang (4:00) and Voidmaul (6:30); it
// was the mid game's pivot at 600 before the rings, and never an early
// skirmish prize (playtest round 3: at 3:30 it dropped into the laning
// phase and the map never got a laning phase back). The respawn keeps two
// to three Wardens inside a median match and, with BOON_DURATION_S above
// it, makes the second Boon stack actually reachable by winning
// consecutive pits.
export const WARDEN_FIRST_SPAWN_S = 720;
export const WARDEN_RESPAWN_S = 150;
// The Warden's body (content/warden.ts) grows with the game clock by the
// same curve as the rings' creatures (content/rings.ts, bodyGrowth):
// spawning later must not mean spawning trivial against six-item champions.
// Beyond this range from its pit the Warden resets: full heal, walk home.
export const WARDEN_LEASH_RANGE = 13;
// How long after the last hit it keeps fighting before resetting.
export const WARDEN_CALM_S = 5;

export interface ObjectiveState {
  wardenId: number | null;
  nextSpawnAt: number;
  spawnIndex: number;
  // When the live Warden rose, null between spawns (a rally reads it).
  roseAt: number | null;
  // The pit of the live Warden, or of the next to rise: an index into the
  // map's pits. Public once the Warden stands there, told to nobody
  // before (the observation and the wire carry it only while it lives).
  pit: number;
}

export function initialObjectiveState(): ObjectiveState {
  return {
    wardenId: null,
    nextSpawnAt: WARDEN_FIRST_SPAWN_S,
    spawnIndex: 0,
    roseAt: null,
    pit: 0,
  };
}

// The next pit: one of the others, drawn from the match's rng. With two
// pits (the launch map) the draw alternates; with one it stays.
export function drawPit(rng: Rng, count: number, last: number): number {
  if (count <= 1) return 0;
  return (last + 1 + rng.int(count - 1)) % count;
}

// The pit the state names, on the map the match is played on.
export function wardenPitOf(map: GameMap, state: ObjectiveState): WardenPit {
  return map.wardenPits[state.pit % map.wardenPits.length] ?? map.wardenPits[0]!;
}

function pitOf(map: GameMap, state: ObjectiveState): Vec2 {
  return wardenPitOf(map, state);
}

function nearestHostileChampion(ctx: CombatCtx, w: Unit, range: number): Unit | null {
  let best: Unit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const u of ctx.units.values()) {
    if (u.kind !== 'champion' || u.dead || ctx.dead.has(u.id)) continue;
    if (!hostile(w, u)) continue;
    const d = hypot(u.pos.x - w.pos.x, u.pos.z - w.pos.z);
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
      const pit = wardenPitOf(map, state);
      const id = ctx.allocId();
      ctx.units.set(id, createWarden(id, pit, ctx.time));
      state.wardenId = id;
      state.roseAt = ctx.time;
      state.spawnIndex += 1;
    }
    return;
  }

  const w = ctx.units.get(state.wardenId);
  if (!w || w.dead || ctx.dead.has(w.id)) return;

  const pit = pitOf(map, state);
  const fromPit = hypot(w.pos.x - pit.x, w.pos.z - pit.z);
  const angry = ctx.time - w.lastDamagedAt <= WARDEN_CALM_S;

  // Leash: pulled too far it resets to full at its pit; left alone it
  // walks home and, hurt, heals fast rather than snapping, the rings'
  // rule (content/rings.ts, CREATURE_CALM_REGEN_PER_S).
  if (fromPit > WARDEN_LEASH_RANGE) {
    w.hp = w.maxHp;
    w.pos = { x: pit.x, z: pit.z };
    w.path = [];
    w.attackTargetId = null;
    w.statuses = [];
    return;
  }
  if (!angry && (w.hp < w.maxHp || fromPit > 1)) {
    w.hp = Math.min(w.maxHp, w.hp + w.maxHp * CREATURE_CALM_REGEN_PER_S * DT);
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
      hypot(target.pos.x - pit.x, target.pos.z - pit.z) <= WARDEN_LEASH_RANGE;
    if (!targetOk) {
      const next = nearestHostileChampion(ctx, w, WARDEN_LEASH_RANGE);
      w.attackTargetId = next ? next.id : null;
    }
  } else {
    w.attackTargetId = null;
  }
}

// Called by the sim's death processing when the Warden dies: the respawn
// clock starts and the next pit is drawn (the Boon grant itself lives
// with the sim's TeamBuffs).
export function onWardenSlain(
  state: ObjectiveState,
  time: number,
  rng: Rng,
  pitCount: number,
): void {
  state.wardenId = null;
  state.roseAt = null;
  state.nextSpawnAt = time + WARDEN_RESPAWN_S;
  state.pit = drawPit(rng, pitCount, state.pit);
}
