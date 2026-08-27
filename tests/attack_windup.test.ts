// Attack windup gate: an auto-attack is no longer an instant fact. The
// strike is announced (the attack event), winds up for a beat, then lands;
// moving or a stun during the windup cancels the strike and refunds the
// attack timer. This is the anticipation that makes kiting a timed skill
// (orb-walking) and gives autos a visible commitment.

import { describe, expect, it } from 'vitest';
import { attackWindupSeconds } from '../src/sim/combat/auto_attack';
import { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';

// Open mid-lane ground, far from towers; korrath is melee, so strikes land
// directly (no bolt travel muddying the timing).
function meleeDuel(): { sim: Sim; a: Unit; b: Unit } {
  const sim = new Sim(11);
  const a = sim.addChampion(0, { x: 75, z: 75 }, 'korrath');
  const b = sim.addChampion(1, { x: 77, z: 75 }, 'korrath');
  return { sim, a, b };
}

// Runs ticks until the predicate returns true for some event, returning the
// sim time of that event's tick; null if the horizon runs out.
function timeOf(
  sim: Sim,
  horizonTicks: number,
  match: (ev: { type: string; unitId?: number; sourceId?: number }) => boolean,
): number | null {
  for (let i = 0; i < horizonTicks; i++) {
    for (const ev of sim.tick()) {
      if (match(ev)) return sim.time;
    }
  }
  return null;
}

describe('attack windup', () => {
  it('caps the windup below the attack period', () => {
    expect(attackWindupSeconds(0.65)).toBeGreaterThan(0.1);
    expect(attackWindupSeconds(0.65)).toBeLessThan(1 / 0.65);
    expect(attackWindupSeconds(2.5)).toBeLessThan(1 / 2.5);
  });

  it('lands the strike one windup after the attack event, not instantly', () => {
    const { sim, a, b } = meleeDuel();
    sim.orderAttack(a.id, b.id);
    const swingAt = timeOf(sim, 100, (ev) => ev.type === 'attack' && ev.unitId === a.id);
    expect(swingAt).not.toBeNull();
    const hpAtSwing = b.hp;
    const landAt = timeOf(
      sim,
      40,
      (ev) => ev.type === 'damage' && (ev as { sourceId?: number }).sourceId === a.id,
    );
    expect(landAt).not.toBeNull();
    const windup = attackWindupSeconds(a.stats.attackSpeed);
    expect(landAt! - swingAt!).toBeGreaterThanOrEqual(windup - 1e-6);
    expect(landAt! - swingAt!).toBeLessThanOrEqual(windup + DT + 1e-6);
    expect(b.hp).toBeLessThan(hpAtSwing);
  });

  it('moving during the windup cancels the strike and refunds the timer', () => {
    const { sim, a, b } = meleeDuel();
    sim.orderAttack(a.id, b.id);
    const swingAt = timeOf(sim, 100, (ev) => ev.type === 'attack' && ev.unitId === a.id);
    expect(swingAt).not.toBeNull();
    // The move order arrives mid-windup: the strike must never land.
    sim.orderMove(a.id, 60, 75);
    let landed = false;
    for (let i = 0; i < 30; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && (ev as { sourceId?: number }).sourceId === a.id) landed = true;
      }
    }
    expect(landed).toBe(false);
    // Refunded: the attack timer is not burned by the canceled strike.
    expect(a.attackReadyAt).toBeLessThanOrEqual(sim.time);
  });

  it('a blink out of reach makes the committed strike whiff', () => {
    const { sim, a, b } = meleeDuel();
    sim.orderAttack(a.id, b.id);
    const swingAt = timeOf(sim, 100, (ev) => ev.type === 'attack' && ev.unitId === a.id);
    expect(swingAt).not.toBeNull();
    // The target blinks 10 units away mid-windup: far beyond the walk
    // grace, so the strike must land on nothing.
    b.pos = { x: b.pos.x + 10, z: b.pos.z };
    let landed = false;
    for (let i = 0; i < 10; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && (ev as { sourceId?: number }).sourceId === a.id) landed = true;
      }
    }
    expect(landed).toBe(false);
  });

  it('drops the attack order when the target leaves the team vision', () => {
    const { sim, a, b } = meleeDuel();
    sim.orderAttack(a.id, b.id);
    sim.tick();
    expect(a.attackTargetId).toBe(b.id);
    // The target vanishes deep into its own side, far from any team-0 eyes:
    // the order must drop instead of chasing an unseen position.
    b.pos = { x: 115, z: 115 };
    sim.tick();
    sim.tick();
    expect(a.attackTargetId).toBeNull();
  });

  it('a stun during the windup cancels the strike', () => {
    const { sim, a, b } = meleeDuel();
    sim.orderAttack(a.id, b.id);
    const swingAt = timeOf(sim, 100, (ev) => ev.type === 'attack' && ev.unitId === a.id);
    expect(swingAt).not.toBeNull();
    a.statuses.push({ kind: 'stun', until: sim.time + 1 });
    let landedDuringStun = false;
    const horizon = Math.ceil(0.6 / DT);
    for (let i = 0; i < horizon; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && (ev as { sourceId?: number }).sourceId === a.id) {
          landedDuringStun = true;
        }
      }
    }
    expect(landedDuringStun).toBe(false);
    expect(b.hp).toBeGreaterThan(b.maxHp - 1);
  });
});
