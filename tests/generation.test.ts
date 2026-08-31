// The generation pipeline (ADR 0010, keyless half): the neutral provider
// interface driven end to end on the mock, in its TWO player-approved
// halves (the model build spends the creation, then animate rigs, bakes
// and seals as its own later click), the ledger-first debit and refund
// on every failure shape, the boot sweep for jobs a crash orphaned, the
// build and animate gates, and the Tripo provider pinned against
// scripted responses.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  animateChampion,
  buildModel,
  type ForgeDeps,
  forgeWeapon,
  saveDraft,
} from '../server/forge';
import { ForgeStore } from '../server/forge_store';
import { MockProvider } from '../server/generation/mock';
import {
  familyOf,
  type PipelineDeps,
  recoverStaleJobs,
  startAnimate,
  startModelBuild,
} from '../server/generation/pipeline';
import { placeholderPng } from '../server/generation/placeholder';
import { CLIP_ROLES, GenerationError, WEAPON_FAMILIES } from '../server/generation/provider';
import { TRIPO_CLIPS, TripoProvider } from '../server/generation/tripo';
import { CHAMPIONS } from '../src/sim/content/champions';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { forgedTwin } from './forged_twins';

const dirs: string[] = [];
const open: ForgeStore[] = [];
function assetsDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'loc-gen-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const s of open.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ACCOUNT = 7;

interface Rig {
  store: ForgeStore;
  provider: MockProvider;
  pipeline: PipelineDeps;
  downloads: { url: string; dest: string }[];
  def: ForgedChampionDef;
  splashRel: string;
  sheetRel: string;
}

function rig(classify?: (url: string) => Promise<boolean>): Rig {
  const store = new ForgeStore(':memory:');
  open.push(store);
  // The signup-equivalent grant: three creations on the ledger.
  store.addCreditEntry({ accountId: ACCOUNT, delta: 3, reason: 'weekly_grant', at: 1 });
  const provider = new MockProvider(() => 777);
  const downloads: { url: string; dest: string }[] = [];
  const dir = assetsDir();
  const pipeline: PipelineDeps = {
    storage: store,
    provider,
    assetsDir: dir,
    download: (url, dest) => {
      downloads.push({ url, dest });
      return Promise.resolve();
    },
    ...(classify ? { classifyImage: classify } : {}),
    now: () => 999,
  };
  const def = { ...forgedTwin(CHAMPIONS.sylra!), id: 'forged_gen_test' };
  const saved = saveDraft({ store }, ACCOUNT, 'bob', def);
  if (!saved.ok) throw new Error(saved.error);
  // The chosen splash and the chosen model reference (both real files:
  // the reference's bytes ride the mock's uploadImage, and finalize
  // copies its file into the sealed assets).
  const splashRel = `forged/${def.id}/art/splash_seed.png`;
  const sheetRel = `forged/${def.id}/art/sheet_seed.png`;
  mkdirSync(path.dirname(path.join(dir, splashRel)), { recursive: true });
  writeFileSync(path.join(dir, splashRel), placeholderPng('gen-test'));
  writeFileSync(path.join(dir, sheetRel), placeholderPng('gen-test-sheet'));
  for (const [kind, rel] of [
    ['splash', splashRel],
    ['sheet', sheetRel],
  ] as const) {
    const cid = store.addArtCandidate({
      forgedId: def.id,
      accountId: ACCOUNT,
      kind,
      prompt: 'p',
      path: rel,
      provenance: { provider: 'mock', model: 'mock-1', at: 1, taskId: `cand-${kind}` },
      at: 1,
    });
    store.chooseArtCandidate(def.id, kind, cid);
  }
  return { store, provider, pipeline, downloads, def, splashRel, sheetRel };
}

