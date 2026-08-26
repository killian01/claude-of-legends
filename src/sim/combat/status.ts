// Timed statuses on units and the pure helpers that read them. Expiry is
// driven by sim time, never wall-clock. Champion passives that need per-tick
// hooks are deferred (see docs/design/roster.md); everything here is generic.

import type { DamageType } from '../types';
import type { Unit } from '../unit';

export type Status =
  | { kind: 'slow'; until: number; pct: number }
  | { kind: 'root'; until: number }
  | { kind: 'recall'; until: number }
  | { kind: 'stun'; until: number }
  | { kind: 'taunt'; until: number; sourceId: number }
  | { kind: 'stealth'; until: number }
  | { kind: 'blind'; until: number; factor: number }
  | { kind: 'shield'; until: number; remaining: number }
  | { kind: 'mark'; until: number; stacks: number }
  | { kind: 'dot'; until: number; perSecond: number; sourceId: number; dtype: DamageType }
  | { kind: 'grievous'; until: number; factor: number }
  | {
      kind: 'buff';
      until: number;
      msPct: number;
      asPct: number;
      armor: number;
      mr: number;
    };

export function expireStatuses(u: Unit, time: number): void {
  if (u.statuses.length === 0) return;
  u.statuses = u.statuses.filter((s) => s.until > time);
}

export function addStatus(u: Unit, s: Status): void {
  u.statuses.push(s);
}

function has(u: Unit, kind: Status['kind'], time: number): boolean {
  return u.statuses.some((s) => s.kind === kind && s.until > time);
}

export function isRooted(u: Unit, time: number): boolean {
  return has(u, 'root', time) || has(u, 'stun', time);
}

export function isStunned(u: Unit, time: number): boolean {
  return has(u, 'stun', time);
}

export function isStealthed(u: Unit, time: number): boolean {
  return has(u, 'stealth', time);
}

export function breakStealth(u: Unit): void {
  u.statuses = u.statuses.filter((s) => s.kind !== 'stealth');
}

export function tauntSourceId(u: Unit, time: number): number | null {
  for (const s of u.statuses) {
    if (s.kind === 'taunt' && s.until > time) return s.sourceId;
  }
  return null;
}

export function slowPct(u: Unit, time: number): number {
  let strongest = 0;
  for (const s of u.statuses) {
    if (s.kind === 'slow' && s.until > time && s.pct > strongest) strongest = s.pct;
  }
  return strongest;
}

function buffSum(
  u: Unit,
  time: number,
  pick: (b: { msPct: number; asPct: number; armor: number; mr: number }) => number,
): number {
  let sum = 0;
  for (const s of u.statuses) {
    if (s.kind === 'buff' && s.until > time) sum += pick(s);
  }
  return sum;
}

export function moveSpeedBonusPct(u: Unit, time: number): number {
  return buffSum(u, time, (b) => b.msPct);
}

export function attackSpeedBonusPct(u: Unit, time: number): number {
  return buffSum(u, time, (b) => b.asPct);
}

export function armorBonus(u: Unit, time: number): number {
  return buffSum(u, time, (b) => b.armor);
}

export function mrBonus(u: Unit, time: number): number {
  return buffSum(u, time, (b) => b.mr);
}

export function effectiveMoveSpeed(u: Unit, time: number): number {
  if (isRooted(u, time)) return 0;
  return u.moveSpeed * (1 - slowPct(u, time)) * (1 + moveSpeedBonusPct(u, time));
}

// Sight multiplier from blinds: the strongest (smallest factor) wins.
export function sightFactor(u: Unit, time: number): number {
  let factor = 1;
  for (const s of u.statuses) {
    if (s.kind === 'blind' && s.until > time && s.factor < factor) factor = s.factor;
  }
  return factor;
}

// Healing multiplier from grievous wounds: the strongest reduction wins.
export function healFactor(u: Unit, time: number): number {
  let strongest = 0;
  for (const s of u.statuses) {
    if (s.kind === 'grievous' && s.until > time && s.factor > strongest) strongest = s.factor;
  }
  return 1 - strongest;
}

// Consumes shields oldest-first and returns the damage left after absorption.
export function absorbWithShields(u: Unit, amount: number, time: number): number {
  let left = amount;
  for (const s of u.statuses) {
    if (left <= 0) break;
    if (s.kind !== 'shield' || s.until <= time || s.remaining <= 0) continue;
    const absorbed = Math.min(s.remaining, left);
    s.remaining -= absorbed;
    left -= absorbed;
  }
  if (left !== amount)
    u.statuses = u.statuses.filter((s) => s.kind !== 'shield' || s.remaining > 0);
  return left;
}

// Adds one mark stack (refreshing expiry) and reports the new stack count.
export function addMarkStack(u: Unit, duration: number, time: number): number {
  const existing = u.statuses.find((s) => s.kind === 'mark' && s.until > time);
  if (existing && existing.kind === 'mark') {
    existing.stacks += 1;
    existing.until = time + duration;
    return existing.stacks;
  }
  u.statuses.push({ kind: 'mark', until: time + duration, stacks: 1 });
  return 1;
}

export function clearMarks(u: Unit): void {
  u.statuses = u.statuses.filter((s) => s.kind !== 'mark');
}

export function isRecalling(u: Unit, time: number): boolean {
  return u.statuses.some((s) => s.kind === 'recall' && s.until > time);
}

// Any damage or any accepted order cancels a recall channel.
export function cancelRecall(u: Unit): void {
  u.statuses = u.statuses.filter((s) => s.kind !== 'recall');
}
