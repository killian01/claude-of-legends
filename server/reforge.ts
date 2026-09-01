// Reforge, first slice (the seal's own message promises it "comes
// later"): a sealed champion's basic-attack reach may still move. Melee
// versus ranged is decided by attackRange against the combat threshold,
// and it is the kit feel a creator only discovers in a real match
// (playtest: a melee champion shipped throwing bolts because the editor
// default is ranged). One parameter, owner-only, full revalidation: the
// patched def must clear the same gate a build does (bounds AND the
// power budget), so a reforge can never move power past the seal.
// Drafts stay out: a draft's whole def saves freely through the draft
// route. Policy lives here; server/forge_store.ts only stores.

import { RANGED_THRESHOLD } from '../src/sim/combat/auto_attack';
import { validateForged } from '../src/sim/forge/validate';
import type { ForgeOutcome } from './forge';
import type { ForgeStore } from './forge_store';

export interface ReforgeDeps {
  store: ForgeStore;
  now?: () => number;
}

export function setForgedAttackRange(
  deps: ReforgeDeps,
  accountId: number,
  id: string,
  raw: unknown,
): ForgeOutcome<{ attackRange: number; melee: boolean }> {
  const row = deps.store.getForged(id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (row.status !== 'finalized') {
    return { ok: false, error: 'a draft edits freely: save it from the editor instead' };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ok: false, error: 'malformed reach' };
  }
  const def = structuredClone(row.def);
  def.base.attackRange = raw;
  const v = validateForged(def);
  if (!v.ok) {
    return { ok: false, error: `reforge rejected: ${v.errors.slice(0, 3).join('; ')}` };
  }
  deps.store.saveForged({ ...row, def, updatedAt: (deps.now ?? Date.now)() });
  return { ok: true, attackRange: raw, melee: raw <= RANGED_THRESHOLD };
}
