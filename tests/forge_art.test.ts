// The 2D art surface (plan-forge phase 4): splash and icon candidates on
// the gen2d meter. Server-owned style blocks over the player's line, the
// quota spent only when a provider call succeeds, per-kind history with a
// pruning cap that never eats the chosen candidate, owner and seal gates,
// and the delete path taking candidate files along.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ART_KINDS,
  type ArtDeps,
  chooseArt,
  chosenIcons,
  deleteArtFor,
  generateArt,
  ICON_STYLE,
  iterationPrompt,
  listArt,
  SHEET_MATCH,
  SHEET_STYLE,
  SPLASH_STYLE,
  splashLine,
  splashOf,
} from '../server/art';
import { saveDraft } from '../server/forge';
import { ForgeStore } from '../server/forge_store';
import { MockProvider } from '../server/generation/mock';
import type { PipelineDeps } from '../server/generation/pipeline';
import { placeholderFor } from '../server/generation/placeholder';
import type { QuotaDeps } from '../server/quotas';
import { CHAMPIONS } from '../src/sim/content/champions';
import { forgedTwin } from './forged_twins';

const ACCOUNT = 4;
const dirs: string[] = [];
const open: ForgeStore[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function rig(opts: { limit?: number; cap?: number } = {}) {
  const store = new ForgeStore(':memory:');
  open.push(store);
  const assetsDir = mkdtempSync(path.join(tmpdir(), 'loc-art-'));
  dirs.push(assetsDir);
  const provider = new MockProvider(() => 500);
  const generation: PipelineDeps = {
    storage: store,
    provider,
    assetsDir,
    download: (url, dest) => {
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, placeholderFor(url, dest));
      return Promise.resolve();
    },
  };
  let clock = 1000;
  const quota: QuotaDeps = {
    store,
    limits: { generation: 5, gen2d: opts.limit ?? 10, agent: 5 },
    now: () => clock,
  };
  const deps: ArtDeps = {
    store,
    generation,
    quota,
    historyCap: opts.cap ?? 12,
    now: () => clock,
  };
  const def = { ...forgedTwin(CHAMPIONS.sylra!), id: 'forged_art_test' };
  const saved = saveDraft({ store }, ACCOUNT, 'ana', def);
  if (!saved.ok) throw new Error(saved.error);
  return {
    store,
    provider,
    deps,
    def,
    tick: () => {
      clock += 1;
    },
  };
}

