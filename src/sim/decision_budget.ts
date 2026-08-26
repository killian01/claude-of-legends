// The decision budget (ADR 0003): a token bucket applied IDENTICALLY to
// humans, scripted bots, and future RL agents. Budgeted actions (ability and
// sigil casts) spend a token and apply on the next tick; movement and attack
// intentions are persistent state outside the budget. The headless env must
// reuse this exact module so server and env semantics can never diverge.

import type { Unit } from './unit';

// Both knobs are configurable per deployment; these are the launch values.
export const DECISION_RATE_PER_S = 4;
export const DECISION_CAP = 2;

function refill(u: Unit, time: number): void {
  const elapsed = Math.max(0, time - u.decisionRefillAt);
  u.decisionTokens = Math.min(DECISION_CAP, u.decisionTokens + elapsed * DECISION_RATE_PER_S);
  u.decisionRefillAt = time;
}

export function hasDecisionToken(u: Unit, time: number): boolean {
  refill(u, time);
  return u.decisionTokens >= 1;
}

// Call only after the budgeted action actually succeeded.
export function spendDecisionToken(u: Unit, time: number): void {
  refill(u, time);
  u.decisionTokens = Math.max(0, u.decisionTokens - 1);
}
