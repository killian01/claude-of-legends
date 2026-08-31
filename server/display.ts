// Display tuning for finalized forged champions (ADR 0010): the workshop's
// adjustments to how the generated model is presented (height, facing,
// ground offset, the weapon prop's grip), stored inside the sealed assets
// blob. Owner-only and finalized-only; the payload is sanitized by the
// shared clamp so a client can never store an unbounded number or an
// unknown prop. Policy lives here; server/forge_store.ts only stores.

import type { ForgedMatchAssets } from '../src/net/protocol';
import { type ForgedDisplay, sanitizeForgedDisplay } from '../src/sim/forge/display';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import type { ForgeOutcome } from './forge';
import type { ForgeStore } from './forge_store';

export interface DisplayDeps {
  store: ForgeStore;
  now?: () => number;
}

export function setForgedDisplay(
  deps: DisplayDeps,
  accountId: number,
  id: string,
  raw: unknown,
): ForgeOutcome<{ display: ForgedDisplay }> {
  const row = deps.store.getForged(id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (row.status !== 'finalized') {
    return { ok: false, error: 'only a finalized champion has a model to tune' };
  }
  const display = sanitizeForgedDisplay(raw);
  if (!display) return { ok: false, error: 'malformed display tuning' };
  const assets = (deps.store.forgedAssets(id) as Record<string, unknown> | null) ?? {};
  deps.store.updateForgedAssets(id, { ...assets, display }, (deps.now ?? Date.now)());
  return { ok: true, display };
}

// The display blob as clients should receive it, revalidated on the way
// out so a hand-edited store row cannot ship wild values.
export function displayOf(store: ForgeStore, id: string): ForgedDisplay | null {
  const assets = store.forgedAssets(id) as { display?: unknown } | null;
  if (!assets || assets.display === undefined) return null;
  return sanitizeForgedDisplay(assets.display);
}

// The match_start forgedAssets block: per forged definition, the sealed
// pointers every client in the match needs to render the generated model.
export function forgedMatchAssets(
  store: ForgeStore,
  defs: readonly ForgedChampionDef[],
): Record<string, ForgedMatchAssets> {
  const out: Record<string, ForgedMatchAssets> = {};
  for (const def of defs) {
    const assets = store.forgedAssets(def.id) as { model?: string; family?: string } | null;
    out[def.id] = {
      model: assets?.model ?? null,
      family: assets?.family ?? null,
      display: displayOf(store, def.id),
    };
  }
  return out;
}
