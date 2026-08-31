// The Forge's server side: draft storage on the account, the creation
// economy, and finalization. Drafts are unlimited and free (CONTEXT.md),
// so the gate here is shape, not balance: a draft must clear the
// validator's structure and bounds (wire safety) but MAY exceed the power
// budget while it is being worked on; only finalization demands a fully
// valid champion. Identity arrives already resolved: the routes in
// main.ts hand these functions the account behind the session cookie
// (ADR 0006), never a raw request.

import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { FORGED_ID_PATTERN, validateForged } from '../src/sim/forge/validate';
import type { ForgedRow, ForgeStore } from './forge_store';
import { familyOf, type PipelineDeps, startFinalize } from './generation/pipeline';
import { findBlockedWord } from './word_filter';

// A hard abuse rail, not the product quota (that is plan phase 8).
export const DRAFT_CAP = 50;
// Bounds the stored JSON; a def inside the validator's structural limits
// sits far under this.
export const DRAFT_JSON_MAX = 32_000;
// The weekly creation allocation (ADR 0011): server-configurable.
export const CREATIONS_PER_WEEK = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ForgeDeps {
  store: ForgeStore;
  // The generation pipeline, when a provider is configured; null keeps
  // the finalize surface answering honestly instead of pretending.
  generation?: PipelineDeps | null;
  creationsGrant?: number;
  now?: () => number;
}

export type ForgeOutcome<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

// The weekly allocation refresh: one grant per rolling week since the
// last, applied lazily wherever the Forge surfaces, so no timer has to
// survive restarts. Unspent creations roll over: the ledger only appends.
export function refreshWeeklyGrant(deps: ForgeDeps, accountId: number): void {
  const at = (deps.now ?? Date.now)();
  const last = deps.store.lastCreditEntryAt(accountId, 'weekly_grant');
  if (last !== null && at - last < WEEK_MS) return;
  deps.store.addCreditEntry({
    accountId,
    delta: deps.creationsGrant ?? CREATIONS_PER_WEEK,
    reason: 'weekly_grant',
    at,
  });
}

export function listDrafts(
  deps: ForgeDeps,
  accountId: number,
): ForgeOutcome<{ drafts: ForgedRow[]; credits: number }> {
  refreshWeeklyGrant(deps, accountId);
  return {
    ok: true,
    drafts: deps.store.listForgedByAccount(accountId),
    credits: deps.store.creditBalance(accountId),
  };
}

export function saveDraft(
  deps: ForgeDeps,
  accountId: number,
  accountName: string,
  def: ForgedChampionDef,
): ForgeOutcome {
  if (typeof def !== 'object' || def === null || typeof def.id !== 'string') {
    return { ok: false, error: 'malformed draft' };
  }
  if (JSON.stringify(def).length > DRAFT_JSON_MAX) {
    return { ok: false, error: 'this draft is too large to store' };
  }
  if (!FORGED_ID_PATTERN.test(def.id)) {
    return { ok: false, error: `draft id must match ${FORGED_ID_PATTERN}` };
  }
  // The creator signature (ADR 0010) is the server's word, not the
  // client's: the account name, stamped on every save.
  def.creator = accountName;
  // Structure and bounds must hold (never store a shape the engine cannot
  // walk); the budget may still be over while drafting.
  const v = validateForged(def);
  if (!v.ok && v.cost === null) {
    return { ok: false, error: `draft rejected: ${v.errors.slice(0, 5).join('; ')}` };
  }
  // The word filter covers every authored string.
  const blocked = findBlockedWord([
    def.name,
    def.title,
    def.tagline,
    def.passive.name,
    ...(['Q', 'W', 'E', 'R'] as const).map((k) => def.abilities[k]?.name ?? ''),
  ]);
  if (blocked !== null) {
    return { ok: false, error: `pick different words: '${blocked}' cannot be on a card` };
  }
  const existing = deps.store.getForged(def.id);
  if (existing && existing.accountId !== accountId) {
    return { ok: false, error: 'this id belongs to another creator' };
  }
  if (existing?.status === 'finalized') {
    return { ok: false, error: 'a finalized champion is sealed (Reforge comes later)' };
  }
  if (!existing && deps.store.listForgedByAccount(accountId).length >= DRAFT_CAP) {
    return { ok: false, error: `draft cap reached (${DRAFT_CAP}); delete one first` };
  }
  const at = (deps.now ?? Date.now)();
  deps.store.saveForged({
    id: def.id,
    accountId,
    def,
    status: 'draft',
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  });
  return { ok: true };
}

export function deleteDraft(deps: ForgeDeps, accountId: number, id: string): ForgeOutcome {
  const existing = deps.store.getForged(id);
  if (!existing || existing.accountId !== accountId) {
    return { ok: false, error: 'no such draft on this account' };
  }
  if (existing.status === 'finalized') {
    return { ok: false, error: 'a finalized champion cannot be deleted here' };
  }
  deps.store.deleteForged(id);
  return { ok: true };
}

// Finalize (plan-forge phase 5): the one gate where EVERYTHING must hold,
// full validation included; the pipeline then debits the creation and
// runs async. The returned `done` promise is for tests and shutdown; the
// HTTP route answers with the job id alone.
export function finalizeDraft(
  deps: ForgeDeps,
  accountId: number,
  id: string,
): ForgeOutcome<{ jobId: number; done: Promise<void> }> {
  if (!deps.generation) {
    return { ok: false, error: 'generation is not configured on this server yet' };
  }
  const row = deps.store.getForged(id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such draft on this account' };
  }
  if (row.status === 'finalized') {
    return { ok: false, error: 'already finalized (Reforge comes later)' };
  }
  const v = validateForged(row.def);
  if (!v.ok) {
    return {
      ok: false,
      error: `finalize needs a fully valid champion: ${v.errors.slice(0, 5).join('; ')}`,
    };
  }
  refreshWeeklyGrant(deps, accountId);
  return startFinalize(deps.generation, {
    def: row.def,
    accountId,
    family: familyOf(row.def),
  });
}

export function finalizeStatus(
  deps: ForgeDeps,
  accountId: number,
  jobId: number,
): ForgeOutcome<{ status: string; stage: string; error: string | null }> {
  const job = deps.store.getGenerationJob(jobId);
  if (!job || job.accountId !== accountId) {
    return { ok: false, error: 'no such job on this account' };
  }
  return { ok: true, status: job.status, stage: job.stage, error: job.error };
}
