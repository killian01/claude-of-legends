// The rings (CONTEXT.md: Ring): the two corner circles of the Star Orchard
// and the creatures that hold them, the Pyrefang on the bot ring and the
// Voidmaul on the top ring (content/rings.ts). Each rises on its clock
// carrying the next aspect of its fixed order, fights back against the
// champions that hit it inside its ring, resets when pulled out or left
// alone, and on death hands the killing team the aspect as a favor
// (favors.ts) and gold to every member (sim.ts, the death handling). Once
// its aspects are spent, every later rise is its Ascendant (CONTEXT.md):
// the bigger body, no aspect, the Wrath on its death (team_buffs.ts), a
// longer return. Called from the fixed tick order right after the Warden
// step. A map without rings (the launch map) has no state here and
// nothing rises.

import type { GameMap, RingSite } from './content/map';
import {
  type AspectId,
  CREATURE_CALM_REGEN_PER_S,
  CREATURE_CALM_S,
  type CreatureDef,
  type CreatureId,
  creatureOfRing,
  type RingId,
} from './content/rings';
import { hypot } from './exact';
import type { CombatCtx } from './sim_context';
import { DT } from './types';
import { createCreature, hostile, type Unit } from './unit';

export interface RingState {
  ring: RingId;
  creature: CreatureId;
  site: RingSite;
  // The live creature, null between rises.
  unitId: number | null;
  // When the next one rises; meaningful while unitId is null.
  nextRiseAt: number;
  // How many have risen so far: the next carries aspects[riseIndex], and
  // past the end of the order it is the Ascendant.
  riseIndex: number;
  // When the live one rose, null between rises (a rally reads it).
  roseAt: number | null;
}

export function initialRingStates(map: GameMap): RingState[] {
  return (map.rings ?? []).map((site) => {
    const def = creatureOfRing(site.id);
    return {
      ring: site.id,
      creature: def.id,
      site,
      unitId: null,
      nextRiseAt: def.firstRiseS,
      riseIndex: 0,
      roseAt: null,
    };
  });
}

export function creatureDefOf(state: RingState): CreatureDef {
  return creatureOfRing(state.ring);
}

// The aspect the next creature of this ring carries (or the live one
// does); null once the order is spent, when the rise is the Ascendant's.
export function ringAspect(state: RingState, index = state.riseIndex): AspectId | null {
  return creatureDefOf(state).aspects[index] ?? null;
}

export function isAscendantRise(state: RingState, index = state.riseIndex): boolean {
  return index >= creatureDefOf(state).aspects.length;
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

export function stepRings(ctx: CombatCtx, states: RingState[]): void {
  for (const state of states) {
    const site = state.site;
    if (state.unitId === null) {
      if (ctx.time >= state.nextRiseAt) {
        const id = ctx.allocId();
        const center = { x: site.x, z: site.z };
        const at = ctx.nav.isWalkableAt(center.x, center.z)
          ? center
          : (ctx.nav.nearestWalkable(center.x, center.z) ?? center);
        ctx.units.set(
          id,
          createCreature(id, creatureDefOf(state), at, ringAspect(state), ctx.time),
        );
        state.unitId = id;
        state.riseIndex += 1;
        state.roseAt = ctx.time;
      }
      continue;
    }
    const c = ctx.units.get(state.unitId);
    if (!c || c.dead || ctx.dead.has(c.id)) continue;

    const fromCenter = hypot(c.pos.x - site.x, c.pos.z - site.z);
    const angry = ctx.time - c.lastDamagedAt <= CREATURE_CALM_S;

    // Leash: pulled off the platform (the disc and its stairs) it resets
    // to full at the center; left alone it walks home and, hurt, heals
    // fast rather than snapping (CREATURE_CALM_REGEN_PER_S).
    if (fromCenter > site.leash) {
      c.hp = c.maxHp;
      c.pos = { x: site.x, z: site.z };
      c.path = [];
      c.attackTargetId = null;
      c.statuses = [];
      continue;
    }
    if (!angry && (c.hp < c.maxHp || fromCenter > 1)) {
      c.hp = Math.min(c.maxHp, c.hp + c.maxHp * CREATURE_CALM_REGEN_PER_S * DT);
      c.pos = { x: site.x, z: site.z };
      c.path = [];
      c.attackTargetId = null;
      c.statuses = [];
      continue;
    }

    // Retaliate: while angry, keep a hostile champion on the platform
    // targeted; one at the disc's edge or on the steps is still there.
    if (angry) {
      const target = c.attackTargetId !== null ? ctx.units.get(c.attackTargetId) : undefined;
      const targetOk =
        target &&
        !target.dead &&
        !ctx.dead.has(target.id) &&
        hypot(target.pos.x - site.x, target.pos.z - site.z) <= site.leash;
      if (!targetOk) {
        const next = nearestHostileChampion(ctx, c, site.leash);
        c.attackTargetId = next ? next.id : null;
      }
    } else {
      c.attackTargetId = null;
    }
  }
}

export interface CreatureFall {
  creature: CreatureId;
  // The aspect the creature carried, null when it was the Ascendant.
  aspect: AspectId | null;
  ascendant: boolean;
}

// Called by the sim's death handling when a creature dies: the ring's
// clock restarts (the Ascendant's longer return when it was one), and
// what the creature carried is returned so the sim grants it (the favor,
// the Wrath and the gold live with the sim). Null when the unit was no
// ring's creature.
export function onCreatureSlain(
  states: RingState[],
  unitId: number,
  time: number,
): CreatureFall | null {
  const state = states.find((s) => s.unitId === unitId);
  if (!state) return null;
  const def = creatureDefOf(state);
  const ascendant = isAscendantRise(state, state.riseIndex - 1);
  state.unitId = null;
  state.roseAt = null;
  state.nextRiseAt = time + (ascendant ? def.ascendant.returnS : def.returnS);
  return { creature: state.creature, aspect: ringAspect(state, state.riseIndex - 1), ascendant };
}

// A ring's clock as a world reads it: the live creature or when the next
// rises, and the aspect in play. Position-free beyond the ring's own.
export interface RingClock {
  ring: RingId;
  creature: CreatureId;
  x: number;
  z: number;
  // The live creature's id, null between rises.
  unitId: number | null;
  // When the next rises, null while one is alive.
  riseAt: number | null;
  // When the live one rose, null between rises.
  roseAt: number | null;
  // The aspect the live creature carries, or the next one will; null
  // when that rise is the Ascendant's.
  aspect: AspectId | null;
  // Whether the live creature, or the next to rise, is the Ascendant.
  ascendant: boolean;
}

export function ringClocks(states: readonly RingState[]): RingClock[] {
  return states.map((s) => {
    const index = s.unitId === null ? s.riseIndex : s.riseIndex - 1;
    return {
      ring: s.ring,
      creature: s.creature,
      x: s.site.x,
      z: s.site.z,
      unitId: s.unitId,
      riseAt: s.unitId === null ? s.nextRiseAt : null,
      roseAt: s.roseAt,
      aspect: ringAspect(s, index),
      ascendant: isAscendantRise(s, index),
    };
  });
}
