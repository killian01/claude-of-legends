// Client glue between the Forge surfaces and the renderer: wherever the
// client learns that a forged champion has a generated model (its own
// drafts, a gallery entry, a match_start payload), this announces it to
// the render registry so the champion plays as its real model instead of
// the procedural figure. One prefix rule lives here: stored paths are
// relative, the asset route serves them.

import { registerForgedModel } from '../render/champions';
import type { ForgedDisplay } from '../sim/forge/display';

export interface ForgedAssetPointers {
  model?: string | null;
  family?: string | null;
  display?: ForgedDisplay | null;
}

export function forgedAssetUrl(rel: string): string {
  return `/api/forge/asset/${rel}`;
}

export function registerForgedAssets(id: string, a: ForgedAssetPointers): void {
  if (!a.model) return;
  registerForgedModel(id, forgedAssetUrl(a.model), {
    display: a.display ?? null,
    family: a.family ?? null,
  });
}
