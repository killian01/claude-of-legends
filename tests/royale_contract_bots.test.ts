// The bots' intent before its rules: no dead seat decides, and a newcomer
// is dealt the same escorts as anyone. Owned by tranche 1's
// bots-with-intent worktree (T1-C), which deletes or rewrites this file as
// its rules land; no other worktree edits it.

import { describe, expect, it } from 'vitest';
import { buildRoyaleSim, loadRoyaleReplay, REPLAY_VERSION } from '../src/net/replay';
import { ROYALE_RULES_VERSION } from '../src/sim/royale/types';
import { landed, picks } from './royale_contract_fixture';
import { loadPlanet } from './royale_planet';

describe('the bots with intent, inert', () => {
  it('lets no dead seat decide', () => {
    const { sim, unitIds } = landed('one_life');
    expect(sim.royaleMode!.wantsDeadDecision(unitIds[1]!)).toBe(false);
  });

  it('plays a match with newcomers as the same match without', () => {
    const record = {
      version: REPLAY_VERSION,
      seed: 4,
      picks: picks(4),
      royale: { variant: 'one_life' as const, rules: ROYALE_RULES_VERSION, newcomers: [0, 2] },
    };
    const { sim: royale } = loadRoyaleReplay(loadPlanet(), record)!;
    const { sim: plain } = buildRoyaleSim(loadPlanet(), 4, picks(4), 'one_life');
    for (let i = 0; i < 400; i++) {
      royale.tick();
      plain.tick();
    }
    expect(royale.checksum()).toBe(plain.checksum());
  });
});
