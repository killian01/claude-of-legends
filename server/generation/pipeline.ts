// Finalization (ADR 0006, plan-forge phase 5): the server-side async job
// that turns a validated draft into a finalized champion. The 2D stages
// are the player's own, iterated in the editor (splash, then the model
// reference derived from it, both art candidates); this job runs the 3D
// half on the CHOSEN reference, exactly the image the player approved:
// classification, image to 3D, auto-rig (biped, v1), the per-weapon-
// family clip set, then download the artifacts next to the store and
// seal the row with full provenance. The economy is ledger-first (ADR
// 0007): one creation is debited when the job starts and refunded on ANY
// failure, technical or content-blocked. Jobs persist in SQLite so a
// crash mid-run is swept on boot: the job fails, the creation comes back.

import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ForgedChampionDef } from '../../src/sim/forge/forged_def';
import type { ForgeStore } from '../forge_store';
import { GenerationError, type GenerationProvider, type WeaponFamily } from './provider';

export interface PipelineDeps {
  storage: ForgeStore;
  provider: GenerationProvider;
  // Where downloaded artifacts live (DATA_DIR/assets); paths stored on
  // the row are relative to it.
  assetsDir: string;
  // Fetches a produced file to disk. Injectable: tests hand mock:// URLs
  // a writer, production streams over fetch.
  download(url: string, dest: string): Promise<void>;
  // The second-pass image classification (ADR 0006): resolves false to
  // block. The default passes everything; the hook exists so a real
  // classifier lands without touching this flow.
  classifyImage?(url: string): Promise<boolean>;
  // Per-champion asset budgets in kilobytes (ADR 0010): a downloaded file
  // over its budget fails the job (and refunds the creation). Absent or
  // non-positive numbers disable a check.
  budgets?: { imageKb?: number; modelKb?: number };
  // Local file reads, copies, and sizes, injectable for tests.
  readFile?(absPath: string): Buffer;
  copyFile?(src: string, dest: string): void;
  fileSize?(absPath: string): number;
  now?(): number;
}

