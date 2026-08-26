// Batch 0 acceptance gate (docs/review/gap-analysis.md): the game must be
// able to END. Pins the three root causes measured by the playability
// review: stuck side-lane minions, missing fountain regen, and unkillable
// towers behind self-annihilating waves.

import { describe, expect, it } from 'vitest';
import { BOTS, DEFAULT_BOT_ID } from '../src/sim/content/bots';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { GAME_MAP } from '../src/sim/content/map';
import { Sim } from '../src/sim/sim';

const laner = BOTS[DEFAULT_BOT_ID]!.policy;

function botMatch(seed: number): Sim {
  const sim = new Sim(seed);
  for (let i = 0; i < 10; i++) {
    const u = sim.addChampion((i % 2) as 0 | 1, undefined, CHAMPION_LIST[i]!.id);
    sim.attachPolicy(u.id, laner);
  }
  return sim;
}

describe('the map never freezes a lane', () => {
  it('keeps every lane waypoint reachable with all structure footprints blocked', () => {
    // The functional invariant behind review F.0: with every tower and
    // Sanctum footprint blocked, a minion must still be able to get within
    // its reach radius of every waypoint.
    const sim = new Sim(21);
    for (const pts of Object.values(GAME_MAP.lanes)) {
      for (const p of pts) {
        const landing = sim.nav.nearestWalkable(p.x, p.z, 4);
        expect(landing, `waypoint ${p.x},${p.z} unreachable`).not.toBeNull();
        if (landing) {
          const d = Math.hypot(landing.x - p.x, landing.z - p.z);
          expect(d, `waypoint ${p.x},${p.z} nearest walkable too far`).toBeLessThan(2.5);
        }
      }
    }
  });

  it('side-lane minions of both teams keep flowing past their tier 1 towers', () => {
    const sim = new Sim(21);
    for (let i = 0; i < 3600; i++) sim.tick();
    for (const spot of [
      { x: 50, z: 137, team: 1 },
      { x: 137, z: 50, team: 1 },
      { x: 100, z: 13, team: 0 },
      { x: 13, z: 100, team: 0 },
    ]) {
      const stacked = [...sim.units.values()].filter(
        (u) =>
          u.kind === 'minion' &&
          u.team === spot.team &&
          Math.hypot(u.pos.x - spot.x, u.pos.z - spot.z) <= 5,
      );
      expect(stacked.length, `minions stacked at ${spot.x},${spot.z}`).toBeLessThan(9);
    }
  });
});

describe('fountain regen', () => {
  it('heals a champion standing at its fountain in seconds, not minutes', () => {
    const sim = new Sim(21);
    const a = sim.addChampion(0);
    a.hp = a.maxHp * 0.2;
    a.mana = 0;
    for (let i = 0; i < 240; i++) sim.tick(); // 12 s
    expect(a.hp / a.maxHp).toBeGreaterThan(0.95);
    expect(a.mana / a.maxMana).toBeGreaterThan(0.95);
  });

  it('does not fast-heal away from the fountain', () => {
    const sim = new Sim(21);
    const a = sim.addChampion(0, { x: 40, z: 40 });
    a.hp = a.maxHp * 0.2;
    for (let i = 0; i < 240; i++) sim.tick();
    expect(a.hp / a.maxHp).toBeLessThan(0.5);
  });
});

describe('waves push', () => {
  it('adds a siege minion every third wave and scales waves over time', () => {
    const sim = new Sim(21);
    // Third wave spawns at t=70; run to 75 s.
    for (let i = 0; i < 1500; i++) sim.tick();
    const minions = [...sim.units.values()].filter((u) => u.kind === 'minion');
    const sieges = minions.filter((u) => u.goldBounty >= 60);
    expect(sieges.length).toBeGreaterThanOrEqual(6);
    // Scaling: a wave-3 melee outgrows the base 455 hp.
    const scaledMelee = minions.some((u) => u.goldBounty === 21 && u.maxHp > 455);
    expect(scaledMelee).toBe(true);
  });
});

describe('a full bot match progresses to an end', () => {
  it('ENDS, destroys towers, reaches ultimates, completes items, stays bounded', {
    timeout: 30000,
  }, () => {
    const sim = botMatch(55);
    let winnerAt: number | null = null;
    // Cap at 25 sim-minutes: the match must conclude on its own inside it.
    for (let i = 0; i < 30000 && winnerAt === null; i++) {
      sim.tick();
      if (sim.winner !== null) winnerAt = i;
    }
    expect(sim.winner, 'the match must END on its own').not.toBeNull();
    const towers = [...sim.units.values()].filter((u) => u.kind === 'tower');
    expect(towers.length, 'towers must fall').toBeLessThan(16);
    const champions = [...sim.units.values()].filter((u) => u.kind === 'champion');
    expect(Math.max(...champions.map((c) => c.level))).toBeGreaterThanOrEqual(6);
    const tier2Owned = champions.some((c) =>
      c.items.some((id) => ['colossus_heart', 'stone_bulwark', 'spirit_ward'].includes(id)),
    );
    expect(tier2Owned, 'some bot completes a tier 2 item').toBe(true);
    const minionCount = [...sim.units.values()].filter((u) => u.kind === 'minion').length;
    expect(minionCount, 'minion population stays bounded').toBeLessThan(170);
  });

  it('different seeds produce different matches', () => {
    const trace = (seed: number): number[] => {
      const sim = botMatch(seed);
      const out: number[] = [];
      for (let i = 0; i < 1200; i++) {
        sim.tick();
        if (i % 200 === 0) {
          let acc = 0;
          for (const u of sim.units.values()) acc += u.pos.x + u.pos.z + u.hp;
          out.push(Math.round(acc));
        }
      }
      return out;
    };
    expect(trace(55)).not.toEqual(trace(77));
  });
});

describe('after victory', () => {
  function winMatch(): { sim: Sim; champ: ReturnType<Sim['addChampion']> } {
    const sim = new Sim(21);
    const champ = sim.addChampion(0, { x: 130, z: 130 });
    for (const u of [...sim.units.values()]) {
      if (u.team === 1 && u.kind === 'tower') sim.units.delete(u.id);
    }
    const sanctum = [...sim.units.values()].find((u) => u.kind === 'sanctum' && u.team === 1)!;
    sanctum.hp = 30;
    sim.orderAttack(champ.id, sanctum.id);
    for (let i = 0; i < 100 && sim.winner === null; i++) sim.tick();
    expect(sim.winner).toBe(0);
    return { sim, champ };
  }

  it('freezes passive gold, respawns, and commands', () => {
    const { sim, champ } = winMatch();
    const goldBefore = champ.gold;
    champ.hp = 0;
    champ.dead = true;
    champ.respawnAt = sim.time + 0.1;
    for (let i = 0; i < 100; i++) sim.tick();
    expect(champ.gold).toBe(goldBefore);
    expect(champ.dead).toBe(true);
    sim.orderMove(champ.id, 75, 75);
    expect(champ.path).toHaveLength(0);
    expect(sim.castAbility(champ.id, 'Q', { x: 75, z: 75 })).toBe(false);
  });
});
