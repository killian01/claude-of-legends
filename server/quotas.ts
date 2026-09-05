// Per-account daily quotas (plan-forge phase 8): a rolling 24 hour window
// counted over the store's append-only quota_events table, so a restart
// forgets nothing and a grant needs no timer. Four metered actions:
// 'generation' is a whole build chain, model or weapon (a spend backstop
// under the weekly creation ledger, bounding one day's provider bill);
// 'animate' is the clip bake; 'gen2d' and 'agent' meter the 2D art and
// the agent surfaces. Each one is metered twice: per account, and for the
// whole server (CEILING_DEFAULTS below).
//
// Animation has its OWN meter because it is not the same spend and not
// the same act. A build reconstructs geometry from an image; a bake
// retargets an existing rig and downloads an animation-only file, and the
// Creation the player already spent covers it (CONTEXT.md). Sharing the
// build's meter made a kit with per-spell clips impossible to finish in a
// day: five roles plus four spell slots need more bakes than a day's
// builds, and the backstop became a wall on an act that was already paid
// for.

import type { ForgeOutcome } from './forge';
import type { ForgeStore } from './forge_store';

export const DAY_MS = 24 * 60 * 60 * 1000;

export type QuotaAction = 'generation' | 'animate' | 'gen2d' | 'agent';

// Defaults; every one is server-configurable (see main.ts). A limit of
// zero or less switches that meter off entirely (unlimited).
export const QUOTA_DEFAULTS: Readonly<Record<QuotaAction, number>> = {
  generation: 5,
  // Nine bakeable slots (five roles, four spell slots), room to hear each
  // one twice, and still a ceiling on a script.
  animate: 20,
  gen2d: 40,
  agent: 20,
};

// The ceiling the per-account limits cannot give. A limit per account
// bounds one player; nothing bounds the sum of them, so a per-account
// number multiplied by an unbounded number of accounts is an unbounded
// bill. These are the daily totals for the whole server, sized so an
// ordinary day never meets them and a bad one stops at a wall instead of
// at a card. They are a backstop, not a price: what an action actually
// costs belongs on the ledger.
export const CEILING_DEFAULTS: Readonly<Record<QuotaAction, number>> = {
  generation: 60,
  animate: 200,
  gen2d: 400,
  agent: 400,
};

export interface QuotaDeps {
  store: ForgeStore;
  limits?: Partial<Record<QuotaAction, number>>;
  // Server-wide daily totals; like the per-account limits, zero or less
  // switches one off.
  ceilings?: Partial<Record<QuotaAction, number>>;
  now?: () => number;
}

export function quotaLimit(deps: QuotaDeps, action: QuotaAction): number {
  return deps.limits?.[action] ?? QUOTA_DEFAULTS[action];
}

export function quotaCeiling(deps: QuotaDeps, action: QuotaAction): number {
  return deps.ceilings?.[action] ?? CEILING_DEFAULTS[action];
}

// Whether the account still has room today; no side effect. The caller
// spends only after the metered work actually starts, so a refused
// finalize never burns quota.
export function checkQuota(
  deps: QuotaDeps,
  accountId: number,
  action: QuotaAction,
): ForgeOutcome<{ used: number; limit: number }> {
  const at = (deps.now ?? Date.now)();
  // The server's own day, checked first: when the whole server is out,
  // saying so is truer than telling one player they are over a personal
  // limit they have not reached.
  const ceiling = quotaCeiling(deps, action);
  if (ceiling > 0 && deps.store.quotaCountAllSince(action, at - DAY_MS) >= ceiling) {
    return {
      ok: false,
      error: 'the server has spent its day on this; it opens again tomorrow',
    };
  }
  const limit = quotaLimit(deps, action);
  if (limit <= 0) return { ok: true, used: 0, limit };
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
