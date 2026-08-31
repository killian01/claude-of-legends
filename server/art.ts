// The 2D art surface of the Forge (plan-forge phase 4, ADR 0010): splash
// art first, then optional per-spell icons, both iterated freely on the
// daily gen2d quota while the champion is a draft. The server owns the
// style blocks (the shared splash style of docs/design/portrait-prompts.md
// and the flat icon template); the player authors only the champion line.
// Candidates append to a per-kind history, the creator picks one, and the
// pick is what finalization seals. Identity arrives already resolved, like
// the rest of the Forge surface (ADR 0006).

import { statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { ForgeOutcome } from './forge';
import type { ForgedRow, ForgeStore } from './forge_store';
import type { PipelineDeps } from './generation/pipeline';
import { GenerationError, type ProviderAsset } from './generation/provider';
import { checkQuota, type QuotaDeps, spendQuota } from './quotas';
import { findBlockedWord } from './word_filter';

// The art each champion can carry: the splash, and one icon per spell.
export const ART_KINDS = ['splash', 'icon_Q', 'icon_W', 'icon_E', 'icon_R'] as const;
export type ArtKind = (typeof ART_KINDS)[number];

// Candidates kept per (champion, kind); the oldest unchosen fall off.
export const ART_HISTORY_CAP = 12;
// The player's line inside the prompt; the style block is on top of this.
export const ART_LINE_MAX = 400;

// The shared style block (docs/design/portrait-prompts.md): forged splash
// art reads as part of the same set as the roster's.
export const SPLASH_STYLE =
  'Stylized painted fantasy splash art portrait, 3:4, bold readable silhouette, ' +
  'dramatic rim light, dark moody backdrop with one dominant accent color as ' +
  'atmospheric glow, painterly brushwork, high contrast, game character card art, ' +
  'no text, no watermark.';

// The flat icon template (ADR 0010): deliberately not the painterly splash
// style, because an icon must read at in-match size.
export const ICON_STYLE =
  'Flat game ability icon, one bold centered emblem, simple geometric shapes, ' +
  'strong silhouette, dark rounded-square background, single accent color, crisp ' +
  'edges, high contrast, readable at 32 pixels, no text, no letters, no watermark.';

export interface ArtDeps {
  store: ForgeStore;
  // The same pipeline deps finalize uses: provider, assetsDir, download.
  // Null keeps the surface answering honestly instead of pretending.
  generation: PipelineDeps | null;
  quota: QuotaDeps;
  historyCap?: number;
  // Best-effort file removal for pruned candidates; injectable for tests.
  unlink?: (absPath: string) => void;
  now?: () => number;
}

function isArtKind(kind: string): kind is ArtKind {
  return (ART_KINDS as readonly string[]).includes(kind);
}

// One line of user text inside a prompt: single line, bounded.
function cleanLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim().slice(0, ART_LINE_MAX);
}

// The full prompt the provider sees: always the server's style block plus
// the champion's own line, never raw client text alone.
export function artPrompt(kind: ArtKind, row: ForgedRow, line: string): string {
  if (kind === 'splash') return `${SPLASH_STYLE} The champion: ${line}`;
  const key = kind.slice('icon_'.length) as 'Q' | 'W' | 'E' | 'R';
  const ability = row.def.abilities[key];
  const detail = line === '' ? '' : `, ${line}`;
  return `${ICON_STYLE} The ability: ${ability.name}${detail}.`;
}

