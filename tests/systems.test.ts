// Phase 4 systems gate: waves, minion pushing, tower fire, structure
// protection, economy, respawn, vision, and the win condition.

import { describe, expect, it } from 'vitest';
import { CHAMPIONS } from '../src/sim/content/champions';
import { Sim } from '../src/sim/sim';
import { gainXp } from '../src/sim/stats';
import { isInvulnerable } from '../src/sim/structure_rules';
import { createChampion, createMinion, type Unit } from '../src/sim/unit';

function towersOf(sim: Sim, team: number): Unit[] {
  return [...sim.units.values()].filter((u) => u.kind === 'tower' && u.team === team);
}

function runTicks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

describe('minion waves', () => {
  it('spawns 5 minions per lane per team at the first wave', () => {
    const sim = new Sim(21);
    runTicks(sim, 201);
    const minions = [...sim.units.values()].filter((u) => u.kind === 'minion');
    expect(minions).toHaveLength(30);
    for (const team of [0, 1]) {
      for (const lane of ['top', 'mid', 'bot']) {
        expect(minions.filter((m) => m.team === team && m.lane === lane)).toHaveLength(5);
      }
    }
  });

  it('pushes minions down their lane', () => {
    const sim = new Sim(21);
    runTicks(sim, 400);
    const mid0 = [...sim.units.values()].find(
      (u) => u.kind === 'minion' && u.team === 0 && u.lane === 'mid',
    );
    expect(mid0).toBeDefined();
    if (mid0) expect(mid0.pos.x).toBeGreaterThan(30);
  });
});

describe('towers', () => {
  it('fires at an enemy champion in range', () => {
    const sim = new Sim(21);
    const champ = sim.addChampion(0, { x: 110, z: 110 });
    runTicks(sim, 60);
    expect(champ.maxHp - champ.hp).toBeGreaterThan(250);
  });

  it('deals no damage to a protected inner tower', () => {
    const sim = new Sim(21);
    const inner = towersOf(sim, 1).find(
      (t) => t.structure?.lane === 'mid' && t.structure.tier === 2,
    )!;
    const champ = sim.addChampion(0, { x: 111, z: 111 });
    sim.orderAttack(champ.id, inner.id);
    runTicks(sim, 40);
    expect(inner.hp).toBe(inner.maxHp);
  });

  it('opens protection layer by layer', () => {
    const sim = new Sim(21);
    const t1 = towersOf(sim, 1);
    const outerMid = t1.find((t) => t.structure?.lane === 'mid' && t.structure.tier === 1)!;
    const innerMid = t1.find((t) => t.structure?.lane === 'mid' && t.structure.tier === 2)!;
    const sanctumTowers = t1.filter((t) => t.structure?.lane === 'sanctum');
    const sanctum = [...sim.units.values()].find((u) => u.kind === 'sanctum' && u.team === 1)!;

    expect(isInvulnerable(sim.units, innerMid)).toBe(true);
    expect(isInvulnerable(sim.units, sanctumTowers[0]!)).toBe(true);
    expect(isInvulnerable(sim.units, sanctum)).toBe(true);

    sim.units.delete(outerMid.id);
    expect(isInvulnerable(sim.units, innerMid)).toBe(false);
    expect(isInvulnerable(sim.units, sanctumTowers[0]!)).toBe(true);

    sim.units.delete(innerMid.id);
    expect(isInvulnerable(sim.units, sanctumTowers[0]!)).toBe(false);
    expect(isInvulnerable(sim.units, sanctum)).toBe(true);

    for (const t of sanctumTowers) sim.units.delete(t.id);
    expect(isInvulnerable(sim.units, sanctum)).toBe(false);
  });
});

describe('economy', () => {
  it('pays a champion kill bounty and xp to the killer', () => {
    const sim = new Sim(21);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    const b = sim.addChampion(1, { x: 79, z: 75 });
    b.hp = 1;
    sim.orderAttack(a.id, b.id);
    runTicks(sim, 40);
    expect(b.dead).toBe(true);
    expect(a.gold).toBe(800);
    // 140 kill xp (120 + 20 x level 1) crosses the level 2 threshold (137).
    expect(a.level).toBe(2);
    expect(a.xp).toBe(3);
  });

  it('pays minion bounties on last hit', () => {
    const sim = new Sim(21);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    const m = createMinion(9999, 1, 'melee', 'mid', { x: 77, z: 75 });
    m.hp = 1;
    sim.units.set(m.id, m);
    sim.orderAttack(a.id, m.id);
    runTicks(sim, 40);
    expect(sim.units.has(m.id)).toBe(false);
    expect(a.gold).toBe(521);
    expect(a.xp).toBe(60);
  });

  it('grants passive gold after the opening seconds', () => {
    const sim = new Sim(21);
    const a = sim.addChampion(0);
    runTicks(sim, 300);
    // 5 s of income at the pacing-review rate of 2.5/s.
    expect(a.gold).toBeCloseTo(512.5, 0);
  });

  it('levels up on xp thresholds and grows stats', () => {
    const u = createChampion(1, 0, { x: 0, z: 0 }, CHAMPIONS.sylra!);
    gainXp(u, 280);
    expect(u.level).toBe(2);
    expect(u.maxHp).toBe(570 + 96);
    expect(u.stats.ad).toBe(55);
  });
});

