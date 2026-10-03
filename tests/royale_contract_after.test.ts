// After the fall before its rules: no watched champion on the wire, and a
// watch command replayed as nothing. Owned by tranche 3's after-the-fall
// worktree (T3-A), which deletes or rewrites this file as its rules land;
// no other worktree edits it.

import { describe, expect, it } from 'vitest';
import { applySimCommand } from '../src/net/replay';
import { fakeSnap, fingerprint, landed } from './royale_contract_fixture';

describe('after the fall, inert', () => {
  it('sends no wa block', () => {
    expect(fakeSnap().snap().royale).not.toHaveProperty('wa');
  });

  it('replays a watch command as nothing', () => {
    const { sim, unitIds } = landed();
    const before = fingerprint(sim);
    applySimCommand(sim, 0, unitIds[0]!, { t: 'watch', next: true });
    expect(fingerprint(sim)).toEqual(before);
    expect(sim.policies.size).toBe(0);
  });
});
