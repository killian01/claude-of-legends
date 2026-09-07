// The generation pipeline (ADR 0006, plan-forge phase 5), split in two
// player-approved halves, because animation is the LAST step and never a
// side effect: the MODEL BUILD turns the chosen reference into a rigged
// 3D model (classification, image to 3D, the rig, the weapon when one
// was made), which the player then inspects and dresses in the workshop;
// ANIMATE, a separate click, bakes the chosen clips onto that skeleton. The economy is ledger-first (ADR 0007): the build
// debits one creation and refunds it on ANY failure, technical or
// content-blocked; animate and the weapon claim ride the same creation
// and move the ledger in neither direction. Jobs persist in SQLite so a
// crash mid-run is swept on boot: the job fails, and only a build job
// gives its creation back.

import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ForgedChampionDef } from '../../src/sim/forge/forged_def';
import { bakePrice, CREATION_IN_EMBERS, EMBER_PRICES } from '../embers';
import type { ForgeStore } from '../forge_store';
import type { SpendDetail } from '../spend';
import { houseClipFile, isHouseClip } from './house_clips';
import {
  CLIP_ROLES,
  type ClipRole,
  GenerationError,
  type GenerationProvider,
  SPELL_CLIP_SLOTS,
  type SpellClipSlot,
  type WeaponFamily,
} from './provider';

export interface PipelineDeps {
  storage: ForgeStore;
  provider: GenerationProvider;
  // Where downloaded artifacts live (DATA_DIR/assets); paths stored on
  // the row are relative to it.
  assetsDir: string;
  // The served static root (the built client dir), where the house clip
  // library lives; absent means house picks fail loudly instead of
  // pretending.
  publicDir?: string;
  // Fetches a produced file to disk. Injectable: tests hand mock:// URLs
  // a writer, production streams over fetch.
  download(url: string, dest: string): Promise<void>;
  // The second-pass image classification (ADR 0006): resolves false to
  // block. The default passes everything; the hook exists so a real
  // classifier lands without touching this flow.
  classifyImage?(url: string): Promise<boolean>;
  // The technical read of the chosen reference before anything is built
  // from it (server/reference_check.ts): resolves a refusal message to
  // stop the run, or null to carry on. Absent, or answering null, builds
  // exactly as before: the check is a courtesy, never a dependency.
  checkReference?(image: Buffer): Promise<string | null>;
  // Per-champion asset budgets in kilobytes (ADR 0010): a downloaded file
  // over its budget fails the job (and refunds the creation). Absent or
  // non-positive numbers disable a check.
  budgets?: { imageKb?: number; modelKb?: number };
  // What one 2D image costs in embers on THIS deployment. The other
  // prices are facts about an act, but two vendors now sell this one at
  // different prices (4 cents direct from OpenAI, 10 resold by Tripo), so
  // the number follows whichever is configured. Absent falls back to the
  // table, which carries the recommended path's price.
  imagePrice?: number;
  // Local file reads, copies, and sizes, injectable for tests.
  readFile?(absPath: string): Buffer;
  copyFile?(src: string, dest: string): void;
  fileSize?(absPath: string): number;
  now?(): number;
}

export interface BuildRequest {
  def: ForgedChampionDef;
  accountId: number;
  // The creator's last word on their own picture: build even if the
  // reference check does not like the reference.
  force?: boolean;
}

export interface AnimateRequest {
  forgedId: string;
  accountId: number;
  // The style the picks started from, kept for display.
  family: WeaponFamily;
  // The player's FULL target: one pick per clip role plus any per-spell
  // slots, validated against the provider catalog by server/forge.ts
  // before this request exists. The pipeline itself works out which
  // slots actually need baking.
  clips: Readonly<Record<ClipRole, string> & Partial<Record<SpellClipSlot, string>>>;
}

// The weapon family a kit implies, until the workshop lets the author
// choose: ranged kits shoot or channel by role, melee kits swing.
export function familyOf(def: ForgedChampionDef): WeaponFamily {
  const ranged = def.base.attackRange >= 3;
  if (ranged) {
    return def.role === 'Marksman' ? 'bow' : 'staff';
  }
  if (def.role === 'Tank') return 'blunt';
  if (def.role === 'Support' || def.role === 'Mage' || def.role === 'Battlemage') return 'staff';
  return 'slashing';
}

