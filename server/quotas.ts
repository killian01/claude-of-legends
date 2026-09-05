// The server's own day (ADR 0017). What one account may spend is the
// ember ledger's business now, in the unit that costs money; these
// counters bound what EVERY account together may ask for in a rolling
// day, which no per-account number can do. A ceiling is a backstop
// against a bad day, never a price.
//
// The per-account half of this file is gone with the ADR. It bounded one
// player in a unit that meant nothing, it could not let a player trade
// one act for another, and it stopped people with a wall that never said
// its number. The events it counted are still written, because the
// ceiling counts them and because they are the record of how often each
// act is asked for.

import type { ForgeOutcome } from './forge';
import type { ForgeStore } from './forge_store';

export const DAY_MS = 24 * 60 * 60 * 1000;

export type QuotaAction = 'generation' | 'animate' | 'gen2d' | 'agent';

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
  // Server-wide daily totals; zero or less switches one off.
  ceilings?: Partial<Record<QuotaAction, number>>;
  now?: () => number;
}

export function quotaCeiling(deps: QuotaDeps, action: QuotaAction): number {
  return deps.ceilings?.[action] ?? CEILING_DEFAULTS[action];
}

// Whether the account still has room today; no side effect. The caller
// spends only after the metered work actually starts, so a refused
// finalize never burns quota.
// Whether the server still has room for this act today; no side effect.
// The account is not consulted: what an account may spend is its ember
// balance, and that is checked where the act is priced.
export function checkQuota(deps: QuotaDeps, action: QuotaAction): ForgeOutcome {
  const ceiling = quotaCeiling(deps, action);
  if (ceiling <= 0) return { ok: true };
  const at = (deps.now ?? Date.now)();
  if (deps.store.quotaCountAllSince(action, at - DAY_MS) >= ceiling) {
    return { ok: false, error: 'the server has spent its day on this; it opens again tomorrow' };
  }
  return { ok: true };
}

// Recorded whatever the ceilings are set to: the count is what the next
// check reads, and what the report reads to say how often an act is asked
// for at all.
export function spendQuota(deps: QuotaDeps, accountId: number, action: QuotaAction): void {
  deps.store.addQuotaEvent(accountId, action, (deps.now ?? Date.now)());
}