describe('the mock pipeline end to end', () => {
  it('builds the STATIC model first: the row stays a draft, one creation spent', async () => {
    const r = rig();
    const start = startModelBuild(r.pipeline, { def: r.def, accountId: ACCOUNT });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    await start.done;

    const job = r.store.getGenerationJob(start.jobId);
    expect(job?.status).toBe('success');
    expect(job?.kind).toBe('build');
    // NOT sealed: the player inspects the model before anything animates.
    expect(r.store.getForged(r.def.id)?.status).toBe('draft');
    const assets = r.store.forgedAssets(r.def.id) as {
      sheet: string;
      model: string;
      modelTask: string;
      family?: string;
      provenance: { provider: string; taskId: string }[];
    };
    // The static model, named by its job so a rebuild is a fresh URL, and
    // the task id the later animate step rigs.
    expect(assets.model).toBe(`forged/${r.def.id}/model_${start.jobId}.glb`);
    expect(typeof assets.modelTask).toBe('string');
    expect(assets.family).toBeUndefined();
    expect(assets.provenance).toHaveLength(2);
    // The static model is the only download; no rig, no animation pass.
    expect(r.downloads.map((d) => d.url)).toEqual([expect.stringContaining('mock://model/')]);
    expect(r.provider.seen.some((s) => s.op === 'rig' || s.op === 'animate')).toBe(false);
    // Ledger: 3 granted, 1 spent, nothing refunded.
    expect(r.store.creditBalance(ACCOUNT)).toBe(2);
  });

  it('animates and seals as its own SECOND step, spending nothing more', async () => {
    const r = rig();
    const built = startModelBuild(r.pipeline, { def: r.def, accountId: ACCOUNT });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    await built.done;
    const modelTask = (r.store.forgedAssets(r.def.id) as { modelTask: string }).modelTask;

    const start = startAnimate(r.pipeline, {
      forgedId: r.def.id,
      accountId: ACCOUNT,
      family: 'staff',
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    await start.done;

    const job = r.store.getGenerationJob(start.jobId);
    expect(job?.status).toBe('success');
    expect(job?.kind).toBe('animate');
    expect(r.store.getForged(r.def.id)?.status).toBe('finalized');
    const assets = r.store.forgedAssets(r.def.id) as {
      model: string;
      family: string;
      splash: string;
      provenance: { provider: string }[];
    };
    // The animated file replaces the static one as THE model.
    expect(assets.model).toBe(`forged/${r.def.id}/animated_${start.jobId}.glb`);
    expect(assets.family).toBe('staff');
    // The chosen splash is sealed with the champion (ADR 0010).
    expect(assets.splash).toBe(r.splashRel);
    expect(assets.provenance).toHaveLength(4);
    expect(assets.provenance.every((p) => p.provider === 'mock')).toBe(true);
    // The rig ran on the EXACT model the player validated.
    expect(r.provider.seen.find((s) => s.op === 'rig')?.req).toMatchObject({
      modelTaskId: modelTask,
    });
    expect(r.downloads.at(-1)?.url).toContain('mock://animated/');
    // The creation was spent at the build; animate moved nothing.
    expect(r.store.creditBalance(ACCOUNT)).toBe(2);
  });

  it('refuses to animate before the model is built', () => {
    const r = rig();
    const start = startAnimate(r.pipeline, {
      forgedId: r.def.id,
      accountId: ACCOUNT,
      family: 'staff',
    });
    expect(start).toMatchObject({
      ok: false,
      error: expect.stringContaining('build the 3D model first'),
    });
  });

  it('builds the 3D from the uploaded chosen reference, never a regeneration', async () => {
    const r = rig();
    const start = startModelBuild(r.pipeline, { def: r.def, accountId: ACCOUNT });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    await start.done;
    const upload = r.provider.seen.find((s) => s.op === 'uploadImage');
    expect(upload?.req).toMatchObject({ name: 'sheet_seed.png' });
    const model = r.provider.seen.find((s) => s.op === 'imageTo3D');
    expect(model?.req).toMatchObject({ image: 'mock-upload-1' });
    // The 2D stages are the player's, iterated in the editor: the build
    // never generates an image behind their back.
    expect(r.provider.seen.some((s) => s.op === 'generate2D')).toBe(false);
  });

  it('forges the chosen weapon image into its own prop model', async () => {
    const r = rig();
    const weaponRel = `forged/${r.def.id}/art/weapon_seed.png`;
    writeFileSync(path.join(r.pipeline.assetsDir, weaponRel), placeholderPng('gen-test-weapon'));
    const cid = r.store.addArtCandidate({
      forgedId: r.def.id,
      accountId: ACCOUNT,
      kind: 'weapon',
      prompt: 'p',
      path: weaponRel,
      provenance: { provider: 'mock', model: 'mock-1', at: 1, taskId: 'cand-weapon' },
      at: 1,
    });
    r.store.chooseArtCandidate(r.def.id, 'weapon', cid);
    const start = startModelBuild(r.pipeline, { def: r.def, accountId: ACCOUNT });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    await start.done;
    expect(r.store.getGenerationJob(start.jobId)?.status).toBe('success');
    const assets = r.store.forgedAssets(r.def.id) as { weapon?: string; provenance: unknown[] };
    expect(assets.weapon).toBe(`forged/${r.def.id}/weapon.glb`);
    expect(assets.provenance).toHaveLength(3);
    // The chosen weapon image rode up and produced its own STATIC model:
    // a second image-to-3D, and nothing rigs during the build half.
    const uploads = r.provider.seen.filter((s) => s.op === 'uploadImage');
    expect(uploads.at(-1)?.req).toMatchObject({ name: 'weapon_seed.png' });
    expect(r.provider.seen.filter((s) => s.op === 'imageTo3D')).toHaveLength(2);
    expect(r.provider.seen.filter((s) => s.op === 'rig')).toHaveLength(0);
    expect(r.downloads.map((d) => d.url)).toEqual([
      expect.stringContaining('mock://model/'),
      expect.stringContaining('mock://model/'),
    ]);
  });

  it('forges the weapon onto a built champion without one, spending nothing', async () => {
    const r = rig();
    const deps: ForgeDeps = { store: r.store, generation: r.pipeline, now: () => 999 };
    // Nothing built yet: no model, no claim.
    expect(forgeWeapon(deps, ACCOUNT, r.def.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining('build the 3D model first'),
    });
    const built = buildModel(deps, ACCOUNT, r.def.id);
    expect(built.ok).toBe(true);
    if (built.ok) await built.done;
    expect(r.store.creditBalance(ACCOUNT)).toBe(2);
    // No chosen weapon image yet: the chain refuses before any job.
    expect(forgeWeapon(deps, ACCOUNT, r.def.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining('weapon image'),
    });
    const weaponRel = `forged/${r.def.id}/art/weapon_seed.png`;
    writeFileSync(path.join(r.pipeline.assetsDir, weaponRel), placeholderPng('late-weapon'));
    const cid = r.store.addArtCandidate({
      forgedId: r.def.id,
      accountId: ACCOUNT,
      kind: 'weapon',
      prompt: 'p',
      path: weaponRel,
      provenance: { provider: 'mock', model: 'mock-1', at: 1, taskId: 'cand-weapon' },
      at: 1,
    });
    r.store.chooseArtCandidate(r.def.id, 'weapon', cid);
    const before = (r.store.forgedAssets(r.def.id) as { provenance: unknown[] }).provenance.length;
    const claim = forgeWeapon(deps, ACCOUNT, r.def.id);
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    await claim.done;
    const claimJob = r.store.getGenerationJob(claim.jobId);
    expect(claimJob?.status).toBe('success');
    expect(claimJob?.kind).toBe('weapon');
    const assets = r.store.forgedAssets(r.def.id) as { weapon?: string; provenance: unknown[] };
    expect(assets.weapon).toBe(`forged/${r.def.id}/weapon.glb`);
    expect(assets.provenance).toHaveLength(before + 1);
    // The creation covered the weapon: the ledger never moved.
    expect(r.store.creditBalance(ACCOUNT)).toBe(2);
    // And only once: with the weapon in place, the claim is closed.
    expect(forgeWeapon(deps, ACCOUNT, r.def.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining('already has'),
    });
    // A REBUILD before the seal replaces the model but keeps the forged
    // weapon: no second weapon pass, no lost claim.
    const rebuilt = buildModel(deps, ACCOUNT, r.def.id);
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) await rebuilt.done;
    expect(r.store.creditBalance(ACCOUNT)).toBe(1);
    const after = r.store.forgedAssets(r.def.id) as { weapon?: string };
    expect(after.weapon).toBe(`forged/${r.def.id}/weapon.glb`);
    // Three image-to-3D calls total: model, weapon, rebuilt model.
    expect(r.provider.seen.filter((s) => s.op === 'imageTo3D')).toHaveLength(3);
  });

  it('honors the player-picked animation family over the kit-implied one', async () => {
    // Sylra's kit implies staff; the player says blades (playtest: a
    // sword champion must swing a sword).
    const r = rig();
    const deps: ForgeDeps = { store: r.store, generation: r.pipeline, now: () => 999 };
    const built = buildModel(deps, ACCOUNT, r.def.id);
    expect(built.ok).toBe(true);
    if (built.ok) await built.done;
    const out = animateChampion(deps, ACCOUNT, r.def.id, 'slashing');
    expect(out.ok).toBe(true);
    if (out.ok) await out.done;
    expect((r.store.forgedAssets(r.def.id) as { family: string }).family).toBe('slashing');
    const animate = r.provider.seen.find((s) => s.op === 'animate');
    expect(animate?.req).toMatchObject({ family: 'slashing' });
  });

  it('fails and refunds when an artifact lands over its budget', async () => {
    const r = rig();
    r.pipeline.budgets = { modelKb: 100 };
    r.pipeline.fileSize = (p) => (p.includes('model_') ? 200 * 1024 : 10 * 1024);
    const start = startModelBuild(r.pipeline, { def: r.def, accountId: ACCOUNT });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    await start.done;
    const job = r.store.getGenerationJob(start.jobId);
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('budget');
    expect(r.store.getForged(r.def.id)?.status).toBe('draft');
    expect(r.store.creditBalance(ACCOUNT)).toBe(3);
  });

  it('refunds a build failure and leaves the draft a draft', async () => {
    const r = rig();
    r.provider.failOn.add('imageTo3D');
    const start = startModelBuild(r.pipeline, { def: r.def, accountId: ACCOUNT });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    await start.done;
    const job = r.store.getGenerationJob(start.jobId);
    expect(job?.status).toBe('failed');
    expect(job?.stage).toBe('model');
    expect(r.store.getForged(r.def.id)?.status).toBe('draft');
    expect(r.store.creditBalance(ACCOUNT)).toBe(3);
  });

  it('spends nothing on an animate failure, and the retry succeeds', async () => {
    const r = rig();
    const built = startModelBuild(r.pipeline, { def: r.def, accountId: ACCOUNT });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    await built.done;
    r.provider.failOn.add('rig');
    const failed = startAnimate(r.pipeline, {
      forgedId: r.def.id,
      accountId: ACCOUNT,
      family: 'slashing',
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    await failed.done;
    const job = r.store.getGenerationJob(failed.jobId);
    expect(job?.status).toBe('failed');
    expect(job?.stage).toBe('rig');
    // Still an inspectable draft, and NOTHING moved on the ledger: the
    // build's debit stands, no refund, no second debit.
    expect(r.store.getForged(r.def.id)?.status).toBe('draft');
    expect(r.store.creditBalance(ACCOUNT)).toBe(2);
    // The retry is free and seals.
    r.provider.failOn.delete('rig');
    const retry = startAnimate(r.pipeline, {
      forgedId: r.def.id,
      accountId: ACCOUNT,
      family: 'slashing',
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    await retry.done;
    expect(r.store.getForged(r.def.id)?.status).toBe('finalized');
    expect(r.store.creditBalance(ACCOUNT)).toBe(2);
  });

  it('blocks and refunds on failed classification', async () => {
    const r = rig(() => Promise.resolve(false));
    const start = startModelBuild(r.pipeline, { def: r.def, accountId: ACCOUNT });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    await start.done;
    const job = r.store.getGenerationJob(start.jobId);
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('blocked:');
    expect(r.store.creditBalance(ACCOUNT)).toBe(3);
  });

  it('refuses to start with no creations left', () => {
    const r = rig();
    for (let i = 0; i < 3; i++) {
      r.store.addCreditEntry({
        accountId: ACCOUNT,
        delta: -1,
        reason: 'finalize',
        ref: 'x',
        at: 1,
      });
    }
    const start = startModelBuild(r.pipeline, { def: r.def, accountId: ACCOUNT });
    expect(start).toMatchObject({ ok: false, error: expect.stringContaining('no creations') });
  });

  it('sweeps stale jobs, refunding builds and never the free chains', () => {
    const r = rig();
    r.store.addCreditEntry({
      accountId: ACCOUNT,
      delta: -1,
      reason: 'finalize',
      ref: r.def.id,
      at: 1,
    });
    // A build (the default kind, what a pre-split row also reads as), an
    // animate, and a weapon claim all died with the process.
    r.store.createGenerationJob(r.def.id, ACCOUNT, 1);
    r.store.createGenerationJob(r.def.id, ACCOUNT, 1, 'animate');
    r.store.createGenerationJob(r.def.id, ACCOUNT, 1, 'weapon');
    expect(recoverStaleJobs(r.store, () => 2)).toBe(3);
    // Exactly ONE refund: the build's. The free chains never debited.
    expect(r.store.creditBalance(ACCOUNT)).toBe(3);
    expect(r.store.staleRunningJobs()).toHaveLength(0);
  });
});

describe('the build and animate gates (server/forge.ts)', () => {
  it('demands a configured provider, full validity, and ownership', async () => {
    const r = rig();
    const deps: ForgeDeps = { store: r.store, generation: r.pipeline, now: () => 999 };

    const unconfigured = buildModel({ ...deps, generation: null }, ACCOUNT, r.def.id);
    expect(unconfigured).toMatchObject({ ok: false, error: expect.stringContaining('configured') });

    // An over-budget draft saves fine but cannot finalize.
    const greedy = { ...r.def, id: 'forged_gen_greedy' };
    greedy.base = {
      ...greedy.base,
      hp: 800,
      mana: 600,
      ad: 80,
      armor: 45,
      mr: 45,
      attackRange: 7.5,
      attackSpeed: 1,
      moveSpeed: 4.2,
      hpRegen: 3,
      manaRegen: 3,
    };
    greedy.growth = { hp: 130, mana: 60, ad: 7, armor: 4.5, mr: 3 };
    expect(saveDraft(deps, ACCOUNT, 'bob', greedy).ok).toBe(true);
    expect(buildModel(deps, ACCOUNT, greedy.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining('fully valid'),
    });

    // Another account cannot build what it does not own.
    expect(buildModel(deps, 99, r.def.id)).toMatchObject({ ok: false });

    // A fully valid kit with no chosen splash cannot seal: the art is the
    // anchor everything derives from (ADR 0010).
    const artless = { ...forgedTwin(CHAMPIONS.fenn!), id: 'forged_gen_artless' };
    expect(saveDraft(deps, ACCOUNT, 'bob', artless).ok).toBe(true);
    expect(buildModel(deps, ACCOUNT, artless.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining('splash'),
    });

    // A chosen splash without a chosen model reference cannot seal either:
    // the 3D builds from that exact image, so the player must pick it.
    const refCid = r.store.addArtCandidate({
      forgedId: artless.id,
      accountId: ACCOUNT,
      kind: 'splash',
      prompt: 'p',
      path: r.splashRel,
      provenance: null,
      at: 1,
    });
    r.store.chooseArtCandidate(artless.id, 'splash', refCid);
    expect(buildModel(deps, ACCOUNT, artless.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining('reference'),
    });

    const good = buildModel(deps, ACCOUNT, r.def.id);
    expect(good.ok).toBe(true);
    if (good.ok) await good.done;
    // Built but unsealed: another account still cannot animate it, and
    // the owner's animate with NO explicit family falls back to the
    // kit-implied one (sylra reads as staff).
    expect(animateChampion(deps, 99, r.def.id)).toMatchObject({ ok: false });
    const sealed = animateChampion(deps, ACCOUNT, r.def.id);
    expect(sealed.ok).toBe(true);
    if (sealed.ok) await sealed.done;
    expect((r.store.forgedAssets(r.def.id) as { family: string }).family).toBe('staff');
    // Sealed now: both halves refuse.
    expect(buildModel(deps, ACCOUNT, r.def.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining('already finalized'),
    });
    expect(animateChampion(deps, ACCOUNT, r.def.id)).toMatchObject({
      ok: false,
      error: expect.stringContaining('already animated'),
    });
  });
});

describe('the tripo provider against scripted responses', () => {
  it('maps all six clip roles for every weapon family', () => {
    for (const family of WEAPON_FAMILIES) {
      for (const role of CLIP_ROLES) {
        expect(TRIPO_CLIPS[family][role], `${family}/${role}`).toMatch(/^preset:biped:/);
      }
    }
  });

  it('creates, polls, and returns the asset with pinned provenance', async () => {
    const calls: { url: string; body?: unknown; auth?: string }[] = [];
    let polls = 0;
    const fetchFn = ((url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({
        url: u,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
        auth: (init?.headers as Record<string, string>)?.authorization,
      });
      if (u.endsWith('/generation/image-to-model')) {
        return Promise.resolve(
          new Response(JSON.stringify({ code: 0, data: { task_id: 'task-1' } })),
        );
      }
      if (u.endsWith('/tasks/task-1')) {
        polls += 1;
        const body =
          polls < 2
            ? { code: 0, data: { task_id: 'task-1', status: 'running' } }
            : {
                code: 0,
                data: {
                  task_id: 'task-1',
                  status: 'success',
                  output: { model: 'https://cdn.example.com/model.glb' },
                },
              };
        return Promise.resolve(new Response(JSON.stringify(body)));
      }
      return Promise.resolve(new Response('missing route', { status: 500 }));
    }) as typeof fetch;
    const provider = new TripoProvider('key-1', {
      fetchFn,
      sleep: () => Promise.resolve(),
      pollEveryMs: 1,
    });
    const asset = await provider.imageTo3D({ imageUrl: 'https://img.example.com/sheet.png' });
    expect(asset.url).toBe('https://cdn.example.com/model.glb');
    expect(asset.provenance).toMatchObject({ provider: 'tripo', taskId: 'task-1' });
    expect(calls[0]?.auth).toBe('Bearer key-1');
    // The live API refuses the call without an explicit model version.
    expect(calls[0]?.body).toMatchObject({
      input: 'https://img.example.com/sheet.png',
      model: 'v3.1-20260211',
    });
    expect(polls).toBe(2);
  });

  it('sends the rig model version and the family clip set', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchFn = ((_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        bodies.push(JSON.parse(init.body as string) as Record<string, unknown>);
        return Promise.resolve(new Response(JSON.stringify({ code: 0, data: { task_id: 't' } })));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: 0,
            data: { task_id: 't', status: 'success', output: { model: 'https://x.example/m.glb' } },
          }),
        ),
      );
    }) as typeof fetch;
    const provider = new TripoProvider('k', { fetchFn, sleep: () => Promise.resolve() });
    await provider.rig({ modelTaskId: 'model-task', rigType: 'biped' });
    expect(bodies[0]).toMatchObject({
      input: 'model-task',
      model: 'v1.0-20240301',
      rig_type: 'biped',
      spec: 'tripo',
    });
    await provider.animate({ riggedTaskId: 'rig-task', family: 'slashing' });
    expect(bodies[1]?.animations).toEqual(Object.values(TRIPO_CLIPS.slashing));
  });

  it('uploads to the v2 host and edits images through the advanced task', async () => {
    // Upload and image-to-model shapes verified against a live key
    // (2026-08-31); the advanced generate_image task follows
    // docs.tripo3d.ai (its first live 400 costs nothing: the 2D quota is
    // spent only on success).
    const calls: { url: string; body?: unknown }[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === 'https://api.tripo3d.ai/v2/openapi/upload/sts') {
        calls.push({ url: u });
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(JSON.stringify({ code: 0, data: { image_token: 'tok-9' } }));
      }
      if (init?.method === 'POST') {
        calls.push({ url: u, body: JSON.parse(init.body as string) });
        return new Response(JSON.stringify({ code: 0, data: { task_id: 't' } }));
      }
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            task_id: 't',
            status: 'success',
            output: { generated_image_url: 'https://x.example/sheet.png' },
          },
        }),
      );
    }) as typeof fetch;
    const provider = new TripoProvider('k', { fetchFn, sleep: () => Promise.resolve() });
    const token = await provider.uploadImage({ data: new Uint8Array([1, 2]), name: 'splash.png' });
    expect(token).toBe('tok-9');
    const asset = await provider.generate2D({ prompt: 'more thorns', image: token });
    expect(asset.url).toBe('https://x.example/sheet.png');
    // Every 2D generation rides the advanced generate_image task with the
    // strong default model; with an image it instruction-edits it.
    expect(calls[1]?.url).toBe('https://api.tripo3d.ai/v2/openapi/task');
    expect(calls[1]?.body).toMatchObject({
      type: 'generate_image',
      model_version: 'gpt_image_2',
      prompt: 'more thorns',
      file: { type: 'png', file_token: 'tok-9' },
    });
    expect(calls[1]?.body).not.toHaveProperty('t_pose');
    // Text-only (the first splash) rides the same task and model, with no
    // file field at all.
    await provider.generate2D({ prompt: 'a fresh splash' });
    expect(calls[2]?.url).toBe('https://api.tripo3d.ai/v2/openapi/task');
    expect(calls[2]?.body).toMatchObject({ type: 'generate_image', model_version: 'gpt_image_2' });
    expect(calls[2]?.body).not.toHaveProperty('file');
    // The reference derivation asks for the rig-ready pose.
    await provider.generate2D({ prompt: 'reference', image: token, tPose: true });
    expect(calls[3]?.body).toMatchObject({ t_pose: true });
    // The token drives image-to-model as file.file_token (the staged
    // finalize path; input.file_token is refused live with 1004).
    await provider.imageTo3D({ image: token });
    expect(calls[4]?.url).toContain('/generation/image-to-model');
    expect(calls[4]?.body).toMatchObject({ file: { type: 'png', file_token: 'tok-9' } });
    expect(calls[4]?.body).not.toHaveProperty('input');
    // TRIPO_IMAGE_MODEL picks another documented edit model.
    const gemini = new TripoProvider('k', {
      fetchFn,
      sleep: () => Promise.resolve(),
      imageModel: 'gemini_3_pro_image_preview',
    });
    await gemini.generate2D({ prompt: 'x', image: token });
    expect(calls[5]?.body).toMatchObject({ model_version: 'gemini_3_pro_image_preview' });
  });

  it('reads the credit balance and answers -1 on any failure', async () => {
    const fetchFn = (async (url: string | URL) => {
      if (String(url) === 'https://api.tripo3d.ai/v2/openapi/user/balance') {
        return new Response(JSON.stringify({ code: 0, data: { balance: 995, frozen: 0 } }));
      }
      return new Response('no', { status: 500 });
    }) as typeof fetch;
    const provider = new TripoProvider('k', { fetchFn, sleep: () => Promise.resolve() });
    expect(await provider.balance()).toBe(995);
    const failing = new TripoProvider('k', {
      fetchFn: (() => Promise.reject(new Error('down'))) as typeof fetch,
    });
    expect(await failing.balance()).toBe(-1);
  });

  it('turns a banned task into a blocked GenerationError', async () => {
    const fetchFn = ((_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ code: 0, data: { task_id: 't' } })));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ code: 0, data: { task_id: 't', status: 'banned' } })),
      );
    }) as typeof fetch;
    const provider = new TripoProvider('k', { fetchFn, sleep: () => Promise.resolve() });
    const failure = await provider
      .generate2D({ prompt: 'x' })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(GenerationError);
    expect((failure as GenerationError).blocked).toBe(true);
  });
});

describe('the implied weapon family', () => {
  it('reads range and role the way the roster would', () => {
    expect(familyOf(forgedTwin(CHAMPIONS.korrath!))).toBe('blunt');
    expect(familyOf(forgedTwin(CHAMPIONS.fenn!))).toBe('slashing');
    expect(familyOf(forgedTwin(CHAMPIONS.vesk!))).toBe('bow');
    expect(familyOf(forgedTwin(CHAMPIONS.sylra!))).toBe('staff');
  });
});
