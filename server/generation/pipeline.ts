// Finalization (ADR 0006, plan-forge phase 5): the server-side async job
// that turns a validated draft into a finalized champion. Stages in ADR
// order: derive the model sheet (2D), second-pass classification, image
// to 3D, auto-rig (biped, v1), the per-weapon-family clip set, then
// download the artifacts next to the store and seal the row with full
// provenance. The economy is ledger-first (ADR 0007): one creation is
// debited when the job starts and refunded on ANY failure, technical or
// content-blocked. Jobs persist in SQLite so a crash mid-run is swept on
// boot: the job fails, the creation comes back.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ForgedChampionDef } from '../../src/sim/forge/forged_def';
import type { Storage } from '../storage';
import { GenerationError, type GenerationProvider, type WeaponFamily } from './provider';

export interface PipelineDeps {
  storage: Storage;
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
// technical 2D image the 3D generation accepts. The splash-art source
// image joins this call once the splash editor exists.
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
    stage('model_sheet');
    const sheet = await deps.provider.generate2D({ prompt: sheetPrompt(req.def) });

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
    const sheetPath = path.join('forged', req.def.id, 'sheet.png');
    const modelPath = path.join('forged', req.def.id, 'model.glb');
    await deps.download(sheet.url, path.join(deps.assetsDir, sheetPath));
    await deps.download(animated.url, path.join(deps.assetsDir, modelPath));

    deps.storage.setForgedFinalized(
      req.def.id,
      {
        sheet: sheetPath,
        model: modelPath,
        family: req.family,
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

function refund(storage: Storage, accountId: number, forgedId: string, at: number): void {
  storage.addCreditEntry({ accountId, delta: 1, reason: 'refund', ref: forgedId, at });
}

// The boot sweep: a job still marked running belonged to a process that
// died mid-generation. Fail it and give the creation back.
export function recoverStaleJobs(storage: Storage, now: () => number = Date.now): number {
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