// One calibration sample per produced asset (server/spend.ts, ADR 0017):
// what the provider says the task charged, filed under the meter that
// covers it. A provider that reports no cost writes nothing rather than a
// zero, so an unmeasured act never reads as a free one.
function noteSpend(
  deps: PipelineDeps,
  accountId: number,
  action: 'generation' | 'animate',
  detail: SpendDetail,
  asset: { cost?: number },
  at: number,
): void {
  if (typeof asset.cost !== 'number') return;
  deps.storage.addSpendSample({
    accountId,
    action,
    detail,
    provider: 'tripo',
    credits: asset.cost,
    at,
  });
}

// What a build costs before it runs: the model and its rig, plus the
// weapon when one will actually be forged alongside it. The same reading
// of the assets the run itself makes, so the price and the work cannot
// disagree. The rig is in there because the build runs it (playtest: a
// creator who has just built a model wants to hang the weapon on a hand
// that moment, and a hand is a bone), and a rebuild pays for it again
// because it produces a new model to rig.
export function buildEmbers(deps: PipelineDeps, forgedId: string): number {
  const assets = (deps.storage.forgedAssets(forgedId) as Record<string, unknown> | null) ?? {};
  const weaponComing = !assets.weapon && deps.storage.chosenArt(forgedId, 'weapon') !== null;
  return EMBER_PRICES.model + EMBER_PRICES.rig + (weaponComing ? EMBER_PRICES.weapon : 0);
}

// One refusal, worded the same wherever a balance runs short: it names
// the price and what is held, because a wall that does not say its number
// is the wall this whole economy exists to remove (ADR 0017).
export function shortfall(price: number, held: number): string {
  return `this costs ${price} embers and you have ${held}; the grant refills weekly`;
}

export type PipelineStart =
  | { ok: true; jobId: number; done: Promise<void> }
  | { ok: false; error: string };

// The first half: the static 3D model, for the player to inspect before
// anything animates. Synchronous gate, then the async run: the caller
// answers the HTTP request with the job id while the generation grinds
// on. `done` exists so tests (and a graceful shutdown) can await the
// settling. Running it again on an unsealed champion is a REBUILD: it
// debits another creation and replaces the model.
export function startModelBuild(deps: PipelineDeps, req: BuildRequest): PipelineStart {
  const now = deps.now ?? Date.now;
  if (deps.storage.runningJobFor(req.def.id)) {
    return { ok: false, error: 'this champion is already being built' };
  }
  const price = buildEmbers(deps, req.def.id);
  const held = deps.storage.creditBalance(req.accountId);
  if (held < price) return { ok: false, error: shortfall(price, held) };
  const at = now();
  deps.storage.addCreditEntry({
    accountId: req.accountId,
    delta: -price,
    reason: 'finalize',
    ref: req.def.id,
    at,
  });
  const jobId = deps.storage.createGenerationJob(req.def.id, req.accountId, at, 'build', price);
  const done = runModelBuild(deps, jobId, req).catch((err) => {
    // runModelBuild settles the job itself; this guards the guard.
    console.error('model build job crashed outside its own handling', err);
  });
  return { ok: true, jobId, done };
}

