// Combat core gate: mitigation, shields, death, regen, and auto-attacks.

import { describe, expect, it } from 'vitest';
import { mitigationMultiplier } from '../src/sim/combat/damage';
import { CHAMPIONS } from '../src/sim/content/champions';
import { Sim } from '../src/sim/sim';
import { recalcChampion } from '../src/sim/stats';
import { createMinion, type Unit } from '../src/sim/unit';

// Open mid-lane ground, far from towers and jungle walls, and OUTSIDE
// attack range so idle auto-defense does not start a fight on its own.
function duel(): { sim: Sim; a: Unit; b: Unit } {
  const sim = new Sim(11);
  const a = sim.addChampion(0, { x: 75, z: 75 });
  const b = sim.addChampion(1, { x: 84, z: 75 });
  return { sim, a, b };
}

describe('damage pipeline', () => {
  it('mitigates physical by armor and magic by resist', () => {
    const { b } = duel();
    expect(mitigationMultiplier(b, 'physical')).toBeCloseTo(100 / (100 + b.stats.armor), 5);
    expect(mitigationMultiplier(b, 'magic')).toBeCloseTo(100 / (100 + b.stats.mr), 5);
    expect(mitigationMultiplier(b, 'true')).toBe(1);
  });

  it('penetration cuts mitigation and comes from items', () => {
    const { a, b } = duel();
    // Flat pen and percent pen both weaken mitigation; percent applies first.
    expect(mitigationMultiplier(b, 'physical', 18)).toBeGreaterThan(
      mitigationMultiplier(b, 'physical'),
    );
    expect(mitigationMultiplier(b, 'physical', 0, 0.35)).toBeGreaterThan(
      mitigationMultiplier(b, 'physical'),
    );
    a.items.push('sunder_axe');
    recalcChampion(a);
    expect(a.stats.armorPenPct).toBeCloseTo(0.35, 5);
    a.items[a.items.length - 1] = 'void_crystal';
    recalcChampion(a);
    expect(a.stats.mrPenPct).toBeCloseTo(0.35, 5);
    expect(a.stats.armorPenPct).toBe(0);
  });

  it('regenerates hp and mana over time', () => {
    const { sim, a } = duel();
    a.hp = 100;
    a.mana = 100;
    for (let i = 0; i < 20; i++) sim.tick();
    expect(a.hp).toBeCloseTo(100 + a.stats.hpRegen, 1);
    expect(a.mana).toBeCloseTo(100 + a.stats.manaRegen, 1);
  });
});

