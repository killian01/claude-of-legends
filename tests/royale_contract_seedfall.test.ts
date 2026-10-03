// The Seedfalls before their rules (CONTEXT.md: Seedfall): no Seedfall in
// the observation or on the wire, every cache plain or golden as the layout
// drew it, the tally at zero. Owned by tranche 1's seedfall worktree (T1-A),
// which deletes or rewrites this file as its rules land; no other worktree
// edits it.

import { describe, expect, it } from 'vitest';
import { buildObservation } from '../src/sim/observe';
import { fakeSnap, landed } from './royale_contract_fixture';
import { spot } from './royale_fake';

describe('the Seedfalls, inert', () => {
  it('leaves the Seedfalls out of the observation', () => {
    const { sim, unitIds } = landed();
    const obs = buildObservation(sim, unitIds[0]!)!;
    expect(obs.royale).not.toHaveProperty('seedfalls');
  });

  it('observes no cache kind', () => {
    const { sim, unitIds } = landed();
    const obs = buildObservation(sim, unitIds[0]!)!;
    for (const c of obs.royale!.caches) expect(c).not.toHaveProperty('kind');
  });

  it('sends no Seedfall block', () => {
    const { snap } = fakeSnap();
    expect(snap().royale).not.toHaveProperty('sf');
  });

  it('sends the cache kinds as before', () => {
    const { sim, snap } = fakeSnap();
    sim.addCache(spot(2, 4), true);
    sim.addCache(spot(3, 4));
    expect(snap().royale!.caches!.map((c) => c[4])).toEqual([1, 0]);
  });

  it('keeps every cache plain or golden, as the layout drew it', () => {
    const { sim } = landed();
    const kinds = new Set(sim.royale!.caches.map((c) => c.kind));
    expect([...kinds].sort()).toEqual(['golden', 'plain']);
  });

  it('counts no Seedfall', () => {
    const { tally } = landed().sim.royaleMode!;
    expect(tally.seedfallsLanded).toBe(0);
    expect(tally.seedfallsOpened).toBe(0);
    expect(tally.seedfallsContested).toBe(0);
  });
});
