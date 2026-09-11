// The forests' camps (CONTEXT.md: Camp; content/camps.ts): neutral map
// treasure on the spots the map lists, each of a kind. A spot fills on
// the opening clock with its kind's bodies (one, or the Brackenlings'
// three), spawned together and back together on the kind's clock once
// the last has fallen; a body retaliates inside a short leash and resets
// when left alone, and pays through the normal kill reward path, the
// Barkmaw's killer taking the attack speed buff on top. Beside the bodies,
// each team's memory of every spot (what it last saw standing there, and
// since when it has seen the spot empty), the fog-honest knowledge a
// jungler routes on (ADR 0023). Called from the fixed tick order right
// after the rings' step, the sightings once the tick's vision is known.

import { addStatus } from './combat/status';
import {
  CAMP_BUFF_AS_PCT,
  CAMP_BUFF_DURATION_S,
  CAMP_FIRST_SPAWN_S,
  CAMPS,
  type CampKind,
} from './content/camps';
import type { CampSpot, GameMap } from './content/map';
import { hypot } from './exact';
import type { CombatCtx } from './sim_context';
import type { TeamId, Vec2 } from './types';
import { createCamp, hostile, type Unit } from './unit';

export { CAMP_BUFF_AS_PCT, CAMP_BUFF_DURATION_S, CAMP_FIRST_SPAWN_S } from './content/camps';
export const CAMP_LEASH_RANGE = 10;
export const CAMP_CALM_S = 5;

// What a team last saw at a spot: when it looked, whether bodies stood,
// and since when it has seen the spot empty (the respawn clock a jungler
// counts from). A spot nobody has looked at has no sighting.
export interface CampSighting {
  at: number;
  up: boolean;
  downSince: number | null;
}

export interface CampState {
  spot: CampSpot;
  // The live bodies, empty between spawns.
  unitIds: number[];
  nextSpawnAt: number;
  seen: [CampSighting | null, CampSighting | null];
}

export function initialCampStates(map: GameMap): CampState[] {
  return map.camps.map((spot) => ({
    spot,
    unitIds: [],
    nextSpawnAt: CAMP_FIRST_SPAWN_S,
    seen: [null, null],
  }));
}

// Where a spot's bodies stand: the first on the spot, the rest fanned
// behind it a stride apart, each on open ground.
export function campStands(spot: Vec2, kind: CampKind): Vec2[] {
  const def = CAMPS[kind];
  const gap = def.body.radius * 2.4;
  const out: Vec2[] = [];
  for (let i = 0; i < def.count; i++) {
    const side = i === 0 ? 0 : i % 2 === 1 ? 1 : -1;
    const row = Math.ceil(i / 2);
    out.push({ x: spot.x + side * gap * row, z: spot.z + gap * 0.7 * row });
  }
  return out;
}

function nearestHostileChampion(ctx: CombatCtx, from: Unit, range: number): Unit | null {
  let best: Unit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const u of ctx.units.values()) {
    if (u.kind !== 'champion' || u.dead || ctx.dead.has(u.id)) continue;
    if (!hostile(from, u)) continue;
    const d = hypot(u.pos.x - from.pos.x, u.pos.z - from.pos.z);
    if (d <= range && d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

export function stepCamps(ctx: CombatCtx, states: CampState[]): void {
  for (const state of states) {
    if (state.unitIds.length === 0) {
      if (ctx.time >= state.nextSpawnAt) {
        const def = CAMPS[state.spot.kind];
        for (const stand of campStands(state.spot, state.spot.kind)) {
          const at = ctx.nav.isWalkableAt(stand.x, stand.z)
            ? stand
            : (ctx.nav.nearestWalkable(stand.x, stand.z) ?? { x: state.spot.x, z: state.spot.z });
          const id = ctx.allocId();
          ctx.units.set(id, createCamp(id, def, at, ctx.time));
          state.unitIds.push(id);
        }
      }
      continue;
    }
    for (const unitId of state.unitIds) {
      const c = ctx.units.get(unitId);
      if (!c || c.dead || ctx.dead.has(c.id)) continue;

      const fromSpot = hypot(c.pos.x - state.spot.x, c.pos.z - state.spot.z);
      const angry = ctx.time - c.lastDamagedAt <= CAMP_CALM_S;

      if (fromSpot > CAMP_LEASH_RANGE || (!angry && (c.hp < c.maxHp || fromSpot > 3))) {
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
          hypot(target.pos.x - state.spot.x, target.pos.z - state.spot.z) <= CAMP_LEASH_RANGE;
        if (!targetOk) {
          const next = nearestHostileChampion(ctx, c, CAMP_LEASH_RANGE);
          c.attackTargetId = next ? next.id : null;
        }
      } else {
        c.attackTargetId = null;
      }
    }
  }
}

// Called by the sim's death processing when a camp body dies: the last
// body of a spot starts its respawn clock, and the Barkmaw pays its
// killer a personal attack speed buff.
export function onCampSlain(
  states: CampState[],
  unitId: number,
  killer: Unit | undefined,
  time: number,
): void {
  const state = states.find((s) => s.unitIds.includes(unitId));
  if (!state) return;
  const def = CAMPS[state.spot.kind];
  state.unitIds = state.unitIds.filter((id) => id !== unitId);
  if (state.unitIds.length === 0) state.nextSpawnAt = time + def.respawnS;
  if (def.buff && killer && killer.kind === 'champion' && !killer.dead) {
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

// Each team's memory of the spots, from the tick's vision: a spot in a
// team's sight is noted as it stands. Nothing is noted before the opening
// clock, so an empty spot at 0:10 is not a cleared one.
export function noteCampSightings(
  states: CampState[],
  time: number,
  isPointVisible: (team: TeamId, x: number, z: number) => boolean,
): void {
  if (time < CAMP_FIRST_SPAWN_S) return;
  for (const state of states) {
    const up = state.unitIds.length > 0;
    for (const team of [0, 1] as const) {
      if (!isPointVisible(team, state.spot.x, state.spot.z)) continue;
      const before = state.seen[team];
      state.seen[team] = {
        at: time,
        up,
        downSince: up ? null : before && !before.up ? before.downSince : time,
      };
    }
  }
}
