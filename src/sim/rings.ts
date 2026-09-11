// The rings (CONTEXT.md: Ring): the two corner circles of the Star Orchard
// and the creatures that hold them, the Pyrefang on the bot ring and the
// Voidmaul on the top ring (content/rings.ts). Each rises on its clock
// carrying the next aspect of its fixed order, fights back against the
// champions that hit it inside its ring, resets when pulled out or left
// alone, and on death hands the killing team the aspect as a favor
// (favors.ts) and gold to every member (sim.ts, the death handling).
// Called from the fixed tick order right after the Warden step. A map
// without rings (the launch map) has no state here and nothing rises.

import type { GameMap, RingSite } from './content/map';
import {
  type AspectId,
  CREATURE_CALM_S,
  type CreatureDef,
  type CreatureId,
  creatureOfRing,
  creatureScale,
  type RingId,
} from './content/rings';
import { hypot } from './exact';
import type { CombatCtx } from './sim_context';
import { createCreature, hostile, type Unit } from './unit';

export interface RingState {
  ring: RingId;
  creature: CreatureId;
  site: RingSite;
  // The live creature, null between rises.
  unitId: number | null;
  // When the next one rises; meaningful while unitId is null.
  nextRiseAt: number;
  // How many have risen so far: the next carries aspects[riseIndex % n].
  riseIndex: number;
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
    };
  });
}

export function creatureDefOf(state: RingState): CreatureDef {
  return creatureOfRing(state.ring);
}

// The aspect the next creature of this ring carries (or the live one does).
export function ringAspect(state: RingState, index = state.riseIndex): AspectId {
  const aspects = creatureDefOf(state).aspects;
  return aspects[index % aspects.length]!;
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
          createCreature(id, creatureDefOf(state), at, ringAspect(state), creatureScale(ctx.time)),
        );
        state.unitId = id;
        state.riseIndex += 1;
      }
      continue;
    }
    const c = ctx.units.get(state.unitId);
    if (!c || c.dead || ctx.dead.has(c.id)) continue;

    const fromCenter = hypot(c.pos.x - site.x, c.pos.z - site.z);
    const angry = ctx.time - c.lastDamagedAt <= CREATURE_CALM_S;

    // Leash: pulled out of the ring, or left alone while hurt or displaced,
    // it resets to full at the center.
    if (fromCenter > site.r || (!angry && (c.hp < c.maxHp || fromCenter > 1))) {
      c.hp = c.maxHp;
      c.pos = { x: site.x, z: site.z };
      c.path = [];
      c.attackTargetId = null;
      c.statuses = [];
      continue;
    }

    // Retaliate: while angry, keep a hostile champion inside the ring
    // targeted.
    if (angry) {
      const target = c.attackTargetId !== null ? ctx.units.get(c.attackTargetId) : undefined;
      const targetOk =
        target &&
        !target.dead &&
        !ctx.dead.has(target.id) &&
        hypot(target.pos.x - site.x, target.pos.z - site.z) <= site.r;
      if (!targetOk) {
        const next = nearestHostileChampion(ctx, c, site.r);
        c.attackTargetId = next ? next.id : null;
      }
    } else {
      c.attackTargetId = null;
    }
  }
}

// Called by the sim's death handling when a creature dies: the ring's
// clock restarts, and the aspect the creature carried is returned so the
// sim grants it (the favor and the gold live with the sim's Favors and
// units). Null when the unit was no ring's creature.
export function onCreatureSlain(
  states: RingState[],
  unitId: number,
  time: number,
): AspectId | null {
  const state = states.find((s) => s.unitId === unitId);
  if (!state) return null;
  const aspect = ringAspect(state, state.riseIndex - 1);
  state.unitId = null;
  state.nextRiseAt = time + creatureDefOf(state).returnS;
  return aspect;
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
  // The aspect the live creature carries, or the next one will.
  aspect: AspectId;
}

export function ringClocks(states: readonly RingState[]): RingClock[] {
  return states.map((s) => ({
    ring: s.ring,
    creature: s.creature,
    x: s.site.x,
    z: s.site.z,
    unitId: s.unitId,
    riseAt: s.unitId === null ? s.nextRiseAt : null,
    aspect: s.unitId === null ? ringAspect(s) : ringAspect(s, s.riseIndex - 1),
  }));
}
