// The fresh draft: legal out of the box, inside every envelope and under
// every burst cap with room, and heavy enough that each polygon plays
// from the first drag without any rail coming free. The playtest found a
// placeholder kit so light that every vertex reached its rail with
// budget to spare, which made the polygon decorative; ADR 0015 then found
// its zone alone measured over half a squishy's health.

import { describe, expect, it } from 'vitest';
import { BASE_STAT_BOUNDS, GROWTH_BOUNDS } from '../src/sim/forge/bounds';
import { budgetOf } from '../src/sim/forge/budget';
import { BASICS_BURST_CAP, burstCapOf, burstOf, burstVerdict } from '../src/sim/forge/burst';
import { ENVELOPE_KEYS, ENVELOPES, envelopeSpend } from '../src/sim/forge/envelopes';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { freshDraftDef } from '../src/sim/forge/fresh_draft';
import { validateForged } from '../src/sim/forge/validate';
import { grantStat } from '../src/ui/stat_budget';
import { FORGED_TWINS } from './forged_twins';

function kitCost(def: ForgedChampionDef): number {
  return envelopeSpend(budgetOf(def)).kit;
}

describe('the fresh draft', () => {
  it('is legal out of the box, inside every envelope, with the id it was given', () => {
    const d = freshDraftDef('forged_fresh');
    expect(d.id).toBe('forged_fresh');
    const v = validateForged(d);
    expect(v.ok, v.ok ? '' : v.errors.join('; ')).toBe(true);
    const spend = envelopeSpend(budgetOf(d));
    for (const key of ENVELOPE_KEYS) {
      expect(spend[key], key).toBeLessThanOrEqual(ENVELOPES[key]);
    }
  });

  it('weighs what a roster kit weighs', () => {
    const kits = FORGED_TWINS.map(kitCost);
    const mine = kitCost(freshDraftDef('forged_fresh'));
    expect(mine).toBeGreaterThanOrEqual(Math.min(...kits));
    expect(mine).toBeLessThanOrEqual(Math.max(...kits));
  });

  it('sits under every burst cap with room, an example of the rule and not its edge', () => {
    const d = freshDraftDef('forged_fresh');
    expect(burstVerdict(d).ok).toBe(true);
    const r = burstOf(d);
    for (const key of ['Q', 'W', 'E', 'R'] as const) {
      expect(r.abilities[key], key).toBeLessThan(0.9 * burstCapOf(key));
    }
    expect(r.basics).toBeLessThan(0.9 * BASICS_BURST_CAP);
  });

  it('leaves each polygon a first pull, and no rail without dumping another axis', () => {
    const d = freshDraftDef('forged_fresh');
    const spend = envelopeSpend(budgetOf(d));
    // A vertex that refuses to move on the very first drag reads as broken.
    expect(ENVELOPES.stats - spend.stats).toBeGreaterThan(20);
    expect(ENVELOPES.growth - spend.growth).toBeGreaterThan(10);
    // Every rail at once is far outside the envelope.
    const maxed: ForgedChampionDef = { ...d, base: { ...d.base }, growth: { ...d.growth } };
    for (const key of Object.keys(BASE_STAT_BOUNDS) as (keyof typeof BASE_STAT_BOUNDS)[]) {
      maxed.base[key] = BASE_STAT_BOUNDS[key].max;
    }
    for (const key of Object.keys(GROWTH_BOUNDS) as (keyof typeof GROWTH_BOUNDS)[]) {
      maxed.growth[key] = GROWTH_BOUNDS[key].max;
    }
    const maxedSpend = envelopeSpend(budgetOf(maxed));
    expect(maxedSpend.stats).toBeGreaterThan(ENVELOPES.stats);
    expect(maxedSpend.growth).toBeGreaterThan(ENVELOPES.growth);
    // Attack stops short of its rail on the fresh body; dump health to
    // its floor and the rail comes within reach. A trade, never a gift.
    const pulled: ForgedChampionDef = { ...d, base: { ...d.base } };
    const first = grantStat(pulled, 'base', 'ad', BASE_STAT_BOUNDS.ad.max);
    expect(first).toBeGreaterThan(d.base.ad);
    expect(first).toBeLessThan(BASE_STAT_BOUNDS.ad.max);
    pulled.base.hp = BASE_STAT_BOUNDS.hp.min;
    expect(grantStat(pulled, 'base', 'ad', BASE_STAT_BOUNDS.ad.max)).toBe(BASE_STAT_BOUNDS.ad.max);
  });
});
