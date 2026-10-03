// The Risings and the hunted before their rules (CONTEXT.md: Rising,
// Lodestar, Ablaze): no Rising and no mark in the observation, no rank on
// the wire. Owned by tranche 2's risings-and-the-hunted worktree (T2-A),
// which deletes or rewrites this file as its rules land; no other worktree
// edits it.

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../src/sim/observe';
import { fakeSnap, landed } from './royale_contract_fixture';

describe('the Risings and the marks, inert', () => {
  for (const key of ['risings', 'marks']) {
    it(`leaves ${key} out of the observation`, () => {
      const { sim, unitIds } = landed();
      expect(buildObservation(sim, unitIds[0]!)!.royale).not.toHaveProperty(key);
    });
  }

  for (const key of ['ri', 'mk', 'rk', 'gap']) {
    it(`sends no ${key} block`, () => {
      expect(fakeSnap().snap().royale).not.toHaveProperty(key);
    });
  }
});
