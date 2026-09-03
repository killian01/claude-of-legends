// Phase 8 rails: the per-account daily quotas over the store's
// append-only event table, the blanket per-address API rate limit, and
// the configurable draft cap.

import { describe, expect, it } from 'vitest';
import { ApiLimiter } from '../server/api_limit';
import { saveDraft } from '../server/forge';
import { ForgeStore } from '../server/forge_store';
import { checkQuota, DAY_MS, type QuotaDeps, spendQuota } from '../server/quotas';
import { FORGED_TWINS } from './forged_twins';

describe('daily quotas', () => {
  it('counts a rolling day, refuses at the limit, frees as events age out', () => {
    const store = new ForgeStore(':memory:');
    try {
      let clock = 1_000_000;
      const deps: QuotaDeps = { store, limits: { generation: 2 }, now: () => clock };
      expect(checkQuota(deps, 1, 'generation')).toMatchObject({ ok: true, used: 0, limit: 2 });
      spendQuota(deps, 1, 'generation');
      spendQuota(deps, 1, 'generation');
      const full = checkQuota(deps, 1, 'generation');
      expect(full.ok).toBe(false);
      // Another account has its own meter.
      expect(checkQuota(deps, 2, 'generation').ok).toBe(true);
      // A day later the oldest events no longer count.
      clock += DAY_MS + 1;
      expect(checkQuota(deps, 1, 'generation')).toMatchObject({ ok: true, used: 0 });
      // Pruned events change no answer: they were already out of window.
      expect(store.pruneQuotaEvents(clock - DAY_MS)).toBe(2);
      expect(checkQuota(deps, 1, 'generation')).toMatchObject({ ok: true, used: 0 });
    } finally {
      store.close();
    }
  });

  it('a zero limit disables the meter', () => {
    const store = new ForgeStore(':memory:');
    try {
      const deps: QuotaDeps = { store, limits: { generation: 0 }, now: () => 1 };
      expect(checkQuota(deps, 1, 'generation').ok).toBe(true);
      spendQuota(deps, 1, 'generation');
      // Nothing was even recorded: off means off.
      expect(store.quotaCountSince(1, 'generation', 0)).toBe(0);
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
