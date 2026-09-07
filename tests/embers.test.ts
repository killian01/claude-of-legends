// The one ledger and the one unit (ADR 0017): prices read off measurement,
// a weekly grant that rolls over, a one-time welcome that puts a first
// champion in reach, a crossing that carries standing
// creation balances once and never twice, and a refusal that says both
// numbers rather than stopping someone at a wall with no figure on it.

import { describe, expect, it } from 'vitest';
import {
  bakePrice,
  CREATION_IN_EMBERS,
  EMBER_PRICES,
  EMBERS_PER_WEEK,
  FIRST_CHAMPION_IN_EMBERS,
  IMAGE_PRICE_RESOLD,
  WELCOME_FLOOR,
  welcomeTopUp,
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
      // The first visit carries the week's grant AND the one-time welcome
      // that puts a first champion in reach.
      expect(deps.store.creditBalance(1)).toBe(WELCOME_FLOOR);
      clock = WEEK - 1;
      refreshWeeklyGrant(deps, 1);
      expect(deps.store.creditBalance(1)).toBe(WELCOME_FLOOR);
      // The weeks after are the weekly grant alone, rolling over: the
      // welcome never comes twice.
      clock = WEEK;
      refreshWeeklyGrant(deps, 1);
      clock = 2 * WEEK;
      refreshWeeklyGrant(deps, 1);
      expect(deps.store.creditBalance(1)).toBe(WELCOME_FLOOR + 2 * EMBERS_PER_WEEK);
      expect(deps.store.creditBalance(1)).toBeGreaterThan(CREATION_IN_EMBERS);
    } finally {
      deps.store.close();
    }
  });

  it('spends, refuses what it cannot pay for with both numbers, and refunds whole', () => {
    const deps = rig(() => 5);
    try {
      refreshWeeklyGrant(deps, 1);
      const start = WELCOME_FLOOR;
      const ok = spendEmbers(deps, 1, EMBER_PRICES.model, 'forged_x');
      expect(ok).toEqual({ ok: true, spent: 30, left: start - 30 });
      // Two whole champions is more than a first week holds.
      const no = spendEmbers(deps, 1, 300, 'forged_x');
      expect(no).toEqual({
        ok: false,
        error: `this costs 300 embers and you have ${start - 30}; the grant refills weekly`,
      });
      // Refused means untouched: no partial debit, no overdraw.
      expect(deps.store.creditBalance(1)).toBe(start - 30);
      refundEmbers(deps, 1, EMBER_PRICES.model, 'forged_x');
      expect(deps.store.creditBalance(1)).toBe(start);
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
      expect(deps.store.creditBalance(9)).toBe(WELCOME_FLOOR);
      // The grant is in embers already and the crossing is behind it.
      migrateCreations(deps, 9, 2);
      expect(deps.store.creditBalance(9)).toBe(WELCOME_FLOOR);
    } finally {
      deps.store.close();
    }
  });
});

describe('the welcome top-up', () => {
  it('puts a new account in reach of exactly one champion, once', () => {
    const clock = 0;
    const deps = rig(() => clock);
    try {
      // A fresh account: the week's grant lands, then the welcome closes
      // the gap to what one whole champion takes, art included.
      refreshWeeklyGrant(deps, 1);
      expect(deps.store.creditBalance(1)).toBe(WELCOME_FLOOR);
      expect(WELCOME_FLOOR).toBeGreaterThan(EMBERS_PER_WEEK);
      // And never again: a second visit in the same week changes nothing,
      // and neither does the next week's grant landing on top.
      refreshWeeklyGrant(deps, 1);
      expect(deps.store.creditBalance(1)).toBe(WELCOME_FLOOR);
    } finally {
      deps.store.close();
    }
  });

  it('gives nothing to an account that already holds enough', () => {
    const deps = rig(() => 0);
    try {
      deps.store.addCreditEntry({ accountId: 2, delta: 500, reason: 'maintainer_grant', at: 0 });
      // Already in embers: the crossing must not multiply this one.
      deps.store.addCreditEntry({ accountId: 2, delta: 0, reason: 'ember_migration', at: 0 });
      refreshWeeklyGrant(deps, 2);
      // The week's grant and not one ember more: the welcome is a floor,
      // never a bonus.
      expect(deps.store.creditBalance(2)).toBe(500 + EMBERS_PER_WEEK);
    } finally {
      deps.store.close();
    }
  });

  it('is never under what a champion really costs', () => {
    // A round number the maintainer chose, held to the truth: if a price
    // rises past it, this fails and the number moves rather than a new
    // account quietly falling short of its first champion.
    expect(WELCOME_FLOOR).toBeGreaterThanOrEqual(FIRST_CHAMPION_IN_EMBERS);
  });

  it('is the shortfall and nothing else', () => {
    expect(welcomeTopUp(0)).toBe(WELCOME_FLOOR);
    expect(welcomeTopUp(EMBERS_PER_WEEK)).toBe(WELCOME_FLOOR - EMBERS_PER_WEEK);
    expect(welcomeTopUp(WELCOME_FLOOR)).toBe(0);
    expect(welcomeTopUp(9999)).toBe(0);
  });
});