describe('auto-attacks', () => {
  it('attacks a target in range on the attack speed cadence', () => {
    const { sim, a, b } = duel();
    sim.orderAttack(a.id, b.id);
    let attackEvents = 0;
    for (let i = 0; i < 100; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'attack' && ev.unitId === a.id) attackEvents += 1;
      }
    }
    // Each strike emits the presentation event driving swing animations.
    expect(attackEvents).toBeGreaterThanOrEqual(3);
    // 5 seconds at 0.65 attacks/s: at least 3 bolts have landed.
    const perHit = a.stats.ad * (100 / (100 + b.stats.armor));
    const regenBack = 5 * b.stats.hpRegen;
    expect(b.maxHp - b.hp).toBeGreaterThan(3 * perHit - regenBack - 1);
  });

  it('chases a target that is out of range while the team sees it', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 70, z: 70 });
    const b = sim.addChampion(1, { x: 90, z: 90 });
    // A scout keeps b inside team 0's vision: attack orders only track what
    // the team can see (the blind cross-map chase was a fog leak).
    sim.addChampion(0, { x: 88, z: 88 });
    sim.orderAttack(a.id, b.id);
    const before = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    for (let i = 0; i < 40; i++) sim.tick();
    const after = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    expect(after).toBeLessThan(before);
  });

  it('places a zone at the exact aim point when within cast range', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'elowen');
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    expect(sim.castAbility(a.id, 'W', { x: 78, z: 72 })).toBe(true);
    const zone = [...sim.zones.values()].at(-1)!;
    expect(zone.pos.x).toBeCloseTo(78, 5);
    expect(zone.pos.z).toBeCloseTo(72, 5);
  });

  it('clamps a zone to max range along the aim direction when aimed beyond', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0, { x: 75, z: 75 }, 'elowen');
    a.abilityRanks = { Q: 1, W: 1, E: 1, R: 0 };
    // Aimed 20 away, the veil lands at Elowen's own cast range. Read from
    // the champion rather than written down: what is under test is the
    // clamp, and a balance pass moving the number must not read as a bug
    // in it (the reach pass moved this one from 8 to 8.5).
    const veil = CHAMPIONS.elowen!.abilities.W.castRange;
    expect(sim.castAbility(a.id, 'W', { x: 95, z: 75 })).toBe(true);
    const zone = [...sim.zones.values()].at(-1)!;
    expect(zone.pos.x).toBeCloseTo(75 + veil, 5);
    expect(zone.pos.z).toBeCloseTo(75, 5);
  });

  it('tower shots ramp up against a diving champion', () => {
    const sim = new Sim(11);
    const diver = sim.addChampion(0, { x: 94.5, z: 93 });
    diver.maxHp = 4000;
    diver.hp = 4000;
    const towerId = [...sim.units.values()].find(
      (u) => u.kind === 'tower' && u.team === 1 && Math.hypot(u.pos.x - 93, u.pos.z - 93) < 2,
    )!.id;
    // One shot lands as two damage events (attack damage plus the max
    // health slice), so shots are summed per tick.
    const shots: number[] = [];
    for (let i = 0; i < 140 && shots.length < 3; i++) {
      let total = 0;
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.sourceId === towerId && ev.targetId === diver.id) {
          total += ev.amount;
        }
      }
      if (total > 0) shots.push(total);
    }
    expect(shots.length).toBeGreaterThanOrEqual(3);
    // Each consecutive shot on the same champion hits markedly harder.
    expect(shots[1]!).toBeGreaterThan(shots[0]! * 1.25);
    expect(shots[2]!).toBeGreaterThan(shots[1]! * 1.2);
    // And it hurts a health stack: the first shot alone takes more than the
    // 3 percent of max health the slice is worth at zero heat.
    expect(shots[0]!).toBeGreaterThan(0.03 * diver.maxHp);
  });

  it('a tower shot takes a slice of max health that grows with its heat', () => {
    const sim = new Sim(11);
    const diver = sim.addChampion(0, { x: 94.5, z: 93 });
    diver.maxHp = 4000;
    diver.hp = 4000;
    // The slice is true damage, so it is the only true-typed hit landing.
    const towerId = [...sim.units.values()].find(
      (u) => u.kind === 'tower' && u.team === 1 && Math.hypot(u.pos.x - 93, u.pos.z - 93) < 2,
    )!.id;
    const slices: number[] = [];
    for (let i = 0; i < 140 && slices.length < 3; i++) {
      for (const ev of sim.tick()) {
        if (ev.type !== 'damage' || ev.sourceId !== towerId || ev.targetId !== diver.id) continue;
        if (ev.dtype === 'true') slices.push(ev.amount);
      }
    }
    expect(slices).toHaveLength(3);
    expect(slices[0]!).toBeCloseTo(0.03 * 4000, 5);
    expect(slices[1]!).toBeCloseTo(0.05 * 4000, 5);
    expect(slices[2]!).toBeCloseTo(0.07 * 4000, 5);
  });

  it('a tower takes no slice out of a minion', () => {
    const sim = new Sim(11);
    const towerId = [...sim.units.values()].find(
      (u) => u.kind === 'tower' && u.team === 1 && Math.hypot(u.pos.x - 93, u.pos.z - 93) < 2,
    )!.id;
    const m = createMinion(9001, 0, 'melee', 'mid', { x: 94.5, z: 93 });
    sim.units.set(m.id, m);
    let trueHits = 0;
    let anyHit = 0;
    for (let i = 0; i < 80; i++) {
      for (const ev of sim.tick()) {
        if (ev.type !== 'damage' || ev.sourceId !== towerId || ev.targetId !== m.id) continue;
        anyHit++;
        if (ev.dtype === 'true') trueHits++;
      }
    }
    expect(anyHit).toBeGreaterThan(0);
    expect(trueHits).toBe(0);
  });

  it('a tower switches onto an enemy that damaged an allied champion in range', () => {
    const sim = new Sim(11);
    // Team 1's vulnerable OUTER mid tower stands at (93, 93).
    const tower = [...sim.units.values()].find(
      (u) => u.kind === 'tower' && u.team === 1 && Math.hypot(u.pos.x - 93, u.pos.z - 93) < 2,
    )!;
    const bystander = sim.addChampion(0, { x: 91.5, z: 93 });
    const attacker = sim.addChampion(0, { x: 96.5, z: 93 });
    const victim = sim.addChampion(1, { x: 94.5, z: 93 });
    sim.tick();
    // Locked onto the nearest enemy champion first.
    expect(tower.attackTargetId).toBe(bystander.id);
    // The dive: the farther enemy hits the tower's allied champion.
    victim.lastHitByChampion = attacker.id;
    victim.lastHitAt = sim.time;
    sim.tick();
    expect(tower.attackTargetId).toBe(attacker.id);
  });

  it('kills, emits a death event, and marks the champion dead', () => {
    const { sim, a, b } = duel();
    b.hp = 30;
    sim.orderAttack(a.id, b.id);
    let death = false;
    for (let i = 0; i < 60; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'death' && ev.unitId === b.id) death = true;
      }
      if (death) break;
    }
    expect(death).toBe(true);
    sim.tick();
    // Champions stay in the sim while dead; only non-champions are removed.
    expect(sim.units.has(b.id)).toBe(true);
    expect(b.dead).toBe(true);
    // The attacker drops its order instead of hitting a corpse.
    sim.tick();
    expect(a.attackTargetId).toBeNull();
  });
});
