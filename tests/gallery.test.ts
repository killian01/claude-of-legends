// The gallery (plan-forge phase 7): listing policy, likes, reports with
// automatic takedown and creator warnings, the creator's two switches,
// the play permission rule, and the store's in-place column migration.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { ForgeStore } from '../server/forge_store';
import {
  canPlayForged,
  type GalleryDeps,
  listGallery,
  reportForged,
  setVisibility,
  toggleLike,
} from '../server/gallery';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { FORGED_TWINS } from './forged_twins';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Distinct ids per test file run; the twins provide valid defs.
function twin(i: number, id: string, creator: string): ForgedChampionDef {
  return { ...FORGED_TWINS[i]!, id, creator };
}

function seeded(): { store: ForgeStore; deps: GalleryDeps } {
  const store = new ForgeStore(':memory:');
  const deps: GalleryDeps = { store, reportThreshold: 2, now: () => 1000 };
  // Account 1 owns a finalized champion and a draft; account 2 owns one.
  store.saveForged({
    id: 'forged_a',
    accountId: 1,
    def: twin(0, 'forged_a', 'alice'),
    status: 'finalized',
    createdAt: 1,
    updatedAt: 10,
  });
  store.saveForged({
    id: 'forged_b',
    accountId: 2,
    def: twin(1, 'forged_b', 'bob'),
    status: 'finalized',
    createdAt: 2,
    updatedAt: 20,
  });
  store.saveForged({
    id: 'forged_draft',
    accountId: 1,
    def: twin(2, 'forged_draft', 'alice'),
    status: 'draft',
    createdAt: 3,
    updatedAt: 30,
  });
  return { store, deps };
}

describe('gallery listing', () => {
  it('lists finalized champions only, recent first, with like and owner flags', () => {
    const { store, deps } = seeded();
    const out = listGallery(deps, 1);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.entries.map((e) => e.id)).toEqual(['forged_b', 'forged_a']);
    expect(out.entries[1]).toMatchObject({ mine: true, creator: 'alice', likes: 0 });
    store.close();
  });

  it('searches names and creators, sorts by likes when asked', () => {
    const { store, deps } = seeded();
    store.setLike(3, 'forged_a', true, 1);
    store.setLike(4, 'forged_a', true, 1);
    const popular = listGallery(deps, 3, { sort: 'popular' });
    if (!popular.ok) throw new Error('popular failed');
    expect(popular.entries.map((e) => e.id)).toEqual(['forged_a', 'forged_b']);
    expect(popular.entries[0]).toMatchObject({ likes: 2, likedByMe: true });
    const byCreator = listGallery(deps, 3, { q: 'bob' });
    if (!byCreator.ok) throw new Error('search failed');
    expect(byCreator.entries.map((e) => e.id)).toEqual(['forged_b']);
    store.close();
  });

  it('an unlisted champion stays visible to its owner alone; playable follows shared and listed', () => {
    const { store, deps } = seeded();
    expect(setVisibility(deps, 1, 'forged_a', { listed: false }).ok).toBe(true);
    const asOther = listGallery(deps, 2);
    if (!asOther.ok) throw new Error('list failed');
    expect(asOther.entries.map((e) => e.id)).toEqual(['forged_b']);
    const asOwner = listGallery(deps, 1);
    if (!asOwner.ok) throw new Error('list failed');
    expect(asOwner.entries.map((e) => e.id)).toEqual(['forged_b', 'forged_a']);
    // The community tab is a public space: unlisted drops out of playable.
    const playable = listGallery(deps, 1, { playable: true });
    if (!playable.ok) throw new Error('list failed');
    expect(playable.entries.map((e) => e.id)).toEqual(['forged_b']);
    store.close();
  });

  it('the switches are owner-only and finalized-only', () => {
    const { store, deps } = seeded();
    expect(setVisibility(deps, 2, 'forged_a', { listed: false }).ok).toBe(false);
    expect(setVisibility(deps, 1, 'forged_draft', { shared: false }).ok).toBe(false);
    store.close();
  });

  it('a seal that no longer validates shows its owner alone, flagged, and plays nowhere', () => {
    const { store, deps } = seeded();
    // A champion sealed before the burst cap (ADR 0015): one nuke on a
    // long cooldown the budget was happy to sell.
    const stale = twin(0, 'forged_stale', 'alice');
    stale.abilities = {
      ...stale.abilities,
      Q: {
        name: 'Old Nuke',
        manaCost: 120,
        cooldown: 20,
        castRange: 9,
        spec: {
          kind: 'skillshot',
          speed: 22,
          radius: 0.7,
          range: 9,
          onHit: [{ kind: 'damage', base: 320, adRatio: 2.2, dtype: 'physical' }],
        },
      },
    };
    store.saveForged({
      id: 'forged_stale',
      accountId: 1,
      def: stale,
      status: 'finalized',
      createdAt: 4,
      updatedAt: 40,
    });
    const asOwner = listGallery(deps, 1);
    if (!asOwner.ok) throw new Error('list failed');
    expect(asOwner.entries.find((e) => e.id === 'forged_stale')).toMatchObject({
      mine: true,
      valid: false,
    });
    expect(asOwner.entries.find((e) => e.id === 'forged_a')?.valid).toBe(true);
    const asOther = listGallery(deps, 2);
    if (!asOther.ok) throw new Error('list failed');
    expect(asOther.entries.map((e) => e.id)).not.toContain('forged_stale');
    const playable = listGallery(deps, 1, { playable: true });
    if (!playable.ok) throw new Error('list failed');
    expect(playable.entries.map((e) => e.id)).not.toContain('forged_stale');
    store.close();
  });
});

