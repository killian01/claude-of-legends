// The Warden gate: spawns on its clock in a mirrored, walkable river pit
// (the launch map's two; the drawn pits are tests/warden_pits.test.ts),
// is always visible to both teams, ignores and is ignored by minions and
// towers, pays the killing team the Boon (a death-surviving damage buff),
// starts its respawn clock, and leash-resets when left alone.

import { describe, expect, it } from 'vitest';
import { GAME_MAP } from '../src/sim/content/map';
import { bodyGrowth } from '../src/sim/content/rings';
import { WARDEN_BODY } from '../src/sim/content/warden';
import { WARDEN_FIRST_SPAWN_S, WARDEN_RESPAWN_S } from '../src/sim/objectives';
import { Sim } from '../src/sim/sim';
import { BOON_DAMAGE_PER_STACK, BOON_DURATION_S } from '../src/sim/team_buffs';
import type { Unit } from '../src/sim/unit';

const TICKS_PER_S = 20;

function findWarden(sim: Sim): Unit | undefined {
  return [...sim.units.values()].find((u) => u.kind === 'warden');
}

function runToFirstSpawn(sim: Sim): Unit {
  // Rewind the spawn clock instead of ticking ten sim-minutes to meet the
  // first Warden; the schedule itself is pinned by its own test below.
  sim.objectives.nextSpawnAt = 1;
  for (let i = 0; i < 3 * TICKS_PER_S && !findWarden(sim); i++) {
    sim.tick();
  }
  const w = findWarden(sim);
  expect(w).toBeDefined();
  return w!;
}

describe('the warden', () => {
  it('has two mirrored, walkable pits', () => {
    const sim = new Sim(11);
    const [a, b] = GAME_MAP.wardenPits;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b!.x).toBeCloseTo(GAME_MAP.size - a!.x, 5);
    expect(b!.z).toBeCloseTo(GAME_MAP.size - a!.z, 5);
    for (const pit of GAME_MAP.wardenPits) {
      expect(sim.nav.isWalkableAt(pit.x, pit.z), `pit ${pit.x},${pit.z}`).toBe(true);
    }
  });

  it('rises at twelve minutes as the last creature, on a stackable cadence', () => {
    // 720 s: the Warden rises after the rings' creatures (tests/rings.test.ts)
    // and never in the laning phase (playtest round 3), and the Boon must
    // outlive the respawn clock by a real kill window so winning
    // consecutive pits can reach the second stack.
    expect(WARDEN_FIRST_SPAWN_S).toBe(720);
    expect(BOON_DURATION_S).toBeGreaterThanOrEqual(WARDEN_RESPAWN_S + 20);
    const sim = new Sim(11);
    sim.teamBuffs.grantBoon(1, 100);
    sim.teamBuffs.grantBoon(1, 100 + WARDEN_RESPAWN_S + 15);
    expect(sim.teamBuffs.boon(1, 100 + WARDEN_RESPAWN_S + 16)!.stacks).toBe(2);
  });

  it('grows with the game clock, so a late Warden is not a free Boon', () => {
    const opener = new Sim(11);
    const early = runToFirstSpawn(opener);
    const late = new Sim(11);
    late.time = WARDEN_FIRST_SPAWN_S; // the real first spawn moment
    for (let i = 0; i < 3 && !findWarden(late); i++) late.tick();
    const w = findWarden(late)!;
    expect(w.maxHp).toBe(Math.round(WARDEN_BODY.hp * bodyGrowth(WARDEN_FIRST_SPAWN_S)));
    expect(w.maxHp).toBeGreaterThan(early.maxHp + 500);
  });

  it('spawns on the clock at the first pit, neutral and visible to both teams', () => {
    const sim = new Sim(11);
    expect(sim.objectiveSpawnAt()).toBe(WARDEN_FIRST_SPAWN_S);
    const w = runToFirstSpawn(sim);
    expect(w.neutral).toBe(true);
    const pit = GAME_MAP.wardenPits[0]!;
    expect(Math.hypot(w.pos.x - pit.x, w.pos.z - pit.z)).toBeLessThan(2);
    expect(sim.isVisible(0, w.id)).toBe(true);
    expect(sim.isVisible(1, w.id)).toBe(true);
    expect(sim.objectiveSpawnAt()).toBeNull();
  });

  it('pays the killing team the Boon, gold, and starts the respawn clock', () => {
    const sim = new Sim(11);
    const w = runToFirstSpawn(sim);
    const slayer = sim.addChampion(1, { x: w.pos.x + 2, z: w.pos.z });
    const goldBefore = slayer.gold;
    // Mid-fight state: nearly dead and recently hit (a calm hurt Warden
    // would leash-reset to full before the killing blow).
    w.hp = 1;
    w.lastDamagedAt = sim.time;
    sim.orderAttack(slayer.id, w.id);
    for (let i = 0; i < 100 && findWarden(sim); i++) sim.tick();
    expect(findWarden(sim)).toBeUndefined();
    const boon = sim.teamBuff(1);
    expect(boon).not.toBeNull();
    expect(boon!.stacks).toBe(1);
    expect(sim.teamBuff(0)).toBeNull();
    expect(slayer.gold - goldBefore).toBeGreaterThanOrEqual(150);
    const nextAt = sim.objectiveSpawnAt();
    expect(nextAt).not.toBeNull();
    expect(nextAt! - sim.time).toBeGreaterThan(WARDEN_RESPAWN_S - 6);
    // The next spawn uses the OTHER pit.
    for (let i = 0; i < (WARDEN_RESPAWN_S + 2) * TICKS_PER_S && !findWarden(sim); i++) sim.tick();
    const second = findWarden(sim);
    expect(second).toBeDefined();
    const pit1 = GAME_MAP.wardenPits[1]!;
    expect(Math.hypot(second!.pos.x - pit1.x, second!.pos.z - pit1.z)).toBeLessThan(2);
  });

  it('the Boon amplifies the team damage output', () => {
    const damageDealt = (withBoon: boolean): number => {
      const sim = new Sim(11);
      const a = sim.addChampion(0, { x: 75, z: 75 });
      const b = sim.addChampion(1, { x: 78, z: 75 });
      if (withBoon) sim.teamBuffs.grantBoon(0, sim.time);
      sim.orderAttack(a.id, b.id);
      for (let i = 0; i < 60; i++) sim.tick();
      return b.maxHp - b.hp;
    };
    const base = damageDealt(false);
    const boosted = damageDealt(true);
    expect(boosted).toBeGreaterThan(base * (1 + BOON_DAMAGE_PER_STACK * 0.5));
  });

  it('resets to full at its pit when left alone after a fight', () => {
    const sim = new Sim(11);
    const w = runToFirstSpawn(sim);
    w.hp = w.maxHp - 600;
    w.lastDamagedAt = sim.time;
    for (let i = 0; i < 8 * TICKS_PER_S; i++) sim.tick();
    expect(w.hp).toBe(w.maxHp);
    const pit = GAME_MAP.wardenPits[0]!;
    expect(Math.hypot(w.pos.x - pit.x, w.pos.z - pit.z)).toBeLessThan(2);
  });

  it('retaliates against a champion that damages it', () => {
    const sim = new Sim(11);
    const w = runToFirstSpawn(sim);
    const diver = sim.addChampion(0, { x: w.pos.x + 2, z: w.pos.z });
    sim.orderAttack(diver.id, w.id);
    let retaliated = false;
    for (let i = 0; i < 6 * TICKS_PER_S && !retaliated; i++) {
      sim.tick();
      if (w.attackTargetId === diver.id) retaliated = true;
    }
    expect(retaliated).toBe(true);
  });
});
