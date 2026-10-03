// The planet's tuning (src/sim/content/royale_tuning.ts): every champion
// has an entry; a seated champion carries the planet's
// health share times its own and its own damage share; the damage share
// scales a champion's hit on a champion and on nothing else; off the
// planet every champion's share is 1 and its stats are the 5v5's.

import { describe, expect, it } from 'vitest';
import { buildRoyaleSim, type ReplayPick } from '../src/net/replay';
import { dealDamage } from '../src/sim/combat/damage';
import { CAMPS } from '../src/sim/content/camps';
import { CHAMPION_LIST, CHAMPIONS } from '../src/sim/content/champions';
import { PLANET_TUNING, planetTuning } from '../src/sim/content/royale_tuning';
import { DROP_S, ROYALE_HP_SCALE, START_LEVEL } from '../src/sim/royale/types';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { recalcChampion } from '../src/sim/stats';
import { createCamp, type Unit } from '../src/sim/unit';
import { loadPlanet } from './royale_planet';

function ctxOf(sim: Sim): CombatCtx {
  return (sim as unknown as { ctx(): CombatCtx }).ctx();
}

// Every champion of the roster seated on the planet and landed.
function landedRoster() {
  const picks: ReplayPick[] = CHAMPION_LIST.map((c, i) => ({
    name: `seat${i}`,
    team: i,
    championId: c.id,
    sigils: ['riftstep', 'mend'],
  }));
  const built = buildRoyaleSim(loadPlanet(), 6, picks, 'respawn');
  while (built.sim.time < DROP_S + 0.2) built.sim.tick();
  return built;
}

// Two champions far from everything in a 5v5 sim, and what a hit of
// `amount` true damage from the first takes off the second.
function hitTaken(dmgScale: number, amount: number, target: 'champion' | 'camp'): number {
  const sim = new Sim(5);
  const hunter = sim.addChampion(0, { x: 100, z: 60 }, 'torv');
  const prey = sim.addChampion(1, { x: 104, z: 60 }, 'vesk');
  sim.tick();
  hunter.dmgScale = dmgScale;
  let victim: Unit = prey;
  if (target === 'camp') {
    victim = createCamp(9000, CAMPS.barkmaw, { x: 104, z: 62 }, sim.time);
    sim.units.set(victim.id, victim);
  }
  const before = victim.hp;
  dealDamage(ctxOf(sim), hunter.id, victim, amount, 'true', 'attack');
  return before - victim.hp;
}

describe('the planet tuning table', () => {
  it('has an entry for every champion, each share within a half and a double', () => {
    for (const c of CHAMPION_LIST) {
      const t = PLANET_TUNING[c.id];
      expect(t, c.id).toBeDefined();
      for (const v of [t!.hp, t!.dmg]) {
        expect(v).toBeGreaterThanOrEqual(0.5);
        expect(v).toBeLessThanOrEqual(2);
      }
    }
    expect(Object.keys(PLANET_TUNING).sort()).toEqual(CHAMPION_LIST.map((c) => c.id).sort());
    expect(planetTuning(null)).toEqual({ hp: 1, dmg: 1 });
    expect(planetTuning('nobody')).toEqual({ hp: 1, dmg: 1 });
  });

  it('seats every champion with the planet share times its own health, and its own damage', () => {
    const { sim, unitIds } = landedRoster();
    expect(unitIds).toHaveLength(CHAMPION_LIST.length);
    for (const id of unitIds) {
      const u = sim.units.get(id)!;
      const def = CHAMPIONS[u.championId!]!;
      const t = planetTuning(def.id);
      expect(u.level).toBe(START_LEVEL);
      expect(u.hpScale).toBe(ROYALE_HP_SCALE * t.hp);
      expect(u.dmgScale).toBe(t.dmg);
      const fives = def.base.hp + def.growth.hp * (START_LEVEL - 1);
      expect(u.maxHp).toBeCloseTo(fives * ROYALE_HP_SCALE * t.hp, 9);
    }
  });

  it('keeps the shares through a death and a respawn', () => {
    const { sim, unitIds } = landedRoster();
    const u = sim.units.get(unitIds[0]!)!;
    const t = planetTuning(u.championId);
    dealDamage(ctxOf(sim), unitIds[1]!, u, 1e6, 'true');
    sim.tick();
    expect(u.dead).toBe(true);
    for (let i = 0; i < 20 * 10 && u.dead; i++) sim.tick();
    expect(u.dead).toBe(false);
    expect(u.dmgScale).toBe(t.dmg);
    expect(u.hpScale).toBe(ROYALE_HP_SCALE * t.hp);
  });
});

describe('the damage share', () => {
  it("scales a champion's hit on a champion", () => {
    expect(hitTaken(1, 100, 'champion')).toBe(100);
    expect(hitTaken(1.3, 100, 'champion')).toBeCloseTo(130, 9);
    expect(hitTaken(0.8, 100, 'champion')).toBeCloseTo(80, 9);
  });

  it('never scales a hit on a creature', () => {
    expect(hitTaken(1, 100, 'camp')).toBe(100);
    expect(hitTaken(1.3, 100, 'camp')).toBe(100);
  });

  it("never scales a creature's hit on a champion", () => {
    const sim = new Sim(5);
    const prey = sim.addChampion(1, { x: 104, z: 60 }, 'vesk');
    const camp = createCamp(9000, CAMPS.barkmaw, { x: 104, z: 62 }, sim.time);
    camp.dmgScale = 2;
    sim.units.set(camp.id, camp);
    const before = prey.hp;
    dealDamage(ctxOf(sim), camp.id, prey, 50, 'true', 'attack');
    expect(before - prey.hp).toBe(50);
  });
});

describe('off the planet', () => {
  it('leaves every 5v5 champion at 1 and its stats the 5v5 stats', () => {
    const sim = new Sim(4);
    for (const c of CHAMPION_LIST) sim.addChampion(c.id.length % 2, undefined, c.id);
    for (const u of sim.units.values()) {
      expect(u.dmgScale).toBe(1);
      expect(u.hpScale).toBe(1);
      if (u.kind !== 'champion') continue;
      const def = u.champion!;
      expect(u.maxHp).toBe(def.base.hp + def.growth.hp * (u.level - 1));
      const stats = structuredClone(u.stats);
      const maxHp = u.maxHp;
      recalcChampion(u);
      expect(u.stats).toEqual(stats);
      expect(u.maxHp).toBe(maxHp);
    }
  });
});
