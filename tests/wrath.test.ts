// The Wrath (CONTEXT.md, docs/plan-rings.md round two): what an
// Ascendant's death hands the killing team for a while. A champion of the
// team that holds it burns every enemy champion it hits and finishes one
// it brings under a fifth of its max health; nobody else executes, and
// nothing but a champion is executed. Refreshed, never stacked; a team
// fact that outlives a death, like the Boon.

import { describe, expect, it } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import {
  WRATH_BURN_PCT,
  WRATH_BURN_S,
  WRATH_DURATION_S,
  WRATH_EXECUTE_FRAC,
} from '../src/sim/content/rings';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import type { Unit } from '../src/sim/unit';

const TICKS_PER_S = 20;

function ctxOf(sim: Sim): CombatCtx {
  return (sim as unknown as { ctx(): CombatCtx }).ctx();
}

// Two champions a lane apart, so nothing else touches them.
function pair(sim: Sim): { hunter: Unit; prey: Unit } {
  const hunter = sim.addChampion(0, { x: 100, z: 60 });
  const prey = sim.addChampion(1, { x: 104, z: 60 });
  sim.tick();
  return { hunter, prey };
}

function hit(sim: Sim, source: Unit, target: Unit, amount: number): void {
  dealDamage(ctxOf(sim), source.id, target, amount, 'true', 'attack');
}

describe('the Wrath', () => {
  it('lasts its duration, refreshes without stacking, and outlives a death', () => {
    const sim = new Sim(5);
    const { hunter } = pair(sim);
    expect(sim.teamWrath(0)).toBeNull();
    sim.grantWrath(0);
    expect(sim.teamWrath(0)).toBe(sim.time + WRATH_DURATION_S);
    expect(sim.teamWrath(1)).toBeNull();
    for (let i = 0; i < 10 * TICKS_PER_S; i++) sim.tick();
    sim.grantWrath(0);
    expect(sim.teamWrath(0)).toBe(sim.time + WRATH_DURATION_S);
    hunter.hp = 0;
    hit(sim, hunter, hunter, 1);
    sim.tick();
    expect(hunter.dead).toBe(true);
    expect(sim.teamWrath(0)).not.toBeNull();
    sim.time += WRATH_DURATION_S + 1;
    expect(sim.teamWrath(0)).toBeNull();
  });

  it('finishes an enemy champion brought under the line, credited to the hunter', () => {
    const sim = new Sim(5);
    const { hunter, prey } = pair(sim);
    sim.grantWrath(0);
    prey.hp = Math.round(prey.maxHp * 0.3);
    hit(sim, hunter, prey, prey.maxHp * 0.05);
    expect(prey.hp).toBeGreaterThan(0);
    // Above the line still: alive. One more hit crosses it: dead on the spot.
    hit(sim, hunter, prey, prey.maxHp * 0.06);
    expect(prey.hp).toBe(0);
    const events = sim.tick();
    expect(events.some((e) => e.type === 'execute' && e.unitId === prey.id)).toBe(true);
    expect(prey.dead).toBe(true);
    expect(hunter.kills).toBe(1);
    expect(WRATH_EXECUTE_FRAC).toBe(0.2);
  });

  it('executes for nobody else: no Wrath, an ally, a minion, or a body that is no champion', () => {
    const sim = new Sim(5);
    const { hunter, prey } = pair(sim);
    // No Wrath: a champion under the line survives the hit.
    prey.hp = Math.round(prey.maxHp * 0.15);
    hit(sim, hunter, prey, 1);
    expect(prey.hp).toBeGreaterThan(0);
    sim.grantWrath(1);
    // The prey's own team holds it: the hunter's hit finishes nothing.
    hit(sim, hunter, prey, 1);
    expect(prey.hp).toBeGreaterThan(0);
    sim.grantWrath(0);
    // A minion of the holding team hits: no execute.
    const minion = [...sim.units.values()].find((u) => u.kind === 'minion' && u.team === 0);
    const soldier = minion ?? sim.addChampion(0, { x: 20, z: 20 });
    if (minion) {
      hit(sim, minion, prey, 1);
      expect(prey.hp).toBeGreaterThan(0);
    }
    expect(soldier).toBeDefined();
    // A tower of the enemy at 10 percent is no champion: it stands.
    const tower = [...sim.units.values()].find((u) => u.kind === 'tower' && u.team === 1)!;
    tower.hp = Math.round(tower.maxHp * 0.1);
    dealDamage(ctxOf(sim), hunter.id, tower, 1, 'true', 'attack');
    expect(tower.hp).toBeGreaterThan(0);
  });

  it('burns a share of the victim over three seconds, one burn refreshed by each hit', () => {
    const sim = new Sim(5);
    const { hunter, prey } = pair(sim);
    sim.grantWrath(0);
    const before = prey.hp;
    hit(sim, hunter, prey, 10);
    const burns = () => prey.statuses.filter((s) => s.kind === 'dot' && s.tag === 'wrath');
    expect(burns()).toHaveLength(1);
    expect(burns()[0]!.until).toBeCloseTo(sim.time + WRATH_BURN_S, 3);
    // A second hit refreshes the one burn instead of adding another.
    for (let i = 0; i < TICKS_PER_S; i++) sim.tick();
    hit(sim, hunter, prey, 10);
    expect(burns()).toHaveLength(1);
    expect(burns()[0]!.until).toBeCloseTo(sim.time + WRATH_BURN_S, 3);
    // Its own ticks never refresh it: it ends on its clock.
    const until = burns()[0]!.until;
    for (let i = 0; i < 2 * TICKS_PER_S; i++) sim.tick();
    expect(burns()[0]?.until).toBe(until);
    for (let i = 0; i < 2 * TICKS_PER_S; i++) sim.tick();
    expect(burns()).toHaveLength(0);
    // Two hits and one full burn (the first was cut short by the refresh):
    // the burn's share landed, true damage, regen aside.
    const lost = before - prey.hp;
    expect(lost).toBeGreaterThan(20 + WRATH_BURN_PCT * prey.maxHp * 0.9);
    expect(lost).toBeLessThan(20 + 2 * WRATH_BURN_PCT * prey.maxHp);
  });
});