// The strip the editor renders: every candidate of the draft, oldest
// first, with the current pick flagged. Owner-only: draft art is private
// until finalization puts the sealed splash in the gallery.
export function listArt(
  deps: ArtDeps,
  accountId: number,
  id: string,
): ForgeOutcome<{
  candidates: { cid: number; kind: string; path: string; chosen: boolean; at: number }[];
  quota: { used: number; limit: number };
}> {
  const row = deps.store.getForged(id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  const q = checkQuota(deps.quota, accountId, 'gen2d');
  return {
    ok: true,
    candidates: deps.store
      .listArtCandidates(id)
      .map((c) => ({ cid: c.id, kind: c.kind, path: c.path, chosen: c.chosen, at: c.at })),
    quota: q.ok ? { used: q.used, limit: q.limit } : { used: -1, limit: -1 },
  };
}

// One generation: style block plus the player's line to the provider,
// the file downloaded next to the store, one gen2d quota unit. The quota
// is spent only when the provider actually produced something: a
// technical failure burns nothing (the per-address rate limit bounds
// abuse), which mirrors how finalize treats the generation meter.
export async function generateArt(
  deps: ArtDeps,
  accountId: number,
  req: { id: string; kind: string; line: string },
): Promise<
  ForgeOutcome<{
    candidate: { cid: number; kind: string; path: string; chosen: boolean; at: number };
    quota: { used: number; limit: number };
  }>
> {
  if (!deps.generation) {
    return { ok: false, error: 'generation is not configured on this server yet' };
  }
  if (!isArtKind(req.kind)) return { ok: false, error: 'unknown art kind' };
  const row = deps.store.getForged(req.id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (row.status !== 'draft') {
    return {
      ok: false,
      error: 'a finalized champion is sealed, art included (Reforge comes later)',
    };
  }
  const line = cleanLine(req.line);
  if (req.kind === 'splash' && line === '') {
    return { ok: false, error: 'describe the champion: the splash starts from your words' };
  }
  const blocked = findBlockedWord([line]);
  if (blocked !== null) {
    return { ok: false, error: `pick different words: '${blocked}' cannot go in a prompt` };
  }
  const quota = checkQuota(deps.quota, accountId, 'gen2d');
  if (!quota.ok) return quota;

  const prompt = artPrompt(req.kind, row, line);
  let asset: ProviderAsset;
  try {
    asset = await deps.generation.provider.generate2D({ prompt });
  } catch (err) {
    const blockedGen = err instanceof GenerationError && err.blocked;
    return {
      ok: false,
      error: blockedGen
        ? 'the provider refused this content; rephrase and try again'
        : 'generation failed; nothing was counted against your quota',
    };
  }
  // Provider URLs expire: download NOW, own forever (same rule as the
  // finalize pipeline). Relative paths are stored with forward slashes so
  // they double as URL tails on every platform.
  const rel = `forged/${row.id}/art/${req.kind}_${asset.taskId}.png`;
  try {
    await deps.generation.download(asset.url, path.join(deps.generation.assetsDir, rel));
  } catch {
    return { ok: false, error: 'the image could not be saved; nothing was counted' };
  }
  // The image budget (ADR 0010) applies to candidates as they land: an
  // oversized file is discarded and costs nothing.
  const limitKb = deps.generation.budgets?.imageKb;
  if (limitKb && limitKb > 0) {
    const abs = path.join(deps.generation.assetsDir, rel);
    if (fileKb(abs) > limitKb) {
      (deps.unlink ?? bestEffortUnlink)(abs);
      return { ok: false, error: 'the image came back over the size budget; try again' };
    }
  }
  const at = (deps.now ?? Date.now)();
  const cid = deps.store.addArtCandidate({
    forgedId: row.id,
    accountId,
    kind: req.kind,
    prompt,
    path: rel,
    provenance: asset.provenance,
    at,
  });
  // The first candidate of a kind becomes the pick outright: the common
  // case is one good generation, not a comparison shop.
  if (!deps.store.chosenArt(row.id, req.kind)) {
    deps.store.chooseArtCandidate(row.id, req.kind, cid);
  }
  spendQuota(deps.quota, accountId, 'gen2d');
  const cap = deps.historyCap ?? ART_HISTORY_CAP;
  const unlink = deps.unlink ?? bestEffortUnlink;
  for (const stale of deps.store.pruneArtCandidates(row.id, req.kind, cap)) {
    unlink(path.join(deps.generation.assetsDir, stale));
  }
  const after = checkQuota(deps.quota, accountId, 'gen2d');
  const chosen = deps.store.getArtCandidate(cid);
  return {
    ok: true,
    candidate: { cid, kind: req.kind, path: rel, chosen: chosen?.chosen ?? false, at },
    quota: after.ok ? { used: after.used, limit: after.limit } : { used: -1, limit: -1 },
  };
}

// The creator's pick among the candidates; what finalization will seal.
export function chooseArt(
  deps: ArtDeps,
  accountId: number,
  req: { id: string; cid: number },
): ForgeOutcome {
  const row = deps.store.getForged(req.id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (row.status !== 'draft') {
    return {
      ok: false,
      error: 'a finalized champion is sealed, art included (Reforge comes later)',
    };
  }
  const candidate = deps.store.getArtCandidate(req.cid);
  if (!candidate || candidate.forgedId !== row.id) {
    return { ok: false, error: 'no such candidate on this champion' };
  }
  deps.store.chooseArtCandidate(row.id, candidate.kind, candidate.id);
  return { ok: true };
}

// A deleted draft takes its candidate files with it.
export function deleteArtFor(deps: ArtDeps, id: string): void {
  const unlink = deps.unlink ?? bestEffortUnlink;
  for (const rel of deps.store.deleteArtCandidates(id)) {
    if (deps.generation) unlink(path.join(deps.generation.assetsDir, rel));
  }
}

// The one splash path a champion currently shows, if any: the sealed one
// for a finalized champion (with the chosen candidate as the fallback for
// rows finalized before splash art existed), the chosen candidate for a
// draft. Relative to the assets dir; the client turns it into an asset URL.
export function splashOf(store: ForgeStore, row: ForgedRow): string | null {
  if (row.status === 'finalized') {
    const assets = store.forgedAssets(row.id) as { splash?: string } | null;
    if (assets?.splash) return assets.splash;
  }
  return store.chosenArt(row.id, 'splash')?.path ?? null;
}

// The chosen per-spell icons, keyed by slot, for finalization to seal.
export function chosenIcons(store: ForgeStore, id: string): Record<string, string> {
  const icons: Record<string, string> = {};
  for (const key of ['Q', 'W', 'E', 'R']) {
    const pick = store.chosenArt(id, `icon_${key}`);
    if (pick) icons[key] = pick.path;
  }
  return icons;
}

function bestEffortUnlink(absPath: string): void {
  try {
    unlinkSync(absPath);
  } catch {}
}

// File size in kilobytes, for the per-champion asset budgets; -1 when the
// file cannot be measured.
export function fileKb(absPath: string): number {
  try {
    return statSync(absPath).size / 1024;
  } catch {
    return -1;
  }
}
