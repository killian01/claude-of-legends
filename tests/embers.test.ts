// The one ledger and the one unit (ADR 0017): prices read off measurement,
// a weekly grant that rolls over, a crossing that carries standing
// creation balances once and never twice, and a refusal that says both
// numbers rather than stopping someone at a wall with no figure on it.

import { describe, expect, it } from 'vitest';
import {
  bakePrice,
  CREATION_IN_EMBERS,
  EMBER_PRICES,
  EMBERS_PER_WEEK,
  IMAGE_PRICE_RESOLD,
} from '../server/embers';
import {
  type ForgeDeps,
  migrateCreations,
  refreshWeeklyGrant,
  refundEmbers,
  spendEmbers,
} from '../server/forge';
import { ForgeStore } from '../server/forge_store';

const WEEK = 7 * 24 * 60 * 60 * 1000;

function rig(now: () => number): ForgeDeps {
  return { store: new ForgeStore(':memory:'), now };
}

describe('the ember prices', () => {
  it('are the measured table: a bake by its clips, and free with none', () => {
    // docs/design/generation-costs.md, measured 2026-09-05: 30 credits for
    // a five-clip retarget and 10 for a one-clip one, a credit being a
    // cent and a cent being an ember.
    expect(bakePrice(5)).toBe(30);
    expect(bakePrice(1)).toBe(10);
    // Nothing to bake costs nothing: a bake of house clips alone never
    // touches the provider.
    expect(bakePrice(0)).toBe(0);
    // And every extra clip costs the same as the last: the rule the
    // Forge states on the control instead of hiding.
    expect(bakePrice(3) - bakePrice(2)).toBe(bakePrice(2) - bakePrice(1));
  });

  it('price a whole champion at what one really cost', () => {
    // The first forged champion: a model, its weapon, the rig, a full
    // five-clip bake. 1.95 dollars, measured off its own tasks.
    expect(CREATION_IN_EMBERS).toBe(115);
    // Its seven images, at what they cost the day it was built: Tripo's
    // flat 10 a piece, so 185 for the champion.
    expect(IMAGE_PRICE_RESOLD * 7 + CREATION_IN_EMBERS).toBe(185);
    // And at what they cost now that the 2D is bought where it is made
    // (server/generation/openai_images.ts). The 3D is untouched, so the
    // whole saving is the 2D, which was more than a third of the bill.
    expect(EMBER_PRICES.image * 7 + CREATION_IN_EMBERS).toBe(143);
  });
});

describe('the ledger', () => {
  it('grants a week at a time, rolls the unspent over, and never grants twice', () => {
    let clock = 0;
    const deps = rig(() => clock);
    try {
      refreshWeeklyGrant(deps, 1);
      refreshWeeklyGrant(deps, 1);
      expect(deps.store.creditBalance(1)).toBe(EMBERS_PER_WEEK);
      clock = WEEK - 1;
      refreshWeeklyGrant(deps, 1);
      expect(deps.store.creditBalance(1)).toBe(EMBERS_PER_WEEK);
      // Two quiet weeks buy a champion in the third: rolling over is what
      // makes a small weekly grant liveable.
      clock = WEEK;
      refreshWeeklyGrant(deps, 1);
      clock = 2 * WEEK;
      refreshWeeklyGrant(deps, 1);
      expect(deps.store.creditBalance(1)).toBe(3 * EMBERS_PER_WEEK);
      expect(deps.store.creditBalance(1)).toBeGreaterThan(CREATION_IN_EMBERS);
    } finally {
      deps.store.close();
    }
  });

  it('spends, refuses what it cannot pay for with both numbers, and refunds whole', () => {
    const deps = rig(() => 5);
    try {
      refreshWeeklyGrant(deps, 1);
      const ok = spendEmbers(deps, 1, EMBER_PRICES.model, 'forged_x');
      expect(ok).toEqual({ ok: true, spent: 30, left: EMBERS_PER_WEEK - 30 });
      // A model and a weapon and a rig is more than a week holds.
      const no = spendEmbers(deps, 1, 200, 'forged_x');
      expect(no).toEqual({
        ok: false,
        error: `this costs 200 embers and you have ${EMBERS_PER_WEEK - 30}; the grant refills weekly`,
      });
      // Refused means untouched: no partial debit, no overdraw.
      expect(deps.store.creditBalance(1)).toBe(EMBERS_PER_WEEK - 30);
      refundEmbers(deps, 1, EMBER_PRICES.model, 'forged_x');
      expect(deps.store.creditBalance(1)).toBe(EMBERS_PER_WEEK);
    } finally {
      deps.store.close();
    }
  });

  it('carries a standing creation balance across exactly once', () => {
    const deps = rig(() => 1);
    try {
      // Two creations of the old economy, on the ledger as it stood.
      deps.store.addCreditEntry({ accountId: 1, delta: 3, reason: 'weekly_grant', at: 0 });
      deps.store.addCreditEntry({ accountId: 1, delta: -1, reason: 'finalize', ref: 'x', at: 0 });
      migrateCreations(deps, 1, 1);
      expect(deps.store.creditBalance(1)).toBe(2 * CREATION_IN_EMBERS);
      // Twice would multiply a balance already in embers, so it cannot
      // happen: the crossing's own entry is the record that it did.
      migrateCreations(deps, 1, 2);
      migrateCreations(deps, 1, 3);
      expect(deps.store.creditBalance(1)).toBe(2 * CREATION_IN_EMBERS);
      // A holder is left exactly as able to build as the day before.
      expect(deps.store.creditBalance(1) / CREATION_IN_EMBERS).toBe(2);
    } finally {
      deps.store.close();
    }
  });

  it('marks an empty ledger crossed too, so a new account never multiplies later', () => {
    const deps = rig(() => 1);
    try {
      migrateCreations(deps, 9, 1);
      expect(deps.store.creditBalance(9)).toBe(0);
      refreshWeeklyGrant(deps, 9);
      expect(deps.store.creditBalance(9)).toBe(EMBERS_PER_WEEK);
      // The grant is in embers already and the crossing is behind it.
      migrateCreations(deps, 9, 2);
      expect(deps.store.creditBalance(9)).toBe(EMBERS_PER_WEEK);
    } finally {
      deps.store.close();
    }
  });
});
