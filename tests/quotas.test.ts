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

  // A bake is not a build: it retargets a rig the Creation already paid
  // for, and a kit with per-spell clips needs more bakes in a day than a
  // day's builds. Sharing one meter made a full kit unfinishable.
  it('meters animation apart from building, each on its own allowance', () => {
    const store = new ForgeStore(':memory:');
    try {
      const deps: QuotaDeps = { store, limits: { generation: 1, animate: 3 }, now: () => 1 };
      spendQuota(deps, 1, 'generation');
      expect(checkQuota(deps, 1, 'generation').ok).toBe(false);
      // The build's meter is full; the bakes still run.
      expect(checkQuota(deps, 1, 'animate')).toMatchObject({ ok: true, used: 0, limit: 3 });
      spendQuota(deps, 1, 'animate');
      spendQuota(deps, 1, 'animate');
      expect(checkQuota(deps, 1, 'animate')).toMatchObject({ ok: true, used: 2 });
      spendQuota(deps, 1, 'animate');
      expect(checkQuota(deps, 1, 'animate').ok).toBe(false);
    } finally {
      store.close();
    }
  });

  // A limit per account bounds one player; nothing bounds the sum of
  // them. The ceiling is the wall a bad day meets instead of a card.
  it('stops the whole server at its own daily ceiling, whoever is asking', () => {
    const store = new ForgeStore(':memory:');
    try {
      let clock = 1_000_000;
      const deps: QuotaDeps = {
        store,
        limits: { gen2d: 10 },
        ceilings: { gen2d: 3 },
        now: () => clock,
      };
      spendQuota(deps, 1, 'gen2d');
      spendQuota(deps, 2, 'gen2d');
      spendQuota(deps, 3, 'gen2d');
      // Nobody is near their own limit, and the server is still out.
      const refused = checkQuota(deps, 4, 'gen2d');
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error).toMatch(/the server has spent its day/);
      // Another action is untouched: the ceilings are per action, because
      // the actions do not cost the same.
      expect(checkQuota(deps, 4, 'generation').ok).toBe(true);
      // And the ceiling ages out on the same rolling day.
      clock += DAY_MS + 1;
      expect(checkQuota(deps, 4, 'gen2d').ok).toBe(true);
    } finally {
      store.close();
    }
  });

  it('a zero ceiling switches the server wall off', () => {
    const store = new ForgeStore(':memory:');
    try {
      const deps: QuotaDeps = { store, limits: { agent: 5 }, ceilings: { agent: 0 }, now: () => 1 };
      for (let i = 0; i < 20; i += 1) spendQuota(deps, i, 'agent');
      expect(checkQuota(deps, 99, 'agent').ok).toBe(true);
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
