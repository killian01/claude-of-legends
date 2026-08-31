// Finalization (ADR 0006, plan-forge phase 5): the server-side async job
// that turns a validated draft into a finalized champion. Stages in ADR
// order: derive the model sheet (2D), second-pass classification, image
// to 3D, auto-rig (biped, v1), the per-weapon-family clip set, then
// download the artifacts next to the store and seal the row with full
// provenance. The economy is ledger-first (ADR 0007): one creation is
// debited when the job starts and refunded on ANY failure, technical or
// content-blocked. Jobs persist in SQLite so a crash mid-run is swept on
// boot: the job fails, the creation comes back.

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  // Local file reads and sizes, injectable for tests.
  readFile?(absPath: string): Buffer;
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

// The model sheet derivation prompt (CONTEXT.md "Model sheet"): the
// technical 2D image the 3D generation accepts, derived from the chosen
// splash when the provider can take an image input.
export function sheetPrompt(def: ForgedChampionDef): string {
  const identity = [def.name, def.title].filter((s) => s.trim().length > 0).join(', ');
  return (
    `Technical character model sheet: one character, full body, front-facing A-pose, ` +
    `arms slightly out, empty hands, neutral gray background, even lighting, no props. ` +
    `The character: ${identity}, a ${def.role.toLowerCase()} champion. ${def.tagline}`.trim()
  );
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
    // The splash is the creative anchor (ADR 0010): when the draft has a
    // chosen splash and the provider accepts image input, the model sheet
    // derives from it; otherwise the prompt stands alone.
    stage('model_sheet');
    const splash = deps.storage.chosenArt(req.def.id, 'splash');
    let splashRef: string | undefined;
    if (splash && deps.provider.uploadImage) {
      const read = deps.readFile ?? readFileSync;
      splashRef = await deps.provider.uploadImage({
        data: read(path.join(deps.assetsDir, splash.path)),
        name: path.basename(splash.path),
      });
    }
    const sheet = await deps.provider.generate2D({
      prompt: sheetPrompt(req.def),
      ...(splashRef ? { image: splashRef } : {}),
    });

    stage('classify');
    const allowed = deps.classifyImage ? await deps.classifyImage(sheet.url) : true;
    if (!allowed) throw new GenerationError('the model sheet failed classification', true);

    stage('model');
    const model = await deps.provider.imageTo3D({
      imageTaskId: sheet.taskId,
      imageUrl: sheet.url,
    });

    stage('rig');
    const rigged = await deps.provider.rig({ modelTaskId: model.taskId, rigType: 'biped' });

    stage('animate');
    const animated = await deps.provider.animate({
      riggedTaskId: rigged.taskId,
      family: req.family,
    });

    // Provider URLs expire (Tripo: 24 hours): download NOW, own forever.
    stage('download');
    const dir = path.join(deps.assetsDir, 'forged', req.def.id);
    mkdirSync(dir, { recursive: true });
    // Forward slashes on purpose: these are stored and later served as
    // URL tails, on Windows dev machines included.
    const sheetPath = `forged/${req.def.id}/sheet.png`;
    const modelPath = `forged/${req.def.id}/model.glb`;
    await deps.download(sheet.url, path.join(deps.assetsDir, sheetPath));
    await deps.download(animated.url, path.join(deps.assetsDir, modelPath));
    // The per-champion asset budgets (ADR 0010): an oversized artifact is
    // a technical failure, refunded like any other.
    checkBudget(deps, sheetPath, deps.budgets?.imageKb);
    checkBudget(deps, modelPath, deps.budgets?.modelKb);

    // Sealed with the champion: the sheet and model this run produced,
    // the chosen splash and spell icons as they stand (candidate files
    // are never pruned once chosen), and full provenance.
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
        ...(splash ? { splash: splash.path } : {}),
        ...(Object.keys(icons).length > 0 ? { icons } : {}),
        provenance: [sheet.provenance, model.provenance, rigged.provenance, animated.provenance],
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