describe('generateArt', () => {
  it('stores a candidate, spends one gen2d unit, and picks the first of a kind', async () => {
    const r = rig();
    const out = await generateArt(r.deps, ACCOUNT, {
      id: r.def.id,
      kind: 'splash',
      line: 'a moss-green witch under a pointed hat',
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.candidate.kind).toBe('splash');
    expect(out.candidate.chosen).toBe(true);
    expect(out.quota).toEqual({ used: 1, limit: 10 });
    // The file landed for real, under the champion's art directory.
    const generation = r.deps.generation;
    expect(generation).not.toBeNull();
    if (!generation) return;
    expect(existsSync(path.join(generation.assetsDir, out.candidate.path))).toBe(true);
    // The prompt is the server's style block plus the player's line.
    const row = r.store.getArtCandidate(out.candidate.cid);
    expect(row?.prompt.startsWith(SPLASH_STYLE)).toBe(true);
    expect(row?.prompt).toContain('moss-green witch');
  });

  it('derives the model reference from the chosen splash, and requires one', async () => {
    const r = rig();
    // No chosen splash yet: the reference has nothing to derive from.
    const early = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind: 'sheet', line: '' });
    expect(early).toMatchObject({ ok: false, error: expect.stringContaining('splash') });

    const splash = await generateArt(r.deps, ACCOUNT, {
      id: r.def.id,
      kind: 'splash',
      line: 'a moss witch',
    });
    if (!splash.ok) throw new Error('setup');
    const sheet = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind: 'sheet', line: '' });
    expect(sheet.ok).toBe(true);
    if (!sheet.ok) return;
    // The chosen splash file rode up as the image input.
    const upload = r.provider.seen.find((s) => s.op === 'uploadImage');
    expect(upload?.req).toMatchObject({ name: path.basename(splash.candidate.path) });
    const call = r.provider.seen.filter((s) => s.op === 'generate2D').at(-1);
    expect(call?.req).toMatchObject({ image: expect.stringContaining('mock-upload-') });
    const row = r.store.getArtCandidate(sheet.candidate.cid);
    expect(row?.prompt.startsWith(SHEET_STYLE)).toBe(true);
    expect(row?.prompt).toContain(r.def.name);
    // The splash's appearance words ride the derivation: the image input
    // alone keeps only the broad concept (learned live).
    expect(row?.prompt).toContain('Appearance: a moss witch');
    expect(row?.prompt).toContain(SHEET_MATCH);
  });

  it('iterates on an existing candidate via fromCid, same kind only', async () => {
    const r = rig();
    const first = await generateArt(r.deps, ACCOUNT, {
      id: r.def.id,
      kind: 'splash',
      line: 'a moss witch',
    });
    if (!first.ok) throw new Error('setup');
    const refined = await generateArt(r.deps, ACCOUNT, {
      id: r.def.id,
      kind: 'splash',
      line: 'same witch, more thorns on the staff',
      fromCid: first.candidate.cid,
    });
    expect(refined.ok).toBe(true);
    // The source candidate's file was uploaded and rode the generation.
    const upload = r.provider.seen.find((s) => s.op === 'uploadImage');
    expect(upload?.req).toMatchObject({ name: path.basename(first.candidate.path) });
    const call = r.provider.seen.filter((s) => s.op === 'generate2D').at(-1);
    expect(call?.req).toMatchObject({ image: expect.stringContaining('mock-upload-') });
    // The iteration KEEPS the source prompt and appends the note as an
    // adjustment: the note alone would replace the character (learned
    // live: 'make him more visible' produced a different champion).
    const sourceRow = r.store.getArtCandidate(first.candidate.cid);
    const refinedRow = r.store.getArtCandidate(refined.ok ? refined.candidate.cid : -1);
    expect(sourceRow).not.toBeNull();
    expect(refinedRow?.prompt).toBe(
      `${sourceRow?.prompt} Adjustment: same witch, more thorns on the staff.`,
    );
    // An empty note is a pure re-roll from the image: same prompt.
    const reroll = await generateArt(r.deps, ACCOUNT, {
      id: r.def.id,
      kind: 'splash',
      line: '',
      fromCid: first.candidate.cid,
    });
    expect(reroll.ok).toBe(true);
    const rerollRow = r.store.getArtCandidate(reroll.ok ? reroll.candidate.cid : -1);
    expect(rerollRow?.prompt).toBe(sourceRow?.prompt);
    // A candidate of another kind is not a valid starting point.
    const cross = await generateArt(r.deps, ACCOUNT, {
      id: r.def.id,
      kind: 'icon_Q',
      line: '',
      fromCid: first.candidate.cid,
    });
    expect(cross).toMatchObject({ ok: false, error: expect.stringContaining('iterate') });
  });

  it('extracts the splash line and composes iteration prompts', () => {
    expect(splashLine(`${SPLASH_STYLE} The champion: a moss witch`)).toBe('a moss witch');
    expect(splashLine('no marker here')).toBe('');
    expect(iterationPrompt('base prompt.', '')).toBe('base prompt.');
    expect(iterationPrompt('base prompt.', 'lighter')).toBe('base prompt. Adjustment: lighter.');
  });

  it('composes icon prompts from the flat template and the ability name', async () => {
    const r = rig();
    const out = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind: 'icon_Q', line: '' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const row = r.store.getArtCandidate(out.candidate.cid);
    expect(row?.prompt.startsWith(ICON_STYLE)).toBe(true);
    expect(row?.prompt).toContain(r.def.abilities.Q.name);
  });

  it('refuses past the daily limit, and a provider failure burns nothing', async () => {
    const r = rig({ limit: 2 });
    for (let i = 0; i < 2; i++) {
      r.tick();
      const ok = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind: 'splash', line: 'x' });
      expect(ok.ok).toBe(true);
    }
    const refused = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind: 'splash', line: 'x' });
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('daily limit') });

    const r2 = rig({ limit: 2 });
    r2.provider.failOn.add('generate2D');
    const failed = await generateArt(r2.deps, ACCOUNT, {
      id: r2.def.id,
      kind: 'splash',
      line: 'x',
    });
    expect(failed.ok).toBe(false);
    r2.provider.failOn.delete('generate2D');
    // Both units are still there: the failure was not metered.
    for (let i = 0; i < 2; i++) {
      r2.tick();
      const ok = await generateArt(r2.deps, ACCOUNT, { id: r2.def.id, kind: 'splash', line: 'x' });
      expect(ok.ok).toBe(true);
    }
  });

  it('gates on kind, words, ownership, the splash line, and the seal', async () => {
    const r = rig();
    const bad = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind: 'poster', line: 'x' });
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining('kind') });
    const sworn = await generateArt(r.deps, ACCOUNT, {
      id: r.def.id,
      kind: 'splash',
      line: 'a nazi in a hat',
    });
    expect(sworn).toMatchObject({ ok: false, error: expect.stringContaining('different words') });
    const notMine = await generateArt(r.deps, 99, { id: r.def.id, kind: 'splash', line: 'x' });
    expect(notMine).toMatchObject({ ok: false });
    const wordless = await generateArt(r.deps, ACCOUNT, {
      id: r.def.id,
      kind: 'splash',
      line: ' ',
    });
    expect(wordless).toMatchObject({ ok: false, error: expect.stringContaining('describe') });
    r.store.setForgedFinalized(r.def.id, { model: 'm.glb' }, 2000);
    const sealed = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind: 'splash', line: 'x' });
    expect(sealed).toMatchObject({ ok: false, error: expect.stringContaining('sealed') });
  });

  it('prunes the oldest unchosen candidates past the cap and unlinks their files', async () => {
    const r = rig({ cap: 2 });
    const paths: string[] = [];
    for (let i = 0; i < 4; i++) {
      r.tick();
      const out = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind: 'splash', line: 'x' });
      expect(out.ok).toBe(true);
      if (out.ok) paths.push(out.candidate.path);
    }
    const left = listArt(r.deps, ACCOUNT, r.def.id);
    expect(left.ok).toBe(true);
    if (!left.ok) return;
    // The chosen first candidate survives the cap; of the three unchosen,
    // only the two newest remain.
    expect(left.candidates.map((c) => c.path)).toEqual([paths[0], paths[2], paths[3]]);
    const generation = r.deps.generation;
    if (!generation) return;
    expect(existsSync(path.join(generation.assetsDir, paths[1] ?? ''))).toBe(false);
    expect(existsSync(path.join(generation.assetsDir, paths[3] ?? ''))).toBe(true);
  });
});

