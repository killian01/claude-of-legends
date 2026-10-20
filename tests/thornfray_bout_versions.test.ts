// Each bout kind's end, pinned (ADR 0035, Versions; docs/plan-thornfray.md):
// a kind's record carries its own `version`, its data's fingerprint
// (content/bouts/index.ts boutFingerprint) and BOUT_ENGINE_VERSION, and a
// bout replay is refused when any of the three differs. The fingerprint
// moves by itself with the kind's data; the code it cannot see (a kind's
// scorer and goals, the seams, the ledger, the shared scorers, the bots'
// brain) is held here, for every kind in the registry, by two bouts of
// match seed 1 on the real Wanderseed through buildBoutSim, each pinned at
// its end (its checksum, length, counts, ranking, the bushels it paid, the
// cards the prize's seat was offered, the prizes it left open and the
// Grafts picked from one): the first bout, on
// eight house bots, and the Final, its prize offered fresh to seat 0 and
// carried unpicked to seat 3, a seat no order is given on, so the rising
// arc's last step, the prize's draw, its offer again and the Final's double
// are held too. The engine's shared data (content/bouts/match.ts: the
// rising arc of every bout, the bushels, the prize) is pinned beside them,
// for the bouts between the first and the Final.
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
import {
  ARC_LEVELS,
  ARC_PIECES,
  BOUT_BUSHELS,
  BOUT_ENGINE_VERSION,
  BOUT_SEATS,
  BOUTS,
  FINAL_FACTOR,
  PRIZE_GRADE,
  PRIZE_LASTS,
} from '../src/sim/content/bouts/match';
import type { BoutKind } from '../src/sim/content/bouts/types';
import { boutResult } from '../src/sim/royale/bouts/end';
import { boutSeed, bushelsFor, isFinal, type PendingPrize } from '../src/sim/royale/bouts/ledger';
import type { RegionId } from '../src/sim/royale/layout';
import { boutPicks, buildBout, playOut } from './thornfray_fixture';

interface Pinned {
  kind: string;
  // The kind's version and the engine's the numbers were captured under.
  version: number;
  engine: number;
  // The bout's index in the match (0 the first, BOUTS - 1 the Final) and
  // its Thornyard.
  index: number;
  region: RegionId;
  // sim.checksum() and sim.tickCount on the tick the bout was over.
  checksum: number;
  ticks: number;
  // The bout's counts by seat, its ranking (seats, best first) and the
  // bushels its places paid, by seat.
  counts: number[];
  ranking: number[];
  paid: number[];
  // The cards offered fresh to the prize's seat on the Lull's first tick
  // (none in the first bout), the prizes still open at its end, and the
  // Grafts picked from one.
  offered: string[];
  pendingPrize: PendingPrize[];
  prizeGrafts: { seat: number; graft: string }[];
}

const PINNED: readonly Pinned[] = [
  {
    kind: 'lastwick',
    version: 1,
    engine: 1,
    index: 0,
    region: 'groves',
    checksum: 1179292751,
    ticks: 1202,
    counts: [2, 8, 1, 5, 6, 3, 0, 4],
    ranking: [1, 4, 3, 7, 5, 0, 2, 6],
    paid: [0, 5, 0, 3, 4, 1, 0, 2],
    offered: [],
    pendingPrize: [],
    prizeGrafts: [],
  },
  {
    kind: 'lastwick',
    version: 1,
    engine: 1,
    index: BOUTS - 1,
    region: 'open',
    checksum: 144600142,
    ticks: 1139,
    counts: [5, 0, 3, 6, 1, 2, 8, 4],
    ranking: [6, 3, 0, 7, 2, 5, 4, 1],
    paid: [6, 0, 2, 8, 0, 0, 10, 4],
    offered: ['bloodsap', 'last_rush', 'stoneblood'],
    pendingPrize: [{ seat: 3, cards: ['stoneblood', 'last_rush', 'thornhide'] }],
    prizeGrafts: [{ seat: 0, graft: 'bloodsap' }],
  },
  {
    kind: 'starglean',
    version: 1,
    engine: 1,
    index: 0,
    region: 'ruins',
    checksum: 130349183,
    ticks: 2301,
    counts: [6, 2, 4, 0, 8, 11, 6, 8],
    ranking: [5, 4, 7, 0, 6, 2, 1, 3],
    paid: [2, 0, 0, 0, 4, 5, 1, 3],
    offered: [],
    pendingPrize: [],
    prizeGrafts: [],
  },
  {
    kind: 'starglean',
    version: 1,
    engine: 1,
    index: BOUTS - 1,
    region: 'cliffs',
    checksum: 2208100625,
    ticks: 2301,
    counts: [10, 8, 8, 0, 4, 1, 4, 2],
    ranking: [0, 1, 2, 6, 4, 7, 5, 3],
    paid: [10, 8, 6, 0, 2, 0, 4, 0],
    offered: ['bloodsap', 'last_rush', 'stoneblood'],
    pendingPrize: [{ seat: 3, cards: ['stoneblood', 'last_rush', 'thornhide'] }],
    prizeGrafts: [{ seat: 0, graft: 'bloodsap' }],
  },
];

