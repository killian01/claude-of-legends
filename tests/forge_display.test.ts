// Display tuning for forged champions (ADR 0010, the workshop's live
// adjustments): the shared sanitizer's clamps, the server policy's owner
// and finalized gates, and the merge that never loses the sealed assets.

import { describe, expect, it } from 'vitest';
import { displayOf, forgedMatchAssets, setForgedDisplay } from '../server/display';
import { ForgeStore } from '../server/forge_store';
import { sanitizeForgedDisplay } from '../src/sim/forge/display';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { FORGED_TWINS } from './forged_twins';

function twin(i: number, id: string, creator: string): ForgedChampionDef {
  return { ...FORGED_TWINS[i]!, id, creator };
}

function seeded(): ForgeStore {
  const store = new ForgeStore(':memory:');
  store.saveForged({
    id: 'forged_a',
    accountId: 1,
    def: twin(0, 'forged_a', 'alice'),
    status: 'finalized',
    createdAt: 1,
    updatedAt: 10,
  });
  store.setForgedFinalized('forged_a', { model: 'forged/forged_a/model.glb', family: 'staff' }, 10);
  store.saveForged({
    id: 'forged_draft',
    accountId: 1,
    def: twin(1, 'forged_draft', 'alice'),
    status: 'draft',
    createdAt: 2,
    updatedAt: 20,
  });
  return store;
}

describe('sanitizeForgedDisplay', () => {
  it('clamps every numeric field into its bounds', () => {
    const out = sanitizeForgedDisplay({ height: 99, yOffset: -9, yawOffset: 42 });
    // yOffset floors at zero: the ground is the ground (playtest).
    expect(out).toEqual({ height: 4.5, yOffset: 0, yawOffset: Math.PI });
  });

  it('keeps only recognized fields and drops non-numbers', () => {
    const out = sanitizeForgedDisplay({ height: 'tall', hax: true, yOffset: 0.25 });
    expect(out).toEqual({ yOffset: 0.25 });
  });

  it('accepts a prop, clamps its triples and scale, refuses unknown kinds', () => {
    const out = sanitizeForgedDisplay({
      prop: { kind: 'maul', bone: 'R_Hand', rot: [9, -9, 0.5], pos: [3, 'x', -3], scale: 9 },
    });
    expect(out?.prop).toEqual({
      kind: 'maul',
      bone: 'R_Hand',
      rot: [Math.PI, -Math.PI, 0.5],
      pos: [2, 0, -2],
      scale: 2.5,
    });
    // No scale sent: none stored (the renderer default of 1 applies).
    expect(
      sanitizeForgedDisplay({ prop: { kind: 'maul', bone: 'R_Hand' } })?.prop,
    ).not.toHaveProperty('scale');
    expect(
      sanitizeForgedDisplay({ prop: { kind: 'maul', bone: 'R_Hand', scale: 0.1 } })?.prop,
    ).toMatchObject({ scale: 0.4 });
    expect(sanitizeForgedDisplay({ prop: { kind: 'bazooka', bone: 'R_Hand' } })?.prop).toBe(
      undefined,
    );
    // The old procedural kinds are gone; a stored one drops cleanly.
    expect(sanitizeForgedDisplay({ prop: { kind: 'sword', bone: 'R_Hand' } })?.prop).toBe(
      undefined,
    );
    // The champion's own generated weapon is a kind of its own.
    expect(
      sanitizeForgedDisplay({ prop: { kind: 'generated', bone: 'R_Hand' } })?.prop,
    ).toMatchObject({ kind: 'generated' });
    // A prop needs a bone, except the explicit empty hand.
    expect(sanitizeForgedDisplay({ prop: { kind: 'maul', bone: '' } })?.prop).toBe(undefined);
    expect(sanitizeForgedDisplay({ prop: { kind: 'none', bone: '' } })?.prop).toMatchObject({
      kind: 'none',
    });
  });

  it('answers null for a non-object', () => {
    expect(sanitizeForgedDisplay('nope')).toBe(null);
    expect(sanitizeForgedDisplay(null)).toBe(null);
  });
});

