// Timed statuses on units: slows, roots, shields, and marks. Pure functions
// over the unit's status list; expiry is driven by sim time, never wall-clock.

import type { Unit } from '../unit';

export type Status =
  | { kind: 'slow'; until: number; pct: number }
  | { kind: 'root'; until: number }
  | { kind: 'shield'; until: number; remaining: number }
  | { kind: 'mark'; until: number; stacks: number };

export function expireStatuses(u: Unit, time: number): void {
  if (u.statuses.length === 0) return;
  u.statuses = u.statuses.filter((s) => s.until > time);
}

export function addStatus(u: Unit, s: Status): void {
  u.statuses.push(s);
}

export function isRooted(u: Unit, time: number): boolean {
  return u.statuses.some((s) => s.kind === 'root' && s.until > time);
}

export function slowPct(u: Unit, time: number): number {
  let strongest = 0;
  for (const s of u.statuses) {
    if (s.kind === 'slow' && s.until > time && s.pct > strongest) strongest = s.pct;
  }
  return strongest;
}

export function effectiveMoveSpeed(u: Unit, time: number): number {
  if (isRooted(u, time)) return 0;
  return u.moveSpeed * (1 - slowPct(u, time));
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
