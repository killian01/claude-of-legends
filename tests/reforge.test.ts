// Reforge, first slice: a sealed champion's basic-attack reach. The
// policy must stay owner-only and finalized-only, and every change must
// clear the full validation gate (bounds AND power budget), so a
// reforge can never move power past the seal.

import { describe, expect, it } from 'vitest';
import { ForgeStore } from '../server/forge_store';
import { setForgedAttackRange } from '../server/reforge';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { FORGED_TWINS } from './forged_twins';

// Twin 2 is Sylra (ranged, 5.9); twin 0 is Korrath (melee, 1.8).
function twin(i: number, id: string, creator: string): ForgedChampionDef {
  return { ...FORGED_TWINS[i]!, id, creator };
}

function seeded(): ForgeStore {
  const store = new ForgeStore(':memory:');
  store.saveForged({
    id: 'forged_ranged',
    accountId: 1,
    def: twin(2, 'forged_ranged', 'alice'),
    status: 'finalized',
    createdAt: 1,
    updatedAt: 10,
  });
  store.saveForged({
    id: 'forged_melee',
    accountId: 1,
    def: twin(0, 'forged_melee', 'alice'),
    status: 'draft',
    createdAt: 2,
    updatedAt: 20,
  });
  return store;
}

describe('setForgedAttackRange', () => {
  it('turns a sealed ranged champion melee and persists the def', () => {
    const store = seeded();
    const out = setForgedAttackRange({ store, now: () => 99 }, 1, 'forged_ranged', 1.8);
    expect(out).toMatchObject({ ok: true, attackRange: 1.8, melee: true });
    const row = store.getForged('forged_ranged');
    expect(row?.def.base.attackRange).toBe(1.8);
    // The seal survives the reforge; only the one number moved.
    expect(row?.status).toBe('finalized');
    expect(row?.updatedAt).toBe(99);
    store.close();
  });

  it('reports melee false above the combat threshold', () => {
    const store = seeded();
    const out = setForgedAttackRange({ store }, 1, 'forged_ranged', 5.5);
    expect(out).toMatchObject({ ok: true, melee: false });
    store.close();
  });

  it('refuses another account, a draft, and a non-number, storing nothing', () => {
    const store = seeded();
    expect(setForgedAttackRange({ store }, 2, 'forged_ranged', 1.8).ok).toBe(false);
    expect(setForgedAttackRange({ store }, 1, 'forged_melee', 5.5).ok).toBe(false);
    expect(setForgedAttackRange({ store }, 1, 'forged_ranged', '1.8').ok).toBe(false);
    expect(setForgedAttackRange({ store }, 1, 'forged_ranged', Number.NaN).ok).toBe(false);
    expect(store.getForged('forged_ranged')?.def.base.attackRange).toBe(5.9);
    expect(store.getForged('forged_ranged')?.updatedAt).toBe(10);
    store.close();
  });

  it('refuses a reach outside the stat bounds through the full gate', () => {
    const store = seeded();
    const out = setForgedAttackRange({ store }, 1, 'forged_ranged', 9.9);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('attackRange');
    expect(store.getForged('forged_ranged')?.def.base.attackRange).toBe(5.9);
    store.close();
  });
});