async function runModelBuild(deps: PipelineDeps, jobId: number, req: BuildRequest): Promise<void> {
  const now = deps.now ?? Date.now;
  const stage = (name: string): void => {
    deps.storage.updateGenerationJob(jobId, { stage: name }, now());
  };
  try {
    // The player already iterated the 2D stages in the editor: the model
    // builds from the CHOSEN reference, that exact approved image, never
    // a hidden regeneration. The reference is a local candidate file, so
    // it rides up through the provider's upload seam.
    stage('reference');
    const sheet = deps.storage.chosenArt(req.def.id, 'sheet');
    if (!sheet) {
      throw new GenerationError('no chosen model reference: generate and pick one first');
    }
    if (!deps.provider.uploadImage) {
      throw new GenerationError('this provider cannot take the chosen reference as input');
    }
    const upload = deps.provider.uploadImage.bind(deps.provider);
    const read = deps.readFile ?? readFileSync;
    const sheetRef = await upload({
      data: read(path.join(deps.assetsDir, sheet.path)),
      name: path.basename(sheet.path),
    });

    stage('classify');
    const allowed = deps.classifyImage ? await deps.classifyImage(sheet.path) : true;
    if (!allowed) throw new GenerationError('the model reference failed classification', true);
    // The technical read, at the one moment where stopping is free: the
    // upload is done, nothing has been reconstructed, and a failure here
    // refunds the whole build like any other. A creator who disagrees
    // sends `force` and this is skipped.
    if (!req.force && deps.checkReference) {
      const refusal = await deps.checkReference(read(path.join(deps.assetsDir, sheet.path)));
      if (refusal !== null) throw new GenerationError(refusal);
    }

    stage('model');
    const model = await deps.provider.imageTo3D({ image: sheetRef });
    noteSpend(deps, req.accountId, 'generation', 'model', model, now());

    // The skeleton, in the same run: bones are what a weapon hangs on in
    // the workshop and what every clip later moves, so a built model
    // arrives ready to dress rather than waiting for a bake to give it
    // hands. A rebuild rigs the new model, replacing the old skeleton.
    stage('rig');
    const rigged = await deps.provider.rig({ modelTaskId: model.taskId, rigType: 'biped' });
    noteSpend(deps, req.accountId, 'animate', 'rig', rigged, now());

    // The champion's own weapon, when the player generated and picked a
    // weapon image and no weapon exists yet: a static prop from that
    // exact image, no rig and no clips (the creation covers it, ADR
    // 0011). A rebuild keeps the weapon it already forged.
    const existing =
      (deps.storage.forgedAssets(req.def.id) as Record<string, unknown> | null) ?? {};
    const weaponArt = existing.weapon ? null : deps.storage.chosenArt(req.def.id, 'weapon');
    let weapon: Awaited<ReturnType<GenerationProvider['imageTo3D']>> | null = null;
    if (weaponArt) {
      stage('weapon');
      const weaponRef = await upload({
        data: read(path.join(deps.assetsDir, weaponArt.path)),
        name: path.basename(weaponArt.path),
      });
      weapon = await deps.provider.imageTo3D({ image: weaponRef });
      noteSpend(deps, req.accountId, 'generation', 'weapon', weapon, now());
    }

    // Provider URLs expire (Tripo: 24 hours): download NOW, own forever.
    stage('download');
    const dir = path.join(deps.assetsDir, 'forged', req.def.id);
    mkdirSync(dir, { recursive: true });
    // Forward slashes on purpose: these are stored and later served as
    // URL tails, on Windows dev machines included. The model file is
    // named by its job so a rebuild (and later the animated file) is a
    // NEW url no browser cache can serve stale. The sheet is the chosen
    // candidate copied in place (it was already on disk and already
    // inside the image budget when it landed as a candidate).
    const sheetPath = `forged/${req.def.id}/sheet.png`;
    const modelPath = `forged/${req.def.id}/model_${jobId}.glb`;
    const riggedPath = `forged/${req.def.id}/rigged_${jobId}.glb`;
    const weaponPath = `forged/${req.def.id}/weapon.glb`;
    const copy = deps.copyFile ?? copyFileSync;
    copy(path.join(deps.assetsDir, sheet.path), path.join(deps.assetsDir, sheetPath));
    await deps.download(model.url, path.join(deps.assetsDir, modelPath));
    await deps.download(rigged.url, path.join(deps.assetsDir, riggedPath));
    if (weapon) await deps.download(weapon.url, path.join(deps.assetsDir, weaponPath));
    // The per-champion asset budgets (ADR 0010): an oversized artifact is
    // a technical failure, refunded like any other.
    checkBudget(deps, modelPath, deps.budgets?.modelKb);
    checkBudget(deps, riggedPath, deps.budgets?.modelKb);
    if (weapon) checkBudget(deps, weaponPath, deps.budgets?.modelKb);

    // The row stays a DRAFT: nothing seals until the player has seen the
    // model and baked the animations. The model task id is kept because a
    // later re-rig reads it, and the rig task is what every bake
    // retargets onto.
    const provenance = Array.isArray(existing.provenance) ? existing.provenance : [];
    deps.storage.updateForgedAssets(
      req.def.id,
      {
        ...existing,
        sheet: sheetPath,
        model: modelPath,
        modelTask: model.taskId,
        rigged: riggedPath,
        rigTask: rigged.taskId,
        ...(weapon ? { weapon: weaponPath } : {}),
        provenance: [
          ...provenance,
          sheet.provenance,
          model.provenance,
          rigged.provenance,
          weapon?.provenance,
        ].filter((p) => p !== null && p !== undefined),
      },
      now(),
    );
    deps.storage.updateGenerationJob(jobId, { status: 'success', stage: 'done' }, now());
  } catch (err) {
    const blocked = err instanceof GenerationError && err.blocked;
    const message = err instanceof Error ? err.message : String(err);
    deps.storage.updateGenerationJob(
      jobId,
      { status: 'failed', error: blocked ? `blocked: ${message}` : message },
      now(),
    );
    refund(
      deps.storage,
      req.accountId,
      req.def.id,
      deps.storage.getGenerationJob(jobId)?.embers ?? null,
      now(),
    );
  }
}