describe('chooseArt and the pick', () => {
  it('moves the pick between candidates of the same kind', async () => {
    const r = rig();
    const first = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind: 'splash', line: 'x' });
    r.tick();
    const second = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind: 'splash', line: 'y' });
    if (!first.ok || !second.ok) throw new Error('setup');
    expect(second.candidate.chosen).toBe(false);
    const picked = chooseArt(r.deps, ACCOUNT, { id: r.def.id, cid: second.candidate.cid });
    expect(picked.ok).toBe(true);
    expect(r.store.chosenArt(r.def.id, 'splash')?.id).toBe(second.candidate.cid);
    // A candidate from another champion is refused.
    const other = { ...forgedTwin(CHAMPIONS.fenn!), id: 'forged_art_other' };
    expect(saveDraft({ store: r.store }, ACCOUNT, 'ana', other).ok).toBe(true);
    expect(chooseArt(r.deps, ACCOUNT, { id: other.id, cid: second.candidate.cid })).toMatchObject({
      ok: false,
    });
  });
});

describe('splashOf, chosenIcons, deleteArtFor', () => {
  it('answers the chosen candidate for drafts and the sealed path once finalized', async () => {
    const r = rig();
    const row = r.store.getForged(r.def.id);
    if (!row) throw new Error('setup');
    expect(splashOf(r.store, row)).toBeNull();
    const gen = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind: 'splash', line: 'x' });
    if (!gen.ok) throw new Error('setup');
    const draft = r.store.getForged(r.def.id);
    if (!draft) throw new Error('setup');
    expect(splashOf(r.store, draft)).toBe(gen.candidate.path);
    r.store.setForgedFinalized(r.def.id, { splash: 'forged/x/sealed.png' }, 2000);
    const sealed = r.store.getForged(r.def.id);
    if (!sealed) throw new Error('setup');
    expect(splashOf(r.store, sealed)).toBe('forged/x/sealed.png');
  });

  it('collects the chosen icons by slot and deletes candidates with the draft', async () => {
    const r = rig();
    for (const kind of ART_KINDS) {
      r.tick();
      const out = await generateArt(r.deps, ACCOUNT, { id: r.def.id, kind, line: 'x' });
      expect(out.ok).toBe(true);
    }
    const icons = chosenIcons(r.store, r.def.id);
    expect(Object.keys(icons).sort()).toEqual(['E', 'Q', 'R', 'W']);
    const all = listArt(r.deps, ACCOUNT, r.def.id);
    if (!all.ok) throw new Error('setup');
    const generation = r.deps.generation;
    if (!generation) return;
    deleteArtFor(r.deps, r.def.id);
    expect(r.store.listArtCandidates(r.def.id)).toHaveLength(0);
    for (const c of all.candidates) {
      expect(existsSync(path.join(generation.assetsDir, c.path))).toBe(false);
    }
  });
});
