// Client glue between the Forge surfaces and the renderer: wherever the
// client learns that a forged champion has a generated model (its own
// drafts, a gallery entry, a match_start payload), this announces it to
// the render registry so the champion plays as its real model instead of
// the procedural figure. One prefix rule lives here: stored paths are
// relative, the asset route serves them.

import { registerForgedModel } from '../render/champions';
import type { ForgedDisplay } from '../sim/forge/display';
import { registerForgedIcons } from '../ui/forged_icons';

export interface ForgedAssetPointers {
  // The chosen spell icon per slot (Q W E R), relative paths; an empty
  // set means none chosen, absent means the source does not carry them.
  icons?: Record<string, string> | null;
  model?: string | null;
  family?: string | null;
  weapon?: string | null;
  // The creator's exact clip pick per renderer role (baked names).
  clips?: Record<string, string> | null;
  // Per-role animation-only GLBs riding beside a rigged model.
  clipFiles?: Record<string, string> | null;
  display?: ForgedDisplay | null;
}

export function forgedAssetUrl(rel: string): string {
  return `/api/forge/asset/${rel}`;
}

// Prefixes every clip-file path with the asset route, role keys intact.
export function forgedClipFileUrls(
  files: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!files) return null;
  return Object.fromEntries(
    Object.entries(files).map(([role, rel]) => [role, forgedAssetUrl(rel)]),
  );
}

export function registerForgedAssets(id: string, a: ForgedAssetPointers): void {
  // Icons stand on their own: a draft with no model yet wears them in a
  // test drive, and the announcement replaces the previous set.
  if (a.icons !== undefined) {
    registerForgedIcons(
      id,
      Object.fromEntries(
        Object.entries(a.icons ?? {}).map(([key, rel]) => [key, forgedAssetUrl(rel)]),
      ),
    );
  }
  if (!a.model) return;
  registerForgedModel(id, forgedAssetUrl(a.model), {
    display: a.display ?? null,
    family: a.family ?? null,
    weapon: a.weapon ? forgedAssetUrl(a.weapon) : null,
    clips: a.clips ?? null,
    clipFiles: forgedClipFileUrls(a.clipFiles),
  });
}