describe('setForgedDisplay', () => {
  it('stores the clamped tuning and keeps the sealed assets around it', () => {
    const store = seeded();
    const out = setForgedDisplay({ store, now: () => 50 }, 1, 'forged_a', {
      height: 3.1,
      yawOffset: 0.5,
      prop: { kind: 'maul', bone: 'R_Hand', rot: [0, 0, 0], pos: [0, 0.1, 0] },
    });
    expect(out.ok).toBe(true);
    const assets = store.forgedAssets('forged_a') as Record<string, unknown>;
    // The merge never loses the sealed pointers.
    expect(assets.model).toBe('forged/forged_a/model.glb');
    expect(assets.family).toBe('staff');
    expect(displayOf(store, 'forged_a')).toMatchObject({ height: 3.1, yawOffset: 0.5 });
    store.close();
  });

  it('builds the match_start forgedAssets block per definition', () => {
    const store = seeded();
    setForgedDisplay({ store, now: () => 50 }, 1, 'forged_a', { height: 3.0 });
    const block = forgedMatchAssets(store, [
      twin(0, 'forged_a', 'alice'),
      twin(1, 'forged_missing', 'bob'),
    ]);
    expect(block.forged_a).toEqual({
      model: 'forged/forged_a/model.glb',
      family: 'staff',
      weapon: null,
      // Sealed before per-clip picks existed: the renderer falls back to
      // clip-name matching, and there are no per-role clip files.
      clips: null,
      clipFiles: null,
      display: { height: 3.0 },
      icons: {},
    });
    // An unknown or asset-less definition still answers, with nulls: the
    // client keeps the procedural figure.
    expect(block.forged_missing).toEqual({
      model: null,
      family: null,
      weapon: null,
      clips: null,
      clipFiles: null,
      display: null,
      icons: {},
    });
    store.close();
  });

  it('carries the chosen spell icons, the sealed copy when no candidate remains', () => {
    // Playtest: a forged champion played with procedural icons, the ones
    // its creator chose never left the Forge. The block carries them by
    // slot, as the Forge shows them (the chosen candidates), and falls
    // back to the copy the pipeline sealed when the candidates are gone.
    const store = seeded();
    const candidate = (key: string, n: number): number =>
      store.addArtCandidate({
        forgedId: 'forged_a',
        accountId: 1,
        kind: `icon_${key}`,
        prompt: 'p',
        path: `forged/forged_a/art/icon_${key}_${n}.png`,
        provenance: null,
        at: n,
      });
    candidate('Q', 1);
    store.chooseArtCandidate('forged_a', 'icon_Q', candidate('Q', 2));
    store.chooseArtCandidate('forged_a', 'icon_R', candidate('R', 3));
    // The sealed copy dates from the last animation: a later pick wins.
    store.updateForgedAssets(
      'forged_a',
      { model: 'forged/forged_a/model.glb', family: 'staff', icons: { Q: 'forged/old_q.png' } },
      30,
    );
    let block = forgedMatchAssets(store, [twin(0, 'forged_a', 'alice')]);
    expect(block.forged_a?.icons).toEqual({
      Q: 'forged/forged_a/art/icon_Q_2.png',
      R: 'forged/forged_a/art/icon_R_3.png',
    });
    store.deleteArtCandidates('forged_a');
    block = forgedMatchAssets(store, [twin(0, 'forged_a', 'alice')]);
    expect(block.forged_a?.icons).toEqual({ Q: 'forged/old_q.png' });
    // A malformed sealed copy reads as none, never as a crash.
    store.updateForgedAssets('forged_a', { model: 'forged/forged_a/model.glb', icons: 7 }, 40);
    expect(forgedMatchAssets(store, [twin(0, 'forged_a', 'alice')]).forged_a?.icons).toEqual({});
    store.close();
  });

  it('shows the rigged body the moment the rig lands, before any clip bakes', () => {
    // The rig is its own step now, and it is what the workshop needs to
    // hang a weapon on a hand bone: a champion with a skeleton and no
    // animations yet must already show the skeleton's body.
    const store = seeded();
    store.updateForgedAssets(
      'forged_a',
      {
        model: 'forged/forged_a/model_1.glb',
        rigged: 'forged/forged_a/rigged_2.glb',
        rigTask: 'rig-t',
      },
      20,
    );
    const block = forgedMatchAssets(store, [twin(0, 'forged_a', 'alice')]);
    expect(block.forged_a).toMatchObject({
      model: 'forged/forged_a/rigged_2.glb',
      clips: null,
      clipFiles: null,
    });
    store.close();
  });

  it('leaves a pre-split champion on the model file its clips live inside', () => {
    // Rigging one of those (its own step now) must not cost it the
    // animations baked into its single model file: it keeps that file
    // until its first re-bake produces clip files.
    const store = seeded();
    store.setForgedFinalized(
      'forged_a',
      {
        model: 'forged/forged_a/model_1.glb',
        rigged: 'forged/forged_a/rigged_2.glb',
        rigTask: 'rig-t',
        clips: { idle: 'idle', run: 'run', attack: 'attack', cast: 'cast', death: 'death' },
      },
      20,
    );
    expect(forgedMatchAssets(store, [twin(0, 'forged_a', 'alice')]).forged_a).toMatchObject({
      model: 'forged/forged_a/model_1.glb',
      clipFiles: null,
    });
    store.close();
  });

  it('shows the rigged body plus clip files once a champion bakes per clip', () => {
    const store = seeded();
    store.setForgedFinalized(
      'forged_a',
      {
        model: 'forged/forged_a/model_1.glb',
        rigged: 'forged/forged_a/rigged_2.glb',
        rigTask: 'rig-t',
        family: 'staff',
        clips: { idle: 'preset:biped:idle' },
        clipFiles: { idle: 'forged/forged_a/clips_2.glb' },
      },
      20,
    );
    const block = forgedMatchAssets(store, [twin(0, 'forged_a', 'alice')]);
    expect(block.forged_a).toMatchObject({
      model: 'forged/forged_a/rigged_2.glb',
      clips: { idle: 'preset:biped:idle' },
      clipFiles: { idle: 'forged/forged_a/clips_2.glb' },
    });
    store.close();
  });

  it('refuses another account, a modelless draft, and garbage', () => {
    const store = seeded();
    expect(setForgedDisplay({ store }, 2, 'forged_a', { height: 2 }).ok).toBe(false);
    expect(setForgedDisplay({ store }, 1, 'forged_draft', { height: 2 }).ok).toBe(false);
    expect(setForgedDisplay({ store }, 1, 'forged_a', 'garbage').ok).toBe(false);
    expect(displayOf(store, 'forged_a')).toBe(null);
    store.close();
  });

  it('tunes a built-but-unsealed draft: validating happens BEFORE the seal', () => {
    // The two-phase build leaves the static model on a draft row; the
    // workshop must be able to save tuning on it.
    const store = seeded();
    store.updateForgedAssets(
      'forged_draft',
      { model: 'forged/forged_draft/model_1.glb', modelTask: 't-1' },
      30,
    );
    const out = setForgedDisplay({ store, now: () => 50 }, 1, 'forged_draft', { height: 3.0 });
    expect(out.ok).toBe(true);
    expect(displayOf(store, 'forged_draft')).toEqual({ height: 3.0 });
    store.close();
  });
});