describe('items', () => {
  it('buys at the fountain, applies stats, and upgrades with a discount', () => {
    const sim = new Sim(21);
    const a = sim.addChampion(0);
    expect(sim.buyItem(a.id, 'iron_blade')).toBe(true);
    expect(a.gold).toBe(150);
    expect(a.stats.ad).toBe(62);
    expect(sim.buyItem(a.id, 'warbrand')).toBe(false);
    a.gold = 2000;
    expect(sim.buyItem(a.id, 'warbrand')).toBe(true);
    expect(a.gold).toBe(1050);
    expect(a.items).toEqual(['warbrand']);
    // Base 52 plus Warbrand's 56 on the snowball-review stat line.
    expect(a.stats.ad).toBe(108);
  });

  it('rejects buying away from the fountain or with a full inventory', () => {
    const sim = new Sim(21);
    const a = sim.addChampion(0);
    a.pos = { x: 30, z: 30 };
    expect(sim.buyItem(a.id, 'iron_blade')).toBe(false);
    const fountain = sim.map.fountains[0]!;
    a.pos = { x: fountain.x, z: fountain.z };
    a.gold = 9000;
    a.items = ['heart_gem', 'heart_gem', 'heart_gem', 'heart_gem', 'heart_gem', 'heart_gem'];
    expect(sim.buyItem(a.id, 'iron_blade')).toBe(false);
  });
});

describe('death and respawn', () => {
  it('keeps a dead champion out of play, then revives it at the fountain', () => {
    const sim = new Sim(21);
    const a = sim.addChampion(0, { x: 75, z: 75 });
    const b = sim.addChampion(1, { x: 79, z: 75 });
    b.hp = 1;
    sim.orderAttack(a.id, b.id);
    runTicks(sim, 40);
    expect(b.dead).toBe(true);
    expect(sim.isVisible(0, b.id)).toBe(false);
    sim.orderMove(b.id, 90, 75);
    expect(b.path).toHaveLength(0);
    runTicks(sim, 220);
    expect(b.dead).toBe(false);
    expect(b.hp).toBe(b.maxHp);
    const fountain = sim.map.fountains.find((f) => f.team === 1)!;
    expect(Math.hypot(b.pos.x - fountain.x, b.pos.z - fountain.z)).toBeLessThan(3);
  });
});

describe('fog of war', () => {
  it('hides enemies with no friendly unit nearby and reveals them in sight range', () => {
    const sim = new Sim(21);
    const enemy = sim.addChampion(1, { x: 75, z: 75 });
    sim.tick();
    expect(sim.isVisible(0, enemy.id)).toBe(false);
    sim.addChampion(0, { x: 70, z: 75 });
    sim.tick();
    expect(sim.isVisible(0, enemy.id)).toBe(true);
  });

  it('hides a unit in brush from observers outside that brush', () => {
    const sim = new Sim(21);
    const enemy = sim.addChampion(1, { x: 22, z: 45 });
    const watcher = sim.addChampion(0, { x: 26, z: 45 });
    sim.tick();
    expect(sim.isVisible(0, enemy.id)).toBe(false);
    watcher.pos = { x: 23, z: 45 };
    sim.tick();
    expect(sim.isVisible(0, enemy.id)).toBe(true);
  });
});

describe('win condition', () => {
  it('destroying the enemy Sanctum ends the match', () => {
    const sim = new Sim(21);
    const champ = sim.addChampion(0, { x: 130, z: 130 });
    for (const u of [...sim.units.values()]) {
      if (u.team === 1 && u.kind === 'tower') sim.units.delete(u.id);
    }
    const sanctum = [...sim.units.values()].find((u) => u.kind === 'sanctum' && u.team === 1)!;
    sanctum.hp = 40;
    sim.orderAttack(champ.id, sanctum.id);
    let victory: number | null = null;
    for (let i = 0; i < 100 && victory === null; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'victory') victory = ev.team;
      }
    }
    expect(victory).toBe(0);
    expect(sim.winner).toBe(0);
  });
});

describe('long-run determinism', () => {
  it('two identical sims stay in lockstep through waves and tower fights', () => {
    const run = () => {
      const sim = new Sim(77);
      const samples: number[] = [];
      for (let i = 0; i < 900; i++) {
        sim.tick();
        if (i % 100 === 0) {
          let hp = 0;
          let px = 0;
          for (const u of sim.units.values()) {
            hp += u.hp;
            px += u.pos.x + u.pos.z;
          }
          samples.push(sim.units.size, hp, px);
        }
      }
      return samples;
    };
    expect(run()).toEqual(run());
  });
});
