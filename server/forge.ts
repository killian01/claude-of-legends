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
import {
  BAKE_BASE,
  BAKE_PER_CLIP,
  CREATION_IN_EMBERS,
  EMBER_PRICES,
  EMBERS_PER_WEEK,
} from './embers';
import type { ForgedRow, ForgeStore } from './forge_store';
import { catalogRoles } from './generation/house_clips';
import {
  familyOf,
  type PipelineDeps,
  startAnimate,
  startModelBuild,
  startWeaponForge,
} from './generation/pipeline';
import {
  CLIP_ROLES,
  type ClipRole,
  SPELL_CLIP_SLOTS,
  type SpellClipSlot,
  WEAPON_FAMILIES,
  type WeaponFamily,
} from './generation/provider';
import { findBlockedWord } from './word_filter';

// A hard abuse rail, not the product quota (that is plan phase 8).
export const DRAFT_CAP = 50;
// Bounds the stored JSON; a def inside the validator's structural limits
// sits far under this.
export const DRAFT_JSON_MAX = 32_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ForgeDeps {
  store: ForgeStore;
  // The generation pipeline, when a provider is configured; null keeps
  // the finalize surface answering honestly instead of pretending.
  generation?: PipelineDeps | null;
  // The weekly ember grant; EMBERS_PER_WEEK when absent.
  emberGrant?: number;
  // The per-account draft ceiling; DRAFT_CAP when absent (phase 8: every
  // number in the plan is server-configurable).
  draftCap?: number;
  now?: () => number;
}

export type ForgeOutcome<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

// The weekly allocation refresh: one grant per rolling week since the
// last, applied lazily wherever the Forge surfaces, so no timer has to
// survive restarts. Unspent embers roll over: the ledger only appends.
export function refreshWeeklyGrant(deps: ForgeDeps, accountId: number): void {
  const at = (deps.now ?? Date.now)();
  migrateCreations(deps, accountId, at);
  const last = deps.store.lastCreditEntryAt(accountId, 'weekly_grant');
  if (last !== null && at - last < WEEK_MS) return;
  deps.store.addCreditEntry({
    accountId,
    delta: deps.emberGrant ?? EMBERS_PER_WEEK,
    reason: 'weekly_grant',
    at,
  });
}

// Standing balances cross over once, on the account's next visit to any
// Forge surface (ADR 0017). The ledger is append-only, so nothing already
// written is touched: one entry lifts the balance from creations to what
// those creations were worth, and its own presence is the record that it
// has happened. An account whose ledger is empty has nothing to carry and
// is marked all the same, so the check stays one row either way.
export function migrateCreations(deps: ForgeDeps, accountId: number, at: number): void {
  if (deps.store.lastCreditEntryAt(accountId, 'ember_migration') !== null) return;
  const held = deps.store.creditBalance(accountId);
  deps.store.addCreditEntry({
    accountId,
    delta: held * CREATION_IN_EMBERS - held,
    reason: 'ember_migration',
    at,
  });
}

// One paid act, debited before the work starts and refunded whole by
// whoever started it if the work fails (ADR 0011 kept that rule, ADR 0017
// only changed the size of the number). Refuses rather than overdraws:
// the balance is the only bound on spend now.
export function spendEmbers(
  deps: ForgeDeps,
  accountId: number,
  embers: number,
  ref: string,
): ForgeOutcome<{ spent: number; left: number }> {
  const at = (deps.now ?? Date.now)();
  migrateCreations(deps, accountId, at);
  if (embers <= 0) return { ok: true, spent: 0, left: deps.store.creditBalance(accountId) };
  const held = deps.store.creditBalance(accountId);
  if (held < embers) {
    return {
      ok: false,
      error: `this costs ${embers} embers and you have ${held}; the grant refills weekly`,
    };
  }
  deps.store.addCreditEntry({ accountId, delta: -embers, reason: 'spend', ref, at });
  return { ok: true, spent: embers, left: held - embers };
}

export function refundEmbers(
  deps: ForgeDeps,
  accountId: number,
  embers: number,
  ref: string,
): void {
  if (embers <= 0) return;
  deps.store.addCreditEntry({
    accountId,
    delta: embers,
    reason: 'refund',
    ref,
    at: (deps.now ?? Date.now)(),
  });
}

