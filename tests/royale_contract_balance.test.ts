// The planet's balance before its table (src/sim/content/royale_tuning.ts):
// no champion's damage scaled, on the planet or in the 5v5. Owned by
// tranche 1's planet-balance worktree (T1-B), which deletes or rewrites
// this file as its tuning lands; no other worktree edits it.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { landed } from './royale_contract_fixture';

describe('the planet balance, inert', () => {
  it('scales no damage on the planet', () => {
    const { sim } = landed();
    for (const u of sim.units.values()) expect(u.dmgScale).toBe(1);
  });

  it('scales no damage in the 5v5', () => {
    const fivevfive = new Sim(4);
    fivevfive.addChampion(0, undefined, 'dain');
    for (const u of fivevfive.units.values()) expect(u.dmgScale).toBe(1);
  });
});
