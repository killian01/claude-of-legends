// Display tuning for forged champions with a built model (ADR 0010): the
// workshop's adjustments to how the generated model is presented (height,
// facing, ground offset, the weapon prop's grip), stored inside the assets
// blob. Owner-only, model required; the payload is sanitized by the
// shared clamp so a client can never store an unbounded number or an
// unknown prop. Policy lives here; server/forge_store.ts only stores.

import type { ForgedMatchAssets } from '../src/net/protocol';
import { type ForgedDisplay, sanitizeForgedDisplay } from '../src/sim/forge/display';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { iconsOf } from './art';
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
  // A built-but-unsealed draft has a model to tune too: validating the
  // static model in the workshop happens BEFORE it animates and seals.
  const assets = (deps.store.forgedAssets(id) as Record<string, unknown> | null) ?? {};
  if (row.status !== 'finalized' && typeof assets.model !== 'string') {
    return { ok: false, error: 'only a champion with a built model can be tuned' };
  }
  const display = sanitizeForgedDisplay(raw);
  if (!display) return { ok: false, error: 'malformed display tuning' };
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

// The model a client should SHOW for an assets blob: the rigged body from
// the moment the rig step makes one, plus the animation-only clip file
// per role once clips are baked onto it. Showing the skeleton's body as
// soon as it exists is what lets the workshop hang a weapon on a hand
// bone before any animation is chosen. A champion baked before the
// per-clip split (or not yet rigged) keeps its single model and no clip
// files.
export function modelPointers(assets: Record<string, unknown> | null): {
  model: string | null;
  clips: Record<string, string> | null;
  clipFiles: Record<string, string> | null;
} {
  const a = (assets ?? {}) as {
    model?: unknown;
    rigged?: unknown;
    clips?: unknown;
    clipFiles?: unknown;
  };
  const clips =
    typeof a.clips === 'object' && a.clips !== null ? (a.clips as Record<string, string>) : null;
  const clipFiles =
    typeof a.clipFiles === 'object' && a.clipFiles !== null && Object.keys(a.clipFiles).length > 0
      ? (a.clipFiles as Record<string, string>)
      : null;
  // The one exception to preferring the rigged body: a champion baked
  // before the per-clip split carries its clips INSIDE its single model
  // file, so swapping in a clipless rigged body would cost it its
  // animations. It keeps that file until its first re-bake.
  const embedded = clips !== null && clipFiles === null;
  const model =
    typeof a.rigged === 'string' && !embedded
      ? a.rigged
      : typeof a.model === 'string'
        ? a.model
        : null;
  return { model, clips, clipFiles: clipFiles !== null && model === a.rigged ? clipFiles : null };
}

// The match_start forgedAssets block: per forged definition, the sealed
// pointers every client in the match needs to render the generated model,
// and the chosen spell icons its HUD wears.
export function forgedMatchAssets(
  store: ForgeStore,
  defs: readonly ForgedChampionDef[],
): Record<string, ForgedMatchAssets> {
  const out: Record<string, ForgedMatchAssets> = {};
  for (const def of defs) {
    const assets = store.forgedAssets(def.id) as Record<string, unknown> | null;
    const pointers = modelPointers(assets);
    const a = assets as { family?: string; weapon?: string } | null;
    out[def.id] = {
      model: pointers.model,
      family: a?.family ?? null,
      weapon: a?.weapon ?? null,
      clips: pointers.clips,
      clipFiles: pointers.clipFiles,
      display: displayOf(store, def.id),
      icons: iconsOf(store, def.id),
    };
  }
  return out;
}