// What a bake would actually do, worked out before it is started so it
// can be priced before it is paid for (ADR 0017) and again inside the run
// so the two can never disagree. A changed pick bakes, and so does a slot
// with no clip file yet (the first bake, and a pre-split champion's
// transition). House picks are a file copy that never touches the
// provider and never costs: only the provider ones retarget.
export function bakePlan(
  assets: Record<string, unknown>,
  clips: Readonly<Record<string, string | undefined>>,
): {
  delta: string[];
  providerDelta: string[];
  houseDelta: string[];
  picks: Readonly<Record<string, string>>;
} {
  const prevClips = (assets.clips ?? {}) as Record<string, string>;
  const prevFiles = (assets.clipFiles ?? {}) as Record<string, string>;
  const slots: readonly string[] = [
    ...CLIP_ROLES,
    ...SPELL_CLIP_SLOTS.filter((slot) => typeof clips[slot] === 'string'),
  ];
  const picks = clips as Readonly<Record<string, string>>;
  const delta = slots.filter(
    (role) => picks[role] !== prevClips[role] || typeof prevFiles[role] !== 'string',
  );
  return {
    delta,
    providerDelta: delta.filter((role) => !isHouseClip(picks[role] ?? '')),
    houseDelta: delta.filter((role) => isHouseClip(picks[role] ?? '')),
    picks,
  };
}

// What a bake costs before it runs: the retarget by its provider clip
// count, plus the rig when this champion has never had one. The build
// rigs now, so that second half only ever applies to a champion built
// before it did, which bakes its own rig on its first bake.
export function bakeEmbers(
  assets: Record<string, unknown>,
  clips: Readonly<Record<string, string | undefined>>,
): number {
  const plan = bakePlan(assets, clips);
  if (plan.delta.length === 0) return 0;
  return (isRigged(assets) ? 0 : EMBER_PRICES.rig) + bakePrice(plan.providerDelta.length);
}

// Whether this champion's model already carries a skeleton: a build
// leaves one behind, a champion from before that does not.
export function isRigged(assets: Record<string, unknown>): boolean {
  return typeof assets.rigTask === 'string' && typeof assets.rigged === 'string';
}

// The image-to-3D task a legacy champion's provenance kept: the one-shot
// pipeline stored no modelTask, but its provenance rode in a fixed order
// (reference, model, rig, animate, then the weapon when one was built),
// so the model task sits at index 1.
function legacyModelTask(assets: Record<string, unknown>): string | null {
  if (!Array.isArray(assets.provenance)) return null;
  const entry = assets.provenance[1] as { taskId?: unknown } | undefined;
  return typeof entry?.taskId === 'string' ? entry.taskId : null;
}

// The second half, the player's own click AFTER validating the model:
// bake the picked clips onto the skeleton the build left behind, and
// download them. Priced by the clips it retargets, plus the rig itself
// for a champion built before the build rigged; a failed bake refunds
// every ember whole so it can simply run again.

