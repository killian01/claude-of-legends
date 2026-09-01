// The explicit seal (playtest: animating used to seal as a side effect,
// and a creator found their champion locked without ever choosing it;
// a lock must be its own click). Sealing marks the champion finalized:
// the kit, the art and the model lock, the gallery and the queues take
// it. Unsealing is the same door in reverse: the champion returns to a
// draft, editable again, and simply leaves the gallery until resealed.
// Both are owner-only and free; sealing demands what the old implicit
// seal guaranteed: a fully valid def, a built model, baked animations.

import { validateForged } from '../src/sim/forge/validate';
import type { ForgeOutcome } from './forge';
import type { ForgeStore } from './forge_store';

export interface SealDeps {
  store: ForgeStore;
  now?: () => number;
}

export function sealChampion(deps: SealDeps, accountId: number, id: string): ForgeOutcome {
  const row = deps.store.getForged(id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (row.status === 'finalized') {
    return { ok: false, error: 'already sealed' };
  }
  const v = validateForged(row.def);
  if (!v.ok) {
    return {
      ok: false,
      error: `sealing needs a fully valid champion: ${v.errors.slice(0, 3).join('; ')}`,
    };
  }
  const assets = (deps.store.forgedAssets(id) as { model?: unknown; clips?: unknown } | null) ?? {};
  if (typeof assets.model !== 'string') {
    return { ok: false, error: 'build the 3D model first: a sealed champion plays as its model' };
  }
  if (typeof assets.clips !== 'object' || assets.clips === null) {
    return { ok: false, error: 'animate the champion first: a sealed champion moves' };
  }
  deps.store.setForgedStatus(id, 'finalized', (deps.now ?? Date.now)());
  return { ok: true };
}

export function unsealChampion(deps: SealDeps, accountId: number, id: string): ForgeOutcome {
  const row = deps.store.getForged(id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (row.status !== 'finalized') {
    return { ok: false, error: 'not sealed' };
  }
  deps.store.setForgedStatus(id, 'draft', (deps.now ?? Date.now)());
  return { ok: true };
}