describe('likes', () => {
  it('toggles once per account and counts distinct likers', () => {
    const { store, deps } = seeded();
    expect(toggleLike(deps, 2, 'forged_a', true)).toMatchObject({ ok: true, likes: 1 });
    expect(toggleLike(deps, 2, 'forged_a', true)).toMatchObject({ ok: true, likes: 1 });
    expect(toggleLike(deps, 3, 'forged_a', true)).toMatchObject({ ok: true, likes: 2 });
    expect(toggleLike(deps, 2, 'forged_a', false)).toMatchObject({ ok: true, likes: 1 });
    expect(toggleLike(deps, 2, 'forged_draft', true).ok).toBe(false);
    store.close();
  });
});

describe('reports and takedown', () => {
  it('reports from distinct accounts trip the takedown and warn the creator', () => {
    const { store, deps } = seeded();
    // Your own champion cannot be reported, and a reason is required.
    expect(reportForged(deps, 1, 'forged_a', 'x').ok).toBe(false);
    expect(reportForged(deps, 2, 'forged_a', '   ').ok).toBe(false);
    expect(reportForged(deps, 2, 'forged_a', 'stolen art')).toMatchObject({
      ok: true,
      takenDown: false,
    });
    // The same account reporting twice still counts once.
    expect(reportForged(deps, 2, 'forged_a', 'again')).toMatchObject({
      ok: true,
      takenDown: false,
    });
    expect(reportForged(deps, 3, 'forged_a', 'agreed')).toMatchObject({
      ok: true,
      takenDown: true,
    });
    expect(store.getForged('forged_a')?.takenDown).toBe(true);
    expect(store.warningCount(1)).toBe(1);
    // Down means gone: from the gallery, and from play for everyone.
    const listed = listGallery(deps, 1);
    if (!listed.ok) throw new Error('list failed');
    expect(listed.entries.map((e) => e.id)).toEqual(['forged_b']);
    const row = store.getForged('forged_a');
    expect(row && canPlayForged(row, 1)).toBe(false);
    store.close();
  });
});

describe('the play permission rule', () => {
  it('owners always play their finalized champions; others need shared', () => {
    const { store, deps } = seeded();
    const a = store.getForged('forged_a');
    const draft = store.getForged('forged_draft');
    if (!a || !draft) throw new Error('seed failed');
    expect(canPlayForged(a, 1)).toBe(true);
    expect(canPlayForged(a, 2)).toBe(true);
    expect(canPlayForged(draft, 1)).toBe(false);
    setVisibility(deps, 1, 'forged_a', { shared: false });
    const after = store.getForged('forged_a');
    if (!after) throw new Error('row gone');
    expect(canPlayForged(after, 1)).toBe(true);
    expect(canPlayForged(after, 2)).toBe(false);
    // Unlisting alone never revokes play: unlisted is not private.
    setVisibility(deps, 1, 'forged_a', { shared: true, listed: false });
    const unlisted = store.getForged('forged_a');
    if (!unlisted) throw new Error('row gone');
    expect(canPlayForged(unlisted, 2)).toBe(true);
    store.close();
  });
});

describe('store migration', () => {
  it('adds the gallery columns to a store created before them', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'loc-gallery-'));
    dirs.push(dir);
    const file = path.join(dir, 'forge.sqlite3');
    // The pre-gallery table shape, exactly as phase 3 created it.
    const old = new DatabaseSync(file);
    old.exec(`create table forged_champions (
      id text primary key,
      account_id integer not null,
      def text not null,
      status text not null check (status in ('draft', 'finalized')),
      assets text,
      created_at integer not null,
      updated_at integer not null
    );`);
    old
      .prepare(
        'insert into forged_champions (id, account_id, def, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
      )
      .run('forged_old', 1, JSON.stringify(twin(0, 'forged_old', 'alice')), 'finalized', 1, 1);
    old.close();
    const store = new ForgeStore(file);
    try {
      const row = store.getForged('forged_old');
      expect(row).toMatchObject({ listed: true, shared: true, takenDown: false });
      expect(store.listFinalized().map((r) => r.id)).toEqual(['forged_old']);
    } finally {
      store.close();
    }
  });
});
