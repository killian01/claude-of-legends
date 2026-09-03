// Per-account daily quotas (plan-forge phase 8): a rolling 24 hour window
// counted over the store's append-only quota_events table, so a restart
// forgets nothing and a grant needs no timer. Three metered actions:
// 'generation' is a whole finalize chain (a spend backstop under the
// weekly creation ledger, bounding one day's provider bill); 'gen2d' and
// 'agent' are reserved for the splash iteration and agent surfaces of
// plan phase 4, wired here so their limits exist before they do.

import type { ForgeOutcome } from './forge';
import type { ForgeStore } from './forge_store';

export const DAY_MS = 24 * 60 * 60 * 1000;

export type QuotaAction = 'generation' | 'gen2d' | 'agent';

// Defaults; every one is server-configurable (see main.ts). A limit of
// zero or less switches that meter off entirely (unlimited).
export const QUOTA_DEFAULTS: Readonly<Record<QuotaAction, number>> = {
  generation: 5,
  gen2d: 40,
  agent: 20,
};

export interface QuotaDeps {
  store: ForgeStore;
  limits?: Partial<Record<QuotaAction, number>>;
  now?: () => number;
}

export function quotaLimit(deps: QuotaDeps, action: QuotaAction): number {
  return deps.limits?.[action] ?? QUOTA_DEFAULTS[action];
}

// Whether the account still has room today; no side effect. The caller
// spends only after the metered work actually starts, so a refused
// finalize never burns quota.
export function checkQuota(
  deps: QuotaDeps,
  accountId: number,
  action: QuotaAction,
): ForgeOutcome<{ used: number; limit: number }> {
  const limit = quotaLimit(deps, action);
  if (limit <= 0) return { ok: true, used: 0, limit };
  const at = (deps.now ?? Date.now)();
  const used = deps.store.quotaCountSince(accountId, action, at - DAY_MS);
  if (used >= limit) {
    return { ok: false, error: `daily limit reached (${limit} per day); try again tomorrow` };
  }
  return { ok: true, used, limit };
}

export function spendQuota(deps: QuotaDeps, accountId: number, action: QuotaAction): void {
  if (quotaLimit(deps, action) <= 0) return;
  deps.store.addQuotaEvent(accountId, action, (deps.now ?? Date.now)());
}