export function startAnimate(deps: PipelineDeps, req: AnimateRequest): PipelineStart {
  const now = deps.now ?? Date.now;
  if (deps.storage.runningJobFor(req.forgedId)) {
    return { ok: false, error: 'this champion is already being built' };
  }
  const assets = (deps.storage.forgedAssets(req.forgedId) as Record<string, unknown> | null) ?? {};
  if (typeof assets.model !== 'string') {
    return { ok: false, error: 'build the 3D model first: the animations bake onto it' };
  }
  // The build rigs, so the skeleton is normally already there. A model
  // built before it did has none: the bake rigs it once, on the model
  // task the build kept (or the one an old provenance holds), and prices
  // that rig into itself rather than refusing.
  const modelTask =
    typeof assets.modelTask === 'string' ? assets.modelTask : legacyModelTask(assets);
  if (!isRigged(assets) && !modelTask) {
    return { ok: false, error: 'this model kept no build task to rig; rebuild the model first' };
  }
  const price = bakeEmbers(assets, req.clips);
  const held = deps.storage.creditBalance(req.accountId);
  if (held < price) return { ok: false, error: shortfall(price, held) };
  const at = now();
  if (price > 0) {
    deps.storage.addCreditEntry({
      accountId: req.accountId,
      delta: -price,
      reason: 'spend',
      ref: req.forgedId,
      at,
    });
  }
  const jobId = deps.storage.createGenerationJob(req.forgedId, req.accountId, at, 'animate', price);
  const done = runAnimate(deps, jobId, req, modelTask).catch((err) => {
    console.error('animate job crashed outside its own handling', err);
  });
  return { ok: true, jobId, done };
}

// The per-clip bake (playtest round 9: validate each animation on its
// own, never five at a time). The rig normally happened at the build and
// its task id and file live on the assets; a model built before that
// rigs here, once. Either way a bake retargets only the roles whose pick
// changed (or that never had a clip file), as an animation-only GLB
// riding beside the rigged body. Champions baked before the per-clip
// split keep their single embedded model until their first re-bake
// transitions them.
async function runAnimate(
  deps: PipelineDeps,
  jobId: number,
  req: AnimateRequest,
  modelTask: string | null,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const stage = (name: string): void => {
    deps.storage.updateGenerationJob(jobId, { stage: name }, now());
  };
  try {
    const before =
      (deps.storage.forgedAssets(req.forgedId) as Record<string, unknown> | null) ?? {};
    const { delta, providerDelta, houseDelta, picks } = bakePlan(before, req.clips);
    const prevFiles = (before.clipFiles ?? {}) as Record<string, string>;

    // The fallback rig, for a champion whose build predates the one the
    // build itself runs: once, then kept forever like any other.
    let rigTask = typeof before.rigTask === 'string' ? before.rigTask : null;
    let riggedPath = typeof before.rigged === 'string' ? before.rigged : null;
    let rigProvenance: unknown = null;
    if (delta.length > 0 && (rigTask === null || riggedPath === null)) {
      if (!modelTask) throw new GenerationError('this model kept no build task to rig');
      stage('rig');
      const rigged = await deps.provider.rig({ modelTaskId: modelTask, rigType: 'biped' });
      noteSpend(deps, req.accountId, 'animate', 'rig', rigged, now());
      riggedPath = `forged/${req.forgedId}/rigged_${jobId}.glb`;
      await deps.download(rigged.url, path.join(deps.assetsDir, riggedPath));
      checkBudget(deps, riggedPath, deps.budgets?.modelKb);
      rigTask = rigged.taskId;
      rigProvenance = rigged.provenance;
    }

    let clipsPath: string | null = null;
    let bakeProvenance: unknown = null;
    if (providerDelta.length > 0 && rigTask !== null) {
      stage('animate');
      const animations = [...new Set(providerDelta.map((role) => picks[role] ?? ''))].filter(
        (id) => id !== '',
      );
      const baked = await deps.provider.animate({
        riggedTaskId: rigTask,
        animations,
        withGeometry: false,
      });
      // A retarget is priced by how many clips it carries (measured
      // 2026-09-05: 30 credits for five, 10 for one), so the sample is
      // worth nothing without the count that produced it.
      noteSpend(deps, req.accountId, 'animate', 'retarget', baked, now());
      stage('download');
      clipsPath = `forged/${req.forgedId}/clips_${jobId}.glb`;
      await deps.download(baked.url, path.join(deps.assetsDir, clipsPath));
      checkBudget(deps, clipsPath, deps.budgets?.modelKb);
      bakeProvenance = baked.provenance;
    }

    const houseFiles: Record<string, string> = {};
    if (houseDelta.length > 0) {
      if (!deps.publicDir) {
        throw new GenerationError('house clips are not available on this server');
      }
      const copy = deps.copyFile ?? copyFileSync;
      for (const role of houseDelta) {
        const src = houseClipFile(picks[role] ?? '');
        if (!src) throw new GenerationError(`unknown house clip: ${picks[role]}`);
        const dest = `forged/${req.forgedId}/house_${jobId}_${role}.glb`;
        mkdirSync(path.dirname(path.join(deps.assetsDir, dest)), { recursive: true });
        copy(path.join(deps.publicDir, src), path.join(deps.assetsDir, dest));
        houseFiles[role] = dest;
      }
    }

    // Sealed with the champion: the rigged body, the pick and the clip
    // file per role, plus the chosen splash and spell icons as they
    // stand and the appended provenance. Re-read after the awaits so a
    // concurrent art choice is not clobbered.
    const assets =
      (deps.storage.forgedAssets(req.forgedId) as Record<string, unknown> | null) ?? {};
    const clipFiles: Record<string, string> = { ...prevFiles };
    if (clipsPath !== null) {
      for (const role of providerDelta) clipFiles[role] = clipsPath;
    }
    for (const role of houseDelta) {
      const dest = houseFiles[role];
      if (dest !== undefined) clipFiles[role] = dest;
    }
    const splash = deps.storage.chosenArt(req.forgedId, 'splash');
    const icons: Record<string, string> = {};
    for (const key of ['Q', 'W', 'E', 'R']) {
      const pick = deps.storage.chosenArt(req.forgedId, `icon_${key}`);
      if (pick) icons[key] = pick.path;
    }
    const provenance = Array.isArray(assets.provenance) ? assets.provenance : [];
    // Assets only: animating no longer seals (playtest: the lock must be
    // its own click, server/seal.ts). A draft stays a draft; a champion
    // already sealed keeps its seal.
    deps.storage.updateForgedAssets(
      req.forgedId,
      {
        ...assets,
        ...(rigTask !== null && riggedPath !== null ? { rigTask, rigged: riggedPath } : {}),
        family: req.family,
        // The exact pick per role: the renderer plays THESE, no guessing.
        clips: req.clips,
        clipFiles,
        ...(splash ? { splash: splash.path } : {}),
        ...(Object.keys(icons).length > 0 ? { icons } : {}),
        provenance: [...provenance, rigProvenance, bakeProvenance].filter(
          (p) => p !== null && p !== undefined,
        ),
      },
      now(),
    );
    deps.storage.updateGenerationJob(jobId, { status: 'success', stage: 'done' }, now());
  } catch (err) {
    const blocked = err instanceof GenerationError && err.blocked;
    const message = err instanceof Error ? err.message : String(err);
    deps.storage.updateGenerationJob(
      jobId,
      { status: 'failed', error: blocked ? `blocked: ${message}` : message },
      now(),
    );
    // A bake pays for itself now (ADR 0017), so a failed one gives it
    // back like every other failure, technical or content-blocked.
    refund(
      deps.storage,
      req.accountId,
      req.forgedId,
      deps.storage.getGenerationJob(jobId)?.embers ?? 0,
      now(),
    );
  }
}

