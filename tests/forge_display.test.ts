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

  it('accepts a prop, clamps its triples, refuses unknown kinds', () => {
    const out = sanitizeForgedDisplay({
      prop: { kind: 'maul', bone: 'R_Hand', rot: [9, -9, 0.5], pos: [3, 'x', -3] },
    });
    expect(out?.prop).toEqual({
      kind: 'maul',
      bone: 'R_Hand',
      rot: [Math.PI, -Math.PI, 0.5],
      pos: [2, 0, -2],
    });
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
      // clip-name matching.
      clips: null,
      display: { height: 3.0 },
    });
    // An unknown or asset-less definition still answers, with nulls: the
    // client keeps the procedural figure.
    expect(block.forged_missing).toEqual({
      model: null,
      family: null,
      weapon: null,
      clips: null,
      display: null,
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
