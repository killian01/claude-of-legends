// Phase 8 rails: the per-account daily quotas over the store's
// append-only event table, the blanket per-address API rate limit, and
// the configurable draft cap.

import { describe, expect, it } from 'vitest';
import { ApiLimiter } from '../server/api_limit';
import { saveDraft } from '../server/forge';
import { ForgeStore } from '../server/forge_store';
import { checkQuota, DAY_MS, type QuotaDeps, spendQuota } from '../server/quotas';
import { FORGED_TWINS } from './forged_twins';

describe('the server’s daily ceilings', () => {
  // What one account may spend is its ember balance now (ADR 0017). What
  // every account together may ask for in a day is this, and nothing else
  // can give it: a per-account number times an unbounded number of
  // accounts is an unbounded bill.
  it('stops the whole server at its ceiling, whoever is asking, and frees it a day later', () => {
    const store = new ForgeStore(':memory:');
    try {
      let clock = 1_000_000;
      const deps: QuotaDeps = { store, ceilings: { gen2d: 3 }, now: () => clock };
      spendQuota(deps, 1, 'gen2d');
      spendQuota(deps, 2, 'gen2d');
      expect(checkQuota(deps, 'gen2d').ok).toBe(true);
      spendQuota(deps, 3, 'gen2d');
      const refused = checkQuota(deps, 'gen2d');
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error).toMatch(/the server has spent its day/);
      // Per action, because the actions do not cost the same.
      expect(checkQuota(deps, 'generation').ok).toBe(true);
      // And it ages out on the same rolling day.
      clock += DAY_MS + 1;
      expect(checkQuota(deps, 'gen2d').ok).toBe(true);
    } finally {
      store.close();
    }
  });

  it('a zero ceiling switches the wall off, and still records every event', () => {
    const store = new ForgeStore(':memory:');
    try {
      const deps: QuotaDeps = { store, ceilings: { agent: 0 }, now: () => 1 };
      for (let i = 0; i < 20; i += 1) spendQuota(deps, i, 'agent');
      expect(checkQuota(deps, 'agent').ok).toBe(true);
      // The events are the record of how often an act is asked for, so
      // they are written whatever the ceiling is set to.
      expect(store.quotaCountAllSince('agent', 0)).toBe(20);
    } finally {
      store.close();
    }
  });
});

describe('the api rate limit', () => {
  it('caps a window per address, frees after it, and forgets idle addresses', () => {
    const limiter = new ApiLimiter(3);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 10)).toBe(true);
    expect(limiter.allow('a', 20)).toBe(true);
    expect(limiter.allow('a', 30)).toBe(false);
    // Another address is unaffected.
    expect(limiter.allow('b', 30)).toBe(true);
    // The window slides: the first hit ages out.
    expect(limiter.allow('a', 60_001)).toBe(true);
    limiter.purge(200_000);
    expect(limiter.trackedAddresses).toBe(0);
  });

  it('zero disables it', () => {
    const limiter = new ApiLimiter(0);
    for (let i = 0; i < 500; i++) expect(limiter.allow('a', i)).toBe(true);
  });
});

describe('the configurable draft cap', () => {
  it('saveDraft refuses past deps.draftCap', () => {
    const store = new ForgeStore(':memory:');
    try {
      const deps = { store, draftCap: 1, now: () => 1 };
      const first = { ...FORGED_TWINS[0]!, id: 'forged_cap_one' };
      const second = { ...FORGED_TWINS[1]!, id: 'forged_cap_two' };
      expect(saveDraft(deps, 1, 'alice', first).ok).toBe(true);
      const refused = saveDraft(deps, 1, 'alice', second);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error).toContain('draft cap reached (1)');
      // Updating the existing draft still works at the cap.
      expect(saveDraft(deps, 1, 'alice', { ...first, tagline: 'again' }).ok).toBe(true);
    } finally {
      store.close();
    }
  });
});