// The weapon-only build: a champion that built WITHOUT a weapon can
// still claim the one its creation covered (ADR 0011). Same job
// machinery as the build so the editor polls it identically, but no
// ledger movement in either direction: the entitlement was paid at the
// build, and it is gone once a weapon exists (replacing one is
// Reforge). Policy gates (owner, model built, no weapon yet) live in
// server/forge.ts; this only runs the chain.
export function startWeaponForge(
  deps: PipelineDeps,
  req: { forgedId: string; accountId: number },
): PipelineStart {
  const now = deps.now ?? Date.now;
  if (deps.storage.runningJobFor(req.forgedId)) {
    return { ok: false, error: 'this champion is already being built' };
  }
  const art = deps.storage.chosenArt(req.forgedId, 'weapon');
  if (!art) {
    return { ok: false, error: 'generate and pick a weapon image first' };
  }
  // Claimed later rather than built alongside the model, so it pays for
  // itself here: under the old economy the creation had already covered
  // it, and there is no creation any more.
  const price = EMBER_PRICES.weapon;
  const held = deps.storage.creditBalance(req.accountId);
  if (held < price) return { ok: false, error: shortfall(price, held) };
  const at = now();
  deps.storage.addCreditEntry({
    accountId: req.accountId,
    delta: -price,
    reason: 'spend',
    ref: req.forgedId,
    at,
  });
  const jobId = deps.storage.createGenerationJob(req.forgedId, req.accountId, at, 'weapon', price);
  const done = runWeaponForge(deps, jobId, req.forgedId, req.accountId, art.path).catch((err) => {
    console.error('weapon forge job crashed outside its own handling', err);
  });
  return { ok: true, jobId, done };
}

