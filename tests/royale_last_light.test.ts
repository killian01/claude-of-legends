// Respawn's Last light (CONTEXT.md; src/sim/royale/last_light.ts): from the
// Dusk's last closing until the light goes out a takedown counts double,
// the Lodestar's four, for every seat; the sim tells it once as it begins;
// no death is final, and One life has none of it.

import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { DUSK_PHASES } from '../src/sim/content/dusk';
import {
  LAST_LIGHT_AT_S,
  LAST_LIGHT_FACTOR,
  lastLightFactor,
  lastLightOn,
} from '../src/sim/royale/last_light';
import { LEADER_TAKEDOWN_SCORE, PLAY_S, type RoyaleVariant } from '../src/sim/royale/types';
import type { Sim, SimEvent } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { DT } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { landed } from './royale_contract_fixture';

function takedown(sim: Sim, killer: Unit, victim: Unit): SimEvent[] {
  killer.pos = { ...victim.pos };
  killer.path = [];
  const ctx = (sim as unknown as { ctx(): CombatCtx }).ctx();
  dealDamage(ctx, killer.id, victim, victim.maxHp * 10, 'true');
  return sim.tick();
}

function lastLights(events: readonly SimEvent[]) {
  return events.filter((e) => e.type === 'royale_last_light');
}

// A landed match whose clock reads `left` seconds before the Last light
// begins (the landing moved back; the Dusk keeps its own drawn times).
function nearLastLight(variant: RoyaleVariant, left: number) {
  const built = landed(variant);
  const r = built.sim.royale!;
  r.dropEndsAt = built.sim.time + left - LAST_LIGHT_AT_S;
  r.endsAt = r.dropEndsAt + PLAY_S;
  return built;
}

describe('the Last light clock', () => {
  const clock = {
    variant: 'respawn' as const,
    stage: 'play' as const,
    dropEndsAt: 10,
    endsAt: 610,
  };

  it('begins with the Dusk last closing and lasts until the light goes out', () => {
    expect(LAST_LIGHT_AT_S).toBe(DUSK_PHASES[DUSK_PHASES.length - 1]!.closeFrom);
    expect(LAST_LIGHT_AT_S).toBe(528);
    expect(LAST_LIGHT_FACTOR).toBe(2);
    expect(lastLightOn(clock, 10 + 528 - DT)).toBe(false);
    expect(lastLightOn(clock, 10 + 528)).toBe(true);
    expect(lastLightOn(clock, 609.95)).toBe(true);
    expect(lastLightFactor(clock, 600)).toBe(2);
    expect(lastLightFactor(clock, 400)).toBe(1);
  });

  it('is off in One life, in the drop and once the match is over', () => {
    expect(lastLightOn({ ...clock, variant: 'one_life' }, 600)).toBe(false);
    expect(lastLightOn({ ...clock, stage: 'drop' }, 600)).toBe(false);
    expect(lastLightOn({ ...clock, stage: 'over' }, 600)).toBe(false);
  });
});

describe('the Last light in a match', () => {
  it('is told once, on the tick it begins', () => {
    const { sim } = nearLastLight('respawn', 0.5);
    const told: SimEvent[] = [];
    for (let i = 0; i < Math.round(2 / DT); i++) told.push(...lastLights(sim.tick()));
    expect(told).toEqual([{ type: 'royale_last_light', step: 'double' }]);
  });

  it('counts a takedown double while it lasts, and once before', () => {
    const { sim, unitIds } = nearLastLight('respawn', 0.5);
    const [a, b, c] = unitIds.map((id) => sim.units.get(id)!);
    takedown(sim, a!, b!);
    expect(sim.royale!.scores.get(a!.id)).toBe(1);
    for (let i = 0; i < Math.round(1 / DT); i++) sim.tick();
    takedown(sim, c!, a!);
    expect(sim.royale!.scores.get(c!.id)).toBe(LAST_LIGHT_FACTOR);
  });

  it('counts the Lodestar four', () => {
    const { sim, unitIds } = nearLastLight('respawn', -1);
    const [a, b] = unitIds.map((id) => sim.units.get(id)!);
    sim.royale!.scores.set(a!.id, 5);
    sim.tick();
    expect(sim.royale!.marks.some((m) => m.unitId === a!.id && m.kind === 'lodestar')).toBe(true);
    takedown(sim, b!, a!);
    expect(sim.royale!.scores.get(b!.id)).toBe(LEADER_TAKEDOWN_SCORE * LAST_LIGHT_FACTOR);
    expect(LEADER_TAKEDOWN_SCORE * LAST_LIGHT_FACTOR).toBe(4);
  });

  it('makes no death final: the champion comes back', () => {
    const { sim, unitIds } = nearLastLight('respawn', -1);
    const [a, b] = unitIds.map((id) => sim.units.get(id)!);
    takedown(sim, a!, b!);
    expect(b!.dead).toBe(true);
    for (let i = 0; i < Math.round(7 / DT) && b!.dead; i++) sim.tick();
    expect(b!.dead).toBe(false);
  });

  it('has none in One life', () => {
    const { sim, unitIds } = nearLastLight('one_life', 0.5);
    const [a, b] = unitIds.map((id) => sim.units.get(id)!);
    const told: SimEvent[] = [];
    for (let i = 0; i < Math.round(2 / DT); i++) told.push(...lastLights(sim.tick()));
    expect(told).toEqual([]);
    takedown(sim, a!, b!);
    expect(sim.royale!.scores.get(a!.id)).toBe(1);
  });
});