export function listDrafts(
  deps: ForgeDeps,
  accountId: number,
): ForgeOutcome<{
  drafts: ForgedRow[];
  embers: number;
  prices: typeof EMBER_PRICES & { bakeBase: number; bakePerClip: number };
}> {
  refreshWeeklyGrant(deps, accountId);
  return {
    ok: true,
    drafts: deps.store.listForgedByAccount(accountId),
    embers: deps.store.creditBalance(accountId),
    // The price list rides with the balance so every surface can put a
    // number on a button rather than behind a refusal (ADR 0017). A bake
    // is priced by its clip count, so it travels as its two numbers and
    // the surface states the rule.
    //
    // The image price is the deployment's, not the table's: two vendors
    // sell that act at different prices now, and sending the table would
    // put 4 on the button of a server that charges 10, which is the
    // refusal this list exists to prevent.
    prices: {
      ...EMBER_PRICES,
      image: deps.generation?.imagePrice ?? EMBER_PRICES.image,
      bakeBase: BAKE_BASE,
      bakePerClip: BAKE_PER_CLIP,
    },
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
    def.passive.flavor ?? '',
    ...(['Q', 'W', 'E', 'R'] as const).flatMap((k) => [
      def.abilities[k]?.name ?? '',
      def.abilities[k]?.flavor ?? '',
    ]),
  ]);
  if (blocked !== null) {
    return { ok: false, error: `pick different words: '${blocked}' cannot be on a card` };
  }
  const existing = deps.store.getForged(def.id);
  if (existing && existing.accountId !== accountId) {
    return { ok: false, error: 'this id belongs to another creator' };
  }
  if (existing?.status === 'finalized') {
    return { ok: false, error: 'this champion is sealed: unseal it in the editor to edit it' };
  }
  const cap = deps.draftCap ?? DRAFT_CAP;
  if (!existing && deps.store.listForgedByAccount(accountId).length >= cap) {
    return { ok: false, error: `draft cap reached (${cap}); delete one first` };
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
    return { ok: false, error: 'a sealed champion cannot be deleted: unseal it first' };
  }
  deps.store.deleteForged(id);
  return { ok: true };
}

// The model build (plan-forge phase 5, first half): the one gate where
// EVERYTHING must hold, full validation included; the pipeline then
// debits the creation and runs async. The row stays a draft: the player
// inspects the static model in the workshop, and animating (the second
// half, below) is what seals. Running it again before the seal is a
// rebuild and spends another creation. The returned `done` promise is
// for tests and shutdown; the HTTP route answers with the job id alone.
export function buildModel(
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
    return { ok: false, error: 'this champion is sealed: unseal it to rebuild the model' };
  }
  const v = validateForged(row.def);
  if (!v.ok) {
    return {
      ok: false,
      error: `the build needs a fully valid champion: ${v.errors.slice(0, 5).join('; ')}`,
    };
  }
  // The splash is the creative anchor (ADR 0010) and the model reference
  // is the image the 3D literally builds from; both are the player's own
  // picks, iterated in the editor. No pick, no build, and no debit
  // either: these gates run before the ledger moves.
  if (!deps.store.chosenArt(id, 'splash')) {
    return { ok: false, error: 'make the splash art first: the champion derives from it' };
  }
  if (!deps.store.chosenArt(id, 'sheet')) {
    return {
      ok: false,
      error: 'generate and pick a model reference: the 3D builds from that exact image',
    };
  }
  refreshWeeklyGrant(deps, accountId);
  return startModelBuild(deps.generation, { def: row.def, accountId });
}

