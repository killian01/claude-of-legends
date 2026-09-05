// The night coach's gate: the model call is the night's only paid step,
// so it is spent on bots whose owner is still around to read what it
// writes. Everything else about the night (the Arena, the report, the
// briefing window) runs for every deposited bot as before.

import { describe, expect, it } from 'vitest';
import { COACH_IDLE_DAYS, coachEligible } from '../server/night_eligibility';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 30 * DAY;

describe('who the night coach is for', () => {
  it('coaches an owner seen inside the window, up to and including the edge', () => {
    expect(coachEligible(NOW, NOW)).toBe(true);
    expect(coachEligible(NOW - 6 * DAY, NOW)).toBe(true);
    expect(coachEligible(NOW - COACH_IDLE_DAYS * DAY, NOW)).toBe(true);
  });

  it('rests on an owner who has been away longer, by a minute or by a month', () => {
    expect(coachEligible(NOW - COACH_IDLE_DAYS * DAY - 60_000, NOW)).toBe(false);
    expect(coachEligible(NOW - 29 * DAY, NOW)).toBe(false);
  });

  it('takes its own window, and spends nothing on an owner it cannot date', () => {
    expect(coachEligible(NOW - 10 * DAY, NOW, 14)).toBe(true);
    expect(coachEligible(NOW - 2 * DAY, NOW, 1)).toBe(false);
    expect(coachEligible(null, NOW)).toBe(false);
  });

  it('switches off at zero, so a private server coaches every deposited bot', () => {
    expect(coachEligible(NOW - 400 * DAY, NOW, 0)).toBe(true);
    expect(coachEligible(null, NOW, 0)).toBe(true);
    expect(coachEligible(null, NOW, -1)).toBe(true);
  });
});
