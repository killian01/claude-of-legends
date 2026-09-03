// The Forge's server side on the account model (ADR 0006 accounts, ADR
// 0011 store): draft CRUD gated on shape and ownership, the creator
// signature stamped server-side, the weekly creation grant on the ledger.

import { describe, expect, it } from 'vitest';
import {
  deleteDraft,
  type ForgeDeps,
  listDrafts,
  refreshWeeklyGrant,
  saveDraft,
} from '../server/forge';
import { ForgeStore } from '../server/forge_store';
import { CHAMPIONS } from '../src/sim/content/champions';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { forgedTwin } from './forged_twins';

function draft(id = 'forged_test_draft'): ForgedChampionDef {
  return { ...forgedTwin(CHAMPIONS.sylra!), id };
}

function rig(): ForgeDeps & { store: ForgeStore } {
  return { store: new ForgeStore(':memory:'), creationsGrant: 3, now: () => 1_000_000 };
}

describe('forge drafts', () => {
  it('saves, lists, updates, and deletes on the owning account', () => {
    const deps = rig();
    expect(saveDraft(deps, 1, 'bob', draft())).toEqual({ ok: true });
    const listed = listDrafts(deps, 1);
    expect(listed.ok && listed.drafts.map((d) => d.id)).toEqual(['forged_test_draft']);
    // Listing surfaces the ledger too, granted on first contact.
    expect(listed.ok && listed.credits).toBe(3);

    const renamed = { ...draft(), name: 'Bramble Twin' };
    expect(saveDraft(deps, 1, 'bob', renamed)).toEqual({ ok: true });
    const after = listDrafts(deps, 1);
    expect(after.ok && after.drafts[0]?.def.name).toBe('Bramble Twin');
    expect(after.ok && after.drafts).toHaveLength(1);

    expect(deleteDraft(deps, 1, 'forged_test_draft')).toEqual({ ok: true });
    const empty = listDrafts(deps, 1);
    expect(empty.ok && empty.drafts).toHaveLength(0);
    deps.store.close();
  });

  it('stores an over-budget draft but never a misshapen one', () => {
    const deps = rig();
    // Over budget: everything maxed. Still a storable draft.
    const greedy = draft('forged_greedy');
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
    expect(saveDraft(deps, 1, 'bob', greedy)).toEqual({ ok: true });
    // Out of bounds: refused outright, the engine must never walk it.
    const broken = draft('forged_broken');
    broken.base = { ...broken.base, hp: 99999 };
    expect(saveDraft(deps, 1, 'bob', broken)).toMatchObject({
      ok: false,
      error: expect.stringContaining('base.hp'),
    });
    deps.store.close();
  });

  it('enforces ownership and seals finalized champions', () => {
    const deps = rig();
    expect(saveDraft(deps, 1, 'bob', draft())).toEqual({ ok: true });
    expect(saveDraft(deps, 2, 'ana', draft())).toMatchObject({
      ok: false,
      error: expect.stringContaining('another creator'),
    });
    expect(deleteDraft(deps, 2, 'forged_test_draft')).toMatchObject({ ok: false });

    // Finalized (by the pipeline): sealed against edit and delete.
    deps.store.setForgedFinalized('forged_test_draft', { model: 'x' }, 2);
    expect(saveDraft(deps, 1, 'bob', draft())).toMatchObject({
      ok: false,
      error: expect.stringContaining('sealed'),
    });
    expect(deleteDraft(deps, 1, 'forged_test_draft')).toMatchObject({ ok: false });
    deps.store.close();
  });

  it('grants the weekly allocation once per rolling week, rolling over', () => {
    const store = new ForgeStore(':memory:');
    let clock = 0;
    const deps: ForgeDeps = { store, creationsGrant: 3, now: () => clock };
    refreshWeeklyGrant(deps, 7);
    expect(store.creditBalance(7)).toBe(3);
    // Six days on: nothing new, however often the account surfaces.
    clock = 6 * 24 * 60 * 60 * 1000;
    refreshWeeklyGrant(deps, 7);
    refreshWeeklyGrant(deps, 7);
    expect(store.creditBalance(7)).toBe(3);
    // Day eight: the week rolled, one grant, and only one.
    clock = 8 * 24 * 60 * 60 * 1000;
    listDrafts(deps, 7);
    listDrafts(deps, 7);
    expect(store.creditBalance(7)).toBe(6);
    store.close();
  });
});