// The second half, always LAST and always the player's own click: rig
// the built model once, bake the picked clips. The creation was spent
// at the build, so this moves the ledger in neither direction and can
// simply run again after a failure. Each role's pick is the player's
// own, validated against the provider's catalog (playtest: not a
// bundle, every animation its own choice); roles the request leaves out
// keep what is already baked, family defaults fill only never-baked
// roles, and the pipeline retargets ONLY the roles that changed
// (playtest round 9: one animation bakes on its own). Animating no
// longer seals: the seal is its own click (server/seal.ts), and a
// SEALED champion may still re-bake any clip freely: the seal locks
// the kit, the art and the model, never the animations.
export function animateChampion(
  deps: ForgeDeps,
  accountId: number,
  id: string,
  family?: string,
  clipsRaw?: unknown,
): ForgeOutcome<{ jobId: number; done: Promise<void> }> {
  if (!deps.generation) {
    return { ok: false, error: 'generation is not configured on this server yet' };
  }
  const row = deps.store.getForged(id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  const assets =
    (deps.store.forgedAssets(id) as { family?: unknown; clips?: unknown } | null) ?? {};
  const storedFamily = typeof assets.family === 'string' ? assets.family : '';
  const picked = (WEAPON_FAMILIES as readonly string[]).includes(family ?? '')
    ? (family as WeaponFamily)
    : (WEAPON_FAMILIES as readonly string[]).includes(storedFamily)
      ? (storedFamily as WeaponFamily)
      : familyOf(row.def);
  const provider = deps.generation.provider;
  // The pickable catalog: the provider's presets plus the house library.
  const choices = catalogRoles(provider);
  // The baseline under the player's picks: what is already baked first
  // (so an untouched role never re-bakes), the family default only for a
  // role that has never been baked at all.
  const baked = (
    typeof assets.clips === 'object' && assets.clips !== null ? assets.clips : {}
  ) as Record<string, unknown>;
  const defaults = provider.clipDefaults(picked);
  const clips = {} as Record<ClipRole, string> & Partial<Record<SpellClipSlot, string>>;
  for (const role of CLIP_ROLES) {
    clips[role] = typeof baked[role] === 'string' ? (baked[role] as string) : defaults[role];
  }
  // Per-spell slots have no default: absent means the shared cast clip.
  // Already-baked slot picks carry over so re-baking a role never drops
  // a spell animation.
  for (const slot of SPELL_CLIP_SLOTS) {
    if (typeof baked[slot] === 'string') clips[slot] = baked[slot] as string;
  }
  if (typeof clipsRaw === 'object' && clipsRaw !== null) {
    for (const role of CLIP_ROLES) {
      const want = (clipsRaw as Record<string, unknown>)[role];
      if (want === undefined) continue;
      // A pick that is not in the catalog is refused loudly, never
      // silently swapped for a default: the player chose it on purpose.
      if (typeof want !== 'string' || !choices[role].some((c) => c.id === want)) {
        return { ok: false, error: `unknown ${role} animation: pick one from the catalog` };
      }
      clips[role] = want;
    }
    // A spell slot draws on the cast AND attack catalogs: a spell may
    // just as well be a strike as an incantation.
    for (const slot of SPELL_CLIP_SLOTS) {
      const want = (clipsRaw as Record<string, unknown>)[slot];
      if (want === undefined) continue;
      const known = (c: { id: string }): boolean => c.id === want;
      if (typeof want !== 'string' || !(choices.cast.some(known) || choices.attack.some(known))) {
        return { ok: false, error: `unknown ${slot} animation: pick one from the catalog` };
      }
      clips[slot] = want;
    }
  }
  return startAnimate(deps.generation, { forgedId: id, accountId, family: picked, clips });
}

// The weapon-only build on a champion whose model exists without one:
// the creation covered the weapon (ADR 0011), so no new debit; once a
// weapon exists, replacing it waits for Reforge.
export function forgeWeapon(
  deps: ForgeDeps,
  accountId: number,
  id: string,
): ForgeOutcome<{ jobId: number; done: Promise<void> }> {
  if (!deps.generation) {
    return { ok: false, error: 'generation is not configured on this server yet' };
  }
  const row = deps.store.getForged(id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  const assets = deps.store.forgedAssets(id) as { model?: string; weapon?: string } | null;
  if (!assets?.model) {
    return { ok: false, error: 'build the 3D model first: the weapon forges alongside it' };
  }
  if (assets.weapon) {
    return {
      ok: false,
      error: 'this champion already has its forged weapon (Reforge comes later)',
    };
  }
  return startWeaponForge(deps.generation, { forgedId: id, accountId });
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
