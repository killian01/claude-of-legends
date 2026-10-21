// The battle royale's golden checksums: three whole matches of house bots
// on the real Wanderseed, each built the way the server builds a match
// nobody has joined (server/royale_match.ts RoyaleMatch over
// server/royale_seats.ts royaleSeats and server/royale_build.ts
// royaleFactory, so through buildRoyaleSim in src/net/replay.ts), their
// sim.checksum() sixty seconds after the landing and at the match's end
// pinned as constants. Seed 7 in Respawn and in One life, Solo, fifty seats
// each; seed 5 in Trios, One life, the forty-eight seats of sixteen crews
// (crewSeats(3)). Captured on c456598, under ROYALE_RULES_VERSION 13, before
// Thornfray's bout seams (ADR 0035, docs/plan-thornfray.md) moved anything;
// Respawn's and Trios' captured again under 14, a cache's opener holding its
// idle fire.
//
// A red run means a seam moved the battle royale: a changed order of random
// draws in the Dusk, the Seedfalls, the caches, the Grafts, the drop or the
// Sim's constructor changes every fifty seat match without a word. Either
// the change is wrong, and the battle royale must play as before, or the
// change to the battle royale is meant: then ROYALE_RULES_VERSION moves with
// its changelog line in src/sim/royale/types.ts (kept replays are refused,
// not replayed wrong) and the constants below are captured again from this
// test's failure. Never capture them again without that version moving.

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import { RoyaleMatch } from '../server/royale_match';
import { crewSeats } from '../src/sim/royale/crews';
import { DROP_S, PLAY_S, type RoyaleCrew, type RoyaleVariant } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { loadPlanet } from './royale_planet';

interface Golden {
  // sim.checksum() sixty seconds after the tick every seat landed.
  landed60: number;
  // sim.checksum() on the tick the match was over (it mixes the tick, so
  // the match's length is in it).
  end: number;
}

const GOLDEN = {
  respawnSolo7: { landed60: 4222425139, end: 3067917388 },
  oneLifeSolo7: { landed60: 2246274888, end: 3754226507 },
  oneLifeTrios5: { landed60: 3103804265, end: 1263686581 },
} satisfies Record<string, Golden>;

const AFTER_LANDING_TICKS = Math.round(60 / DT);
// One life ends with the last standing, a little past the last light at
// worst; a match still running past this is red on its own.
const CAP_TICKS = Math.round((DROP_S + PLAY_S + 120) / DT);

function play(seed: number, variant: RoyaleVariant, crew: RoyaleCrew): Golden {
  // No person: every seat is a house bot, dealt as the server deals them.
  const match = new RoyaleMatch(1, seed, variant, [], royaleFactory(loadPlanet), undefined, crew);
  const sim = match.sim as unknown as Sim;
  const seats = [...sim.units.values()].filter((u) => u.kind === 'champion');
  expect(seats).toHaveLength(crewSeats(crew));
  let landedAt: number | null = null;
  let landed60: number | null = null;
  while (match.sim.royale.stage !== 'over' && sim.tickCount < CAP_TICKS) {
    match.tick();
    if (landedAt === null && match.sim.royale.stage !== 'drop') landedAt = sim.tickCount;
    if (landedAt !== null && sim.tickCount === landedAt + AFTER_LANDING_TICKS) {
      landed60 = sim.checksum();
    }
  }
  expect(match.sim.royale.stage).toBe('over');
  expect(landed60).not.toBeNull();
  return { landed60: landed60!, end: sim.checksum() };
}

describe('the battle royale golden checksums', () => {
  it('plays seed 7 in Respawn, Solo, as captured', { timeout: 300_000 }, () => {
    expect(play(7, 'respawn', 1)).toEqual(GOLDEN.respawnSolo7);
  });

  it('plays seed 7 in One life, Solo, as captured', { timeout: 300_000 }, () => {
    expect(play(7, 'one_life', 1)).toEqual(GOLDEN.oneLifeSolo7);
  });

  it('plays seed 5 in Trios, One life, as captured', { timeout: 300_000 }, () => {
    expect(play(5, 'one_life', 3)).toEqual(GOLDEN.oneLifeTrios5);
  });
});
