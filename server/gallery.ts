// The gallery (plan-forge phase 7): the public browse space over finalized
// forged champions, likes, reports with automatic takedown, and the
// creator's two switches (gallery listing, "others may play it"). Policy
// lives here; server/forge_store.ts only stores. Identity arrives already
// resolved, like the rest of the Forge surface (ADR 0006).

import type { ForgedDisplay } from '../src/sim/forge/display';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { validateForged } from '../src/sim/forge/validate';
import { iconsOf, splashOf } from './art';
import { displayOf, modelPointers } from './display';
import type { ForgeOutcome } from './forge';
import type { ForgedRow, ForgeStore } from './forge_store';

// Distinct accounts reporting one champion before it is taken down pending
// review, and its creator warned. Server-configurable (plan phase 8).
export const REPORT_TAKEDOWN_THRESHOLD = 3;
const REPORT_REASON_MAX = 300;

export interface GalleryDeps {
  store: ForgeStore;
  reportThreshold?: number;
  now?: () => number;
}

// One gallery card: the definition rides along because the browse space
// doubles as the test-drive and community-select source of truth.
export interface GalleryEntry {
  id: string;
  def: ForgedChampionDef;
  creator: string;
  likes: number;
  likedByMe: boolean;
  // The viewer owns this champion; the creator switches ride only on own rows.
  mine: boolean;
  listed: boolean;
  shared: boolean;
  // Whether the stored definition still clears the validator: a champion
  // sealed before a rule tightening (ADR 0015) may not, and then it can
  // reach no match until its owner unseals, retunes, and seals it again.
  // Only the owner sees such a row; to everyone else it is gone.
  valid: boolean;
  updatedAt: number;
  // Sealed asset paths relative to the assets dir (null while absent); the
  // client prefixes its asset route. splash draws the card, model feeds
  // the workshop view and the in-match renderer, family and display drive
  // the weapon prop and the saved model tuning.
  splash: string | null;
  model: string | null;
  family: string | null;
  weapon: string | null;
  clips: Record<string, string> | null;
  // Per-role animation-only files riding beside a rigged model (the
  // per-clip bake architecture); null for pre-split single-file models.
  clipFiles: Record<string, string> | null;
  display: ForgedDisplay | null;
  // The chosen spell icon per slot (Q W E R), for the HUD of a test drive
  // from the card; empty when none was chosen.
  icons: Record<string, string>;
}

export type GallerySort = 'recent' | 'popular';

export interface GalleryQuery {
  sort?: GallerySort;
  // Case-insensitive substring over name, title, and creator.
  q?: string;
  // Only champions others may play (the community tab at Forge-queue
  // select); own unlisted rows drop out too, the tab is a public space.
  playable?: boolean;
}

// Whether this account may take a forged champion into a match (the Forge
// queue's resolver rule): the owner always may; anyone else needs the
// champion shared and standing (game definition: "others may play it").
export function canPlayForged(row: ForgedRow, accountId: number): boolean {
  if (row.status !== 'finalized' || row.takenDown) return false;
  return row.accountId === accountId || row.shared;
}

export function listGallery(
  deps: GalleryDeps,
  accountId: number,
  query: GalleryQuery = {},
): ForgeOutcome<{ entries: GalleryEntry[] }> {
  const liked = deps.store.likedIds(accountId);
  const needle = (query.q ?? '').trim().toLowerCase();
  const rows = deps.store
    .listFinalized()
    .map((r) => ({ ...r, valid: validateForged(r.def).ok }))
    // A champion that no longer validates is nobody's to play (the Forge
    // queue's resolver refuses it too); it stays visible to its owner
    // alone, flagged, so the reforge is one click away.
    .filter((r) => r.valid || (!query.playable && r.accountId === accountId))
    .filter((r) => (query.playable ? r.shared && r.listed : r.listed || r.accountId === accountId))
    .filter(
      (r) =>
        needle === '' ||
        r.def.name.toLowerCase().includes(needle) ||
        r.def.title.toLowerCase().includes(needle) ||
        r.def.creator.toLowerCase().includes(needle),
    );
  const entries = rows.map((r): GalleryEntry => {
    const assets = deps.store.forgedAssets(r.id) as Record<string, unknown> | null;
    const pointers = modelPointers(assets);
    const a = assets as { family?: string; weapon?: string } | null;
    return {
      id: r.id,
      def: r.def,
      creator: r.def.creator,
      likes: r.likes,
      likedByMe: liked.has(r.id),
      mine: r.accountId === accountId,
      listed: r.listed,
      shared: r.shared,
      valid: r.valid,
      updatedAt: r.updatedAt,
      splash: splashOf(deps.store, r),
      model: pointers.model,
      family: a?.family ?? null,
      weapon: a?.weapon ?? null,
      clips: pointers.clips,
      clipFiles: pointers.clipFiles,
      display: displayOf(deps.store, r.id),
      icons: iconsOf(deps.store, r.id),
    };
  });
  // listFinalized comes back recent-first already; popular re-sorts by
  // likes with recency as the tiebreak.
  if (query.sort === 'popular') {
    entries.sort((a, b) => b.likes - a.likes || b.updatedAt - a.updatedAt);
  }
  return { ok: true, entries };
}

export function toggleLike(
  deps: GalleryDeps,
  accountId: number,
  id: string,
  on: boolean,
): ForgeOutcome<{ likes: number }> {
  const row = deps.store.getForged(id);
  if (row?.status !== 'finalized' || row.takenDown) {
    return { ok: false, error: 'no such champion in the gallery' };
  }
  deps.store.setLike(accountId, id, on, (deps.now ?? Date.now)());
  return { ok: true, likes: deps.store.likeCount(id) };
}

// A report from a distinct account counts once; at the threshold the
// champion is taken down pending review and its creator takes a warning.
// Reporting your own champion is refused (removal is the listed switch).
export function reportForged(
  deps: GalleryDeps,
  accountId: number,
  id: string,
  reason: string,
): ForgeOutcome<{ takenDown: boolean }> {
  const row = deps.store.getForged(id);
  if (row?.status !== 'finalized' || row.takenDown) {
    return { ok: false, error: 'no such champion in the gallery' };
  }
  if (row.accountId === accountId) {
    return { ok: false, error: 'you cannot report your own champion; unlist it instead' };
  }
  const text = reason.trim().slice(0, REPORT_REASON_MAX);
  if (text === '') return { ok: false, error: 'a report needs a reason' };
  const at = (deps.now ?? Date.now)();
  deps.store.addReport(accountId, id, text, at);
  const threshold = deps.reportThreshold ?? REPORT_TAKEDOWN_THRESHOLD;
  if (deps.store.reportCount(id) < threshold) return { ok: true, takenDown: false };
  deps.store.setTakenDown(id, true);
  deps.store.addWarning(row.accountId, id, `taken down after ${threshold} reports`, at);
  return { ok: true, takenDown: true };
}

// The creator's switches, owner-only and finalized-only (a draft is not in
// the gallery to begin with).
export function setVisibility(
  deps: GalleryDeps,
  accountId: number,
  id: string,
  fields: { listed?: boolean; shared?: boolean },
): ForgeOutcome {
  const row = deps.store.getForged(id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (row.status !== 'finalized') {
    return { ok: false, error: 'only a finalized champion has gallery switches' };
  }
  deps.store.setForgedVisibility(id, fields);
  return { ok: true };
}
