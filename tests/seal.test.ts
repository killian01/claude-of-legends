// The explicit seal: never a side effect of animating, owner-only, and
// it demands what the old implicit seal guaranteed (a fully valid def,
// a built model, baked animations). Unsealing is the same door in
// reverse: back to a draft, editable again.

import { describe, expect, it } from 'vitest';
import { ForgeStore } from '../server/forge_store';
import { sealChampion, unsealChampion } from '../server/seal';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { FORGED_TWINS } from './forged_twins';

function twin(i: number, id: string): ForgedChampionDef {
  return { ...FORGED_TWINS[i]!, id, creator: 'alice' };
}

function seeded(): ForgeStore {
  const store = new ForgeStore(':memory:');
  store.saveForged({
    id: 'forged_s',
    accountId: 1,
    def: twin(0, 'forged_s'),
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
  });
  return store;
}

function bake(store: ForgeStore): void {
  store.updateForgedAssets(
    'forged_s',
    { model: 'forged/forged_s/model.glb', clips: { idle: 'preset:biped:idle' } },
    5,
  );
}

describe('sealChampion and unsealChampion', () => {
  it('seals a valid, built, animated draft and unseals it back', () => {
    const store = seeded();
    bake(store);
    expect(sealChampion({ store, now: () => 50 }, 1, 'forged_s')).toEqual({ ok: true });
    expect(store.getForged('forged_s')?.status).toBe('finalized');
    expect(store.getForged('forged_s')?.updatedAt).toBe(50);
    // Already sealed: said plainly, not re-run.
    expect(sealChampion({ store }, 1, 'forged_s')).toMatchObject({
      ok: false,
      error: expect.stringContaining('already'),
    });
    expect(unsealChampion({ store, now: () => 60 }, 1, 'forged_s')).toEqual({ ok: true });
    expect(store.getForged('forged_s')?.status).toBe('draft');
    // The assets survive the unseal: model and clips stay baked.
    expect((store.forgedAssets('forged_s') as { model: string }).model).toBe(
      'forged/forged_s/model.glb',
    );
    store.close();
  });

  it('refuses to seal without a model or without baked animations', () => {
    const store = seeded();
    expect(sealChampion({ store }, 1, 'forged_s')).toMatchObject({
      ok: false,
      error: expect.stringContaining('model'),
    });
    store.updateForgedAssets('forged_s', { model: 'forged/forged_s/model.glb' }, 5);
    expect(sealChampion({ store }, 1, 'forged_s')).toMatchObject({
      ok: false,
      error: expect.stringContaining('animate'),
    });
    store.close();
  });

  it('refuses an invalid def: the seal is the validity gate', () => {
    const store = seeded();
    bake(store);
    const row = store.getForged('forged_s');
    if (!row) throw new Error('seed missing');
    const broken = structuredClone(row.def);
    broken.base.hp = 99999;
    store.saveForged({ ...row, def: broken });
    expect(sealChampion({ store }, 1, 'forged_s')).toMatchObject({
      ok: false,
      error: expect.stringContaining('valid'),
    });
    store.close();
  });

  it('is owner-only both ways, and unseal needs a seal to undo', () => {
    const store = seeded();
    bake(store);
    expect(sealChampion({ store }, 2, 'forged_s').ok).toBe(false);
    expect(unsealChampion({ store }, 1, 'forged_s')).toMatchObject({
      ok: false,
      error: expect.stringContaining('not sealed'),
    });
    expect(sealChampion({ store }, 1, 'forged_s').ok).toBe(true);
    expect(unsealChampion({ store }, 2, 'forged_s').ok).toBe(false);
    store.close();
  });
});
