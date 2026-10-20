// Each bout kind's end, pinned (ADR 0035, Versions; docs/plan-thornfray.md):
// a kind's record carries its own `version`, its data's fingerprint
// (content/bouts/index.ts boutFingerprint) and BOUT_ENGINE_VERSION, and a
// bout replay is refused when any of the three differs. The fingerprint
// moves by itself with the kind's data; the code it cannot see (a kind's
// scorer and goals, the seams, the ledger, the shared scorers, the bots'
// brain) is held here: the first bout of match seed 1, eight house bots on
// the real Wanderseed through buildBoutSim, its end checksum, its length,
// its counts and its ranking pinned for every kind in the registry.
//
// A red run means a kind's bout no longer plays the bout it recorded, and
// kept bout replays would play another one. Either the change is wrong, or
// it is meant: then the right version moves first (the kind's `version`
// for its own modules, BOUT_ENGINE_VERSION in content/bouts/match.ts for
// the engine's, ROYALE_RULES_VERSION for the planet's rules, the content
// fingerprint by itself for a champion, an item or a bot), the entry's
// `version` and `engine` with it, and the numbers are captured again from
// this test's failure. A kind still unreleased (released: false) has no
// kept replay, so its numbers are captured again with no version moving.

import { describe, expect, it } from 'vitest';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { BOUT_ENGINE_VERSION } from '../src/sim/content/bouts/match';
import type { BoutKind } from '../src/sim/content/bouts/types';
import { boutResult } from '../src/sim/royale/bouts/end';
import { boutSeed } from '../src/sim/royale/bouts/ledger';
import type { RegionId } from '../src/sim/royale/layout';
import { buildBout, playOut } from './thornfray_fixture';

interface Pinned {
  kind: string;
  // The kind's version and the engine's the numbers were captured under.
  version: number;
  engine: number;
  // The bout's Thornyard.
  region: RegionId;
  // sim.checksum() and sim.tickCount on the tick the bout was over.
  checksum: number;
  ticks: number;
  // The bout's counts by seat, and its ranking (seats, best first).
  counts: number[];
  ranking: number[];
}

const PINNED: readonly Pinned[] = [
  {
    kind: 'lastwick',
    version: 1,
    engine: 1,
    region: 'groves',
    checksum: 1179292751,
    ticks: 1202,
    counts: [2, 8, 1, 5, 6, 3, 0, 4],
    ranking: [1, 4, 3, 7, 5, 0, 2, 6],
  },
  {
    kind: 'starglean',
    version: 1,
    engine: 1,
    region: 'ruins',
    checksum: 130349183,
    ticks: 2301,
    counts: [6, 2, 4, 0, 8, 11, 6, 8],
    ranking: [5, 4, 7, 0, 6, 2, 1, 3],
  },
];

const pinnedOf = (id: string) => PINNED.find((p) => p.kind === id);

const MATCH_SEED = 1;

function play(kind: BoutKind, region: RegionId) {
  const { sim } = buildBout({
    kind,
    matchSeed: MATCH_SEED,
    seed: boutSeed(MATCH_SEED, 0),
    index: 0,
    region,
  });
  playOut(sim);
  expect(sim.royale!.stage).toBe('over');
  const r = boutResult(sim.royaleMode!, sim);
  return { checksum: sim.checksum(), ticks: sim.tickCount, counts: r.counts, ranking: r.ranking };
}

describe('the pinned bouts', () => {
  it('pins every kind in the registry', () => {
    expect(BOUT_KINDS.map((k) => k.id).filter((id) => !pinnedOf(id))).toEqual([]);
    expect(new Set(PINNED.map((p) => p.kind)).size).toBe(PINNED.length);
  });

  for (const kind of BOUT_KINDS) {
    it(`plays ${kind.id} on match seed 1 as captured`, () => {
      const pinned = pinnedOf(kind.id);
      if (!pinned) throw new Error(`no pinned bout for ${kind.id}`);
      expect({ version: kind.version, engine: BOUT_ENGINE_VERSION }).toEqual({
        version: pinned.version,
        engine: pinned.engine,
      });
      const { kind: _k, version: _v, engine: _e, region, ...want } = pinned;
      expect(play(kind, region)).toEqual(want);
    });
  }
});