// The engine's shared data, as captured under BOUT_ENGINE_VERSION.
const ENGINE_DATA = {
  engine: 1,
  seats: 8,
  bouts: 6,
  bushels: [5, 4, 3, 2, 1, 0, 0, 0],
  finalFactor: 2,
  arcLevels: [6, 7, 8, 9, 10, 11],
  arcPieces: [2, 4, 6, 8, 10, 12],
  prizeGrade: 'bough',
  prizeLasts: 'next',
};

const MATCH_SEED = 1;
// The Final's prize carried unpicked from the bout before, to seat 3.
const CARRIED: PendingPrize = { seat: 3, cards: ['stoneblood', 'last_rush', 'thornhide'] };

function play(kind: BoutKind, index: number, region: RegionId) {
  const final = isFinal(index);
  // In the Final seat 3 is a seat no order is given on: its carried prize
  // stays open to the end.
  const picks = boutPicks(MATCH_SEED);
  if (final) {
    const { bot: _bot, ...person } = picks[CARRIED.seat]!;
    picks[CARRIED.seat] = person;
  }
  const { sim, unitIds } = buildBout({
    kind,
    matchSeed: MATCH_SEED,
    seed: boutSeed(MATCH_SEED, index),
    index,
    region,
    picks,
    ...(final ? { prize: 0, pendingPrize: [CARRIED] } : {}),
  });
  sim.tick();
  const prize = sim.royale!.offers.get(unitIds[0]!)?.find((o) => o.prize);
  const offered = prize ? [...prize.cards] : [];
  playOut(sim);
  expect(sim.royale!.stage).toBe('over');
  const r = boutResult(sim.royaleMode!, sim);
  const paid = new Array<number>(BOUT_SEATS).fill(0);
  r.ranking.forEach((seat, i) => {
    paid[seat] = bushelsFor(i + 1, final);
  });
  return {
    checksum: sim.checksum(),
    ticks: sim.tickCount,
    counts: r.counts,
    ranking: r.ranking,
    paid,
    offered,
    pendingPrize: r.pendingPrize,
    prizeGrafts: r.prizeGrafts,
  };
}

describe('the pinned bouts', () => {
  it('pins the first bout and the Final of every kind in the registry', () => {
    for (const kind of BOUT_KINDS) {
      const indices = PINNED.filter((p) => p.kind === kind.id).map((p) => p.index);
      expect(indices.sort((a, b) => a - b)).toEqual([0, BOUTS - 1]);
    }
    expect(new Set(PINNED.map((p) => p.kind)).size).toBe(BOUT_KINDS.length);
  });

  it("pins the engine's shared data under its version", () => {
    expect({
      engine: BOUT_ENGINE_VERSION,
      seats: BOUT_SEATS,
      bouts: BOUTS,
      bushels: BOUT_BUSHELS,
      finalFactor: FINAL_FACTOR,
      arcLevels: ARC_LEVELS,
      arcPieces: ARC_PIECES,
      prizeGrade: PRIZE_GRADE,
      prizeLasts: PRIZE_LASTS,
    }).toEqual(ENGINE_DATA);
  });

  for (const pinned of PINNED) {
    const kind = BOUT_KINDS.find((k) => k.id === pinned.kind);
    const which = pinned.index === 0 ? 'its first bout' : `bout ${pinned.index}`;
    it(`plays ${pinned.kind}, ${which}, on match seed 1 as captured`, () => {
      if (!kind) throw new Error(`no bout kind ${pinned.kind}`);
      expect({ version: kind.version, engine: BOUT_ENGINE_VERSION }).toEqual({
        version: pinned.version,
        engine: pinned.engine,
      });
      const { kind: _k, version: _v, engine: _e, index, region, ...want } = pinned;
      expect(play(kind, index, region)).toEqual(want);
    });
  }
});
