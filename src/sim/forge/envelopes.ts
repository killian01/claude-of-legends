// The three envelopes (CONTEXT.md, ADR 0015): the power budget is their
// sum, and points never cross between them. A light kit buys no stat
// room, a bare body buys no spell room. Each envelope is sized to the
// roster's maximum in its category with no margin, so a forged champion
// with every envelope full is the roster's equal and never its better
// (tests/forge.test.ts pins every roster twin inside each one, and the
// priciest twin within five percent of its line).

import type { BudgetBreakdown } from './budget';

export const STAT_ENVELOPE = 190;
export const GROWTH_ENVELOPE = 90;
export const KIT_ENVELOPE = 820;

export type EnvelopeKey = 'stats' | 'growth' | 'kit';

export const ENVELOPE_KEYS: readonly EnvelopeKey[] = ['stats', 'growth', 'kit'];

export const ENVELOPES: Record<EnvelopeKey, number> = {
  stats: STAT_ENVELOPE,
  growth: GROWTH_ENVELOPE,
  kit: KIT_ENVELOPE,
};

export const ENVELOPE_LABELS: Record<EnvelopeKey, string> = {
  stats: 'Stat envelope',
  growth: 'Growth envelope',
  kit: 'Kit envelope',
};

// The passive and the four spells together: what the kit envelope holds.
export function kitSpendOf(bill: BudgetBreakdown): number {
  const a = bill.abilities;
  return bill.passive + a.Q + a.W + a.E + a.R;
}

// What each envelope holds today, from the itemized bill.
export function envelopeSpend(bill: BudgetBreakdown): Record<EnvelopeKey, number> {
  return { stats: bill.stats, growth: bill.growth, kit: kitSpendOf(bill) };
}

// One readable violation per envelope over its line, prefixed like the
// single-line error it replaces so every caller reading "power budget:"
// keeps working.
export function envelopeErrors(bill: BudgetBreakdown): string[] {
  const spend = envelopeSpend(bill);
  const errors: string[] = [];
  for (const key of ENVELOPE_KEYS) {
    if (spend[key] > ENVELOPES[key]) {
      errors.push(
        `power budget: ${ENVELOPE_LABELS[key].toLowerCase()} ${spend[key].toFixed(1)} points ` +
          `of ${ENVELOPES[key]}`,
      );
    }
  }
  return errors;
}