async function runWeaponForge(
  deps: PipelineDeps,
  jobId: number,
  forgedId: string,
  accountId: number,
  artPath: string,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const stage = (name: string): void => {
    deps.storage.updateGenerationJob(jobId, { stage: name }, now());
  };
  try {
    stage('weapon');
    if (!deps.provider.uploadImage) {
      throw new GenerationError('this provider cannot take the weapon image as input');
    }
    const read = deps.readFile ?? readFileSync;
    const token = await deps.provider.uploadImage({
      data: read(path.join(deps.assetsDir, artPath)),
      name: path.basename(artPath),
    });
    const weapon = await deps.provider.imageTo3D({ image: token });
    noteSpend(deps, accountId, 'generation', 'weapon', weapon, now());
    stage('download');
    const weaponPath = `forged/${forgedId}/weapon.glb`;
    await deps.download(weapon.url, path.join(deps.assetsDir, weaponPath));
    checkBudget(deps, weaponPath, deps.budgets?.modelKb);
    const assets = (deps.storage.forgedAssets(forgedId) as Record<string, unknown> | null) ?? {};
    const provenance = Array.isArray(assets.provenance) ? assets.provenance : [];
    deps.storage.updateForgedAssets(
      forgedId,
      { ...assets, weapon: weaponPath, provenance: [...provenance, weapon.provenance] },
      now(),
    );
    deps.storage.updateGenerationJob(jobId, { status: 'success', stage: 'done' }, now());
  } catch (err) {
    const blocked = err instanceof GenerationError && err.blocked;
    const message = err instanceof Error ? err.message : String(err);
    deps.storage.updateGenerationJob(
      jobId,
      { status: 'failed', error: blocked ? `blocked: ${message}` : message },
      now(),
    );
    refund(
      deps.storage,
      accountId,
      forgedId,
      deps.storage.getGenerationJob(jobId)?.embers ?? 0,
      now(),
    );
  }
}

// Fails the job when a downloaded artifact exceeds its budget; a missing
// file measures as zero on purpose (tests inject recording downloads).
function checkBudget(deps: PipelineDeps, rel: string, limitKb: number | undefined): void {
  if (!limitKb || limitKb <= 0) return;
  const size = deps.fileSize ?? ((p: string) => statOrZero(p));
  const kb = size(path.join(deps.assetsDir, rel)) / 1024;
  if (kb > limitKb) {
    throw new GenerationError(`${rel} is ${Math.round(kb)} KB, over the ${limitKb} KB budget`);
  }
}

function statOrZero(absPath: string): number {
  try {
    return statSync(absPath).size;
  } catch {
    return 0;
  }
}

// Exactly what the job took, never a fixed number: a weighted price
// cannot be re-derived once the work has failed, so the job row carries
// it (ADR 0017). A row from before the ember ledger carries null and gets
// the one creation it was debited, in embers.
function refund(
  storage: ForgeStore,
  accountId: number,
  forgedId: string,
  embers: number | null,
  at: number,
): void {
  const back = embers ?? CREATION_IN_EMBERS;
  if (back <= 0) return;
  storage.addCreditEntry({ accountId, delta: back, reason: 'refund', ref: forgedId, at });
}

// The boot sweep: a job still marked running belonged to a process that
// died mid-generation. Fail it and give back exactly what it took, which
// the row itself remembers. Every kind can debit now (ADR 0017), so the
// old rule of refunding builds alone would strand a bake's embers; a null
// on the row is a job from before the ember ledger and gets a creation.
export function recoverStaleJobs(storage: ForgeStore, now: () => number = Date.now): number {
  const stale = storage.staleRunningJobs();
  for (const job of stale) {
    storage.updateGenerationJob(
      job.id,
      { status: 'failed', error: 'the server restarted mid-generation' },
      now(),
    );
    if (job.embers !== null || job.kind === 'build' || job.kind === null) {
      refund(storage, job.accountId, job.forgedId, job.embers, now());
    }
  }
  return stale.length;
}

// The production download: stream the provider's file to disk.
export async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new GenerationError(`asset download failed: ${res.status}`);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}
