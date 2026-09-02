// The three envelopes (ADR 0013): the power budget is their sum, each is
// sized to the roster's maximum in its category, and points never cross
// between them. The roster is the calibration set: every twin fits every
// envelope, and the priciest twin in each sits within five percent of
// its line.

import { describe, expect, it } from 'vitest';
import { BASE_STAT_BOUNDS, GROWTH_BOUNDS } from '../src/sim/forge/bounds';
import { budgetOf, POWER_BUDGET } from '../src/sim/forge/budget';
import {
  ENVELOPE_KEYS,
  ENVELOPES,
  envelopeErrors,
  envelopeSpend,
  GROWTH_ENVELOPE,
  KIT_ENVELOPE,
  STAT_ENVELOPE,
} from '../src/sim/forge/envelopes';
import { freshDraftDef } from '../src/sim/forge/fresh_draft';
import { validateForged } from '../src/sim/forge/validate';
import { FORGED_TWINS } from './forged_twins';

describe('the envelopes', () => {
  it('sum to the power budget line', () => {
    expect(STAT_ENVELOPE + GROWTH_ENVELOPE + KIT_ENVELOPE).toBe(POWER_BUDGET);
  });

  it('hold every roster twin, with the priciest within five percent of each line', () => {
    const most = { stats: 0, growth: 0, kit: 0 };
    for (const twin of FORGED_TWINS) {
      const spend = envelopeSpend(budgetOf(twin));
      for (const key of ENVELOPE_KEYS) {
        expect(spend[key], `${twin.id} ${key}`).toBeLessThanOrEqual(ENVELOPES[key]);
        most[key] = Math.max(most[key], spend[key]);
      }
    }
    for (const key of ENVELOPE_KEYS) {
      expect(most[key], key).toBeGreaterThan(0.95 * ENVELOPES[key]);
    }
  });

  it('never let a light kit buy stat room: every rail on a bare kit fails the stat envelope', () => {
    const def = freshDraftDef('forged_rails');
    for (const key of Object.keys(BASE_STAT_BOUNDS) as (keyof typeof BASE_STAT_BOUNDS)[]) {
      def.base[key] = BASE_STAT_BOUNDS[key].max;
    }
    // A kit as light as the dial's floor: under the old single line this
    // body fit with points to spare.
    const errors = envelopeErrors(budgetOf(def));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('stat envelope');
    const v = validateForged(def);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.some((e) => e.startsWith('power budget: stat envelope'))).toBe(true);
  });

  it('report each envelope over its line on its own', () => {
    const def = freshDraftDef('forged_rails');
    for (const key of Object.keys(GROWTH_BOUNDS) as (keyof typeof GROWTH_BOUNDS)[]) {
      def.growth[key] = GROWTH_BOUNDS[key].max;
    }
    const errors = envelopeErrors(budgetOf(def));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('growth envelope');
    expect(errors[0]).toContain(String(GROWTH_ENVELOPE));
  });
});