export interface FinalizeRequest {
  def: ForgedChampionDef;
  accountId: number;
  family: WeaponFamily;
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

export type FinalizeStart =
  | { ok: true; jobId: number; done: Promise<void> }
  | { ok: false; error: string };

// Synchronous gate, then the async run: the caller answers the HTTP
// request with the job id while the generation grinds on. `done` exists
// so tests (and a graceful shutdown) can await the settling.
export function startFinalize(deps: PipelineDeps, req: FinalizeRequest): FinalizeStart {
  const now = deps.now ?? Date.now;
  if (deps.storage.runningJobFor(req.def.id)) {
    return { ok: false, error: 'this champion is already being finalized' };
  }
  if (deps.storage.creditBalance(req.accountId) < 1) {
    return { ok: false, error: 'no creations left; the allocation refreshes weekly' };
  }
  const at = now();
  deps.storage.addCreditEntry({
    accountId: req.accountId,
    delta: -1,
    reason: 'finalize',
    ref: req.def.id,
    at,
  });
  const jobId = deps.storage.createGenerationJob(req.def.id, req.accountId, at);
  const done = runFinalize(deps, jobId, req).catch((err) => {
    // runFinalize settles the job itself; this guards the guard.
    console.error('finalize job crashed outside its own handling', err);
  });
  return { ok: true, jobId, done };
}

async function runFinalize(deps: PipelineDeps, jobId: number, req: FinalizeRequest): Promise<void> {
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

    stage('model');
    const model = await deps.provider.imageTo3D({ image: sheetRef });

    stage('rig');
    const rigged = await deps.provider.rig({ modelTaskId: model.taskId, rigType: 'biped' });

    stage('animate');
    const animated = await deps.provider.animate({
      riggedTaskId: rigged.taskId,
      family: req.family,
    });

    // The champion's own weapon, when the player generated and picked a
    // weapon image: a static prop from that exact image, no rig and no
    // clips (the Creation covers it, ADR 0011). No pick, no stage.
    const weaponArt = deps.storage.chosenArt(req.def.id, 'weapon');
    let weapon: Awaited<ReturnType<GenerationProvider['imageTo3D']>> | null = null;
    if (weaponArt) {
      stage('weapon');
      const weaponRef = await upload({
        data: read(path.join(deps.assetsDir, weaponArt.path)),
        name: path.basename(weaponArt.path),
      });
      weapon = await deps.provider.imageTo3D({ image: weaponRef });
    }

    // Provider URLs expire (Tripo: 24 hours): download NOW, own forever.
    stage('download');
    const dir = path.join(deps.assetsDir, 'forged', req.def.id);
    mkdirSync(dir, { recursive: true });
    // Forward slashes on purpose: these are stored and later served as
    // URL tails, on Windows dev machines included. The sheet is the
    // chosen candidate copied in place (it was already on disk and
    // already inside the image budget when it landed as a candidate).
    const sheetPath = `forged/${req.def.id}/sheet.png`;
    const modelPath = `forged/${req.def.id}/model.glb`;
    const weaponPath = `forged/${req.def.id}/weapon.glb`;
    const copy = deps.copyFile ?? copyFileSync;
    copy(path.join(deps.assetsDir, sheet.path), path.join(deps.assetsDir, sheetPath));
    await deps.download(animated.url, path.join(deps.assetsDir, modelPath));
    if (weapon) await deps.download(weapon.url, path.join(deps.assetsDir, weaponPath));
    // The per-champion asset budgets (ADR 0010): an oversized artifact is
    // a technical failure, refunded like any other.
    checkBudget(deps, modelPath, deps.budgets?.modelKb);
    if (weapon) checkBudget(deps, weaponPath, deps.budgets?.modelKb);

    // Sealed with the champion: the reference and model this run
    // produced, the chosen splash and spell icons as they stand
    // (candidate files are never pruned once chosen), and full
    // provenance, the reference's own included.
    const splash = deps.storage.chosenArt(req.def.id, 'splash');
    const icons: Record<string, string> = {};
    for (const key of ['Q', 'W', 'E', 'R']) {
      const pick = deps.storage.chosenArt(req.def.id, `icon_${key}`);
      if (pick) icons[key] = pick.path;
    }
    deps.storage.setForgedFinalized(
      req.def.id,
      {
        sheet: sheetPath,
        model: modelPath,
        family: req.family,
        ...(weapon ? { weapon: weaponPath } : {}),
        ...(splash ? { splash: splash.path } : {}),
        ...(Object.keys(icons).length > 0 ? { icons } : {}),
        provenance: [
          sheet.provenance,
          model.provenance,
          rigged.provenance,
          animated.provenance,
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
    refund(deps.storage, req.accountId, req.def.id, now());
  }
}

// The weapon-only build: a champion that sealed WITHOUT a weapon can
// still claim the one its creation covered (ADR 0011). Same job
// machinery as finalize so the editor polls it identically, but no
// ledger movement in either direction: the entitlement was paid at
// finalize, and it is gone once a weapon exists (replacing one is
// Reforge). Policy gates (owner, finalized, no weapon yet) live in
// server/forge.ts; this only runs the chain.
export function startWeaponForge(
  deps: PipelineDeps,
  req: { forgedId: string; accountId: number },
): FinalizeStart {
  const now = deps.now ?? Date.now;
  if (deps.storage.runningJobFor(req.forgedId)) {
    return { ok: false, error: 'this champion is already being built' };
  }
  const art = deps.storage.chosenArt(req.forgedId, 'weapon');
  if (!art) {
    return { ok: false, error: 'generate and pick a weapon image first' };
  }
  const jobId = deps.storage.createGenerationJob(req.forgedId, req.accountId, now());
  const done = runWeaponForge(deps, jobId, req.forgedId, art.path).catch((err) => {
    console.error('weapon forge job crashed outside its own handling', err);
  });
  return { ok: true, jobId, done };
}

async function runWeaponForge(
  deps: PipelineDeps,
  jobId: number,
  forgedId: string,
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
    // Nothing to refund: this chain never debited anything.
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

function refund(storage: ForgeStore, accountId: number, forgedId: string, at: number): void {
  storage.addCreditEntry({ accountId, delta: 1, reason: 'refund', ref: forgedId, at });
}

// The boot sweep: a job still marked running belonged to a process that
// died mid-generation. Fail it and give the creation back.
export function recoverStaleJobs(storage: ForgeStore, now: () => number = Date.now): number {
  const stale = storage.staleRunningJobs();
  for (const job of stale) {
    storage.updateGenerationJob(
      job.id,
      { status: 'failed', error: 'the server restarted mid-generation' },
      now(),
    );
    refund(storage, job.accountId, job.forgedId, now());
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
