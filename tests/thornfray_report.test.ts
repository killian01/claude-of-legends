// The headless report of a Thornfray (scripts/thornfray_report.ts over
// scripts/thornfray_measure.ts, ADR 0035, docs/plan-thornfray.md slice 8):
// its command line, the bout it plays being the bout the server plays (the
// same checksum and ranking, the brain's trace changing nothing), a whole
// match of house bots with a stand-in chained through the ledger, the
// prize's length the run asks for reaching the next bout's build, and the
// summary's figures over rows written by hand.

import { describe, expect, it } from 'vitest';
import {
  type BoutRow,
  boutBuildFor,
  bushelSpread,
  formatSummary,
  kindSummary,
  leaderHolds,
  type MatchRow,
  mergeDumps,
  type PlanetRow,
  playBout,
  playThornfray,
  poolOf,
  readArgs,
  standinSummary,
  winnerRepeats,
} from '../scripts/thornfray_measure';
import { royaleFactory } from '../server/royale_build';
import { RoyaleMatch } from '../server/royale_match';
import { dealThornfray, nextBoutBuild } from '../server/thornfray_match';
import { boutKindOf, boutPool } from '../src/sim/content/bouts';
import { LASTWICK } from '../src/sim/content/bouts/lastwick';
import {
  BOUT_BUSHELS,
  BOUT_SEATS,
  BOUTS,
  FINAL_FACTOR,
  PRIZE_LASTS,
} from '../src/sim/content/bouts/match';
import { STARGLEAN } from '../src/sim/content/bouts/starglean';
import { recordBout } from '../src/sim/royale/bouts/ledger';
import { DROP_S } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { loadPlanet } from './royale_planet';

const factory = royaleFactory(loadPlanet);
const seatsIn = (n = BOUT_SEATS) => Array.from({ length: n }, (_, i) => i);

describe('the command line', () => {
  it('defaults to six seeds from 1, the released pool, the shipped prize, one planet match', () => {
    expect(readArgs([])).toEqual({
      seeds: 6,
      from: 1,
      bout: null,
      prize: PRIZE_LASTS,
      standin: false,
      planet: 1,
      dump: '',
      merge: [],
      quiet: false,
    });
  });

  it('reads every option', () => {
    const a = readArgs(
      '--seeds 2 --from 4 --bout starglean --prize all --standin --planet 0 --dump x.json --quiet'.split(
        ' ',
      ),
    );
    expect(a).toMatchObject({
      seeds: 2,
      from: 4,
      bout: 'starglean',
      prize: 'all',
      standin: true,
      planet: 0,
      dump: 'x.json',
      quiet: true,
    });
    expect(readArgs(['--merge', 'a.json,b.json']).merge).toEqual(['a.json', 'b.json']);
  });

  it('refuses a kind nobody registered and a prize length that is not one', () => {
    expect(() => readArgs(['--bout', 'nothing'])).toThrow(/no bout kind/);
    expect(() => readArgs(['--prize', 'forever'])).toThrow(/next or all/);
  });

  it('plays one kind alone, or the released pool', () => {
    expect(poolOf('lastwick')).toEqual([LASTWICK]);
    expect(poolOf(null)).toEqual(boutPool());
  });
});

describe("the next bout's build", () => {
  it('leaves the stand-in seat without a bot and carries the prize as the run asks', () => {
    const m = dealThornfray([], 5, [LASTWICK, STARGLEAN]);
    const kind = m.ledger.draws[0]!.kind;
    recordBout(m.ledger, {
      kind,
      ranking: seatsIn(),
      counts: new Array(BOUT_SEATS).fill(0),
      pendingPrize: [],
      prizeGrafts: [{ seat: 2, graft: 'test_graft' }],
    });
    const next = boutBuildFor(m, { prize: 'next', standin: 0 });
    const server = nextBoutBuild(m, () => null)!;
    expect(next.build.seed).toBe(server.seed);
    expect(next.bout.prize).toBe(0);
    expect(next.bout.grafts.every((g) => g.length === 0)).toBe(true);
    expect(next.seats[0]!.bot).toBeUndefined();
    expect(next.seats[0]!.championId).toBe(server.seats[0]!.championId);
    expect(next.seats.slice(1).every((s) => s.bot !== undefined)).toBe(true);
    const all = boutBuildFor(m, { prize: 'all', standin: null });
    expect(all.bout.grafts[2]).toEqual(['test_graft']);
    expect(all.seats.every((s) => s.bot !== undefined)).toBe(true);
  });
});

describe('the bout the report plays', () => {
  // Each kind's first bout of match seed 3, played by the report and by the
  // server's own match over the same build.
  for (const kind of [LASTWICK, STARGLEAN]) {
    it(`is the bout the server plays in ${kind.id}: the same checksum and ranking`, {
      timeout: 120_000,
    }, () => {
      const report = playBout(dealThornfray([], 3, [kind]), factory, {
        prize: 'next',
        standin: null,
      });
      const build = nextBoutBuild(dealThornfray([], 3, [kind]), () => null)!;
      const match = new RoyaleMatch(7, build.seed, build.kind.base, [], factory, BOUT_SEATS, 1, {
        seats: build.seats,
        bout: build.bout,
      });
      const cap = Math.round((DROP_S + build.kind.playS + 30) / DT);
      while (!match.over && match.sim.tickCount < cap) match.tick();
      expect(match.over).toBe(true);
      expect(report.row.checksum).toBe((match.sim as unknown as Sim).checksum());
      expect(report.row.ranking).toEqual(match.bout!.ranking());
      expect(report.row.endedBy).toBe(kind.base === 'one_life' ? 'rule' : 'clock');
      expect(report.row.decided.fight).toBeGreaterThan(0);
    });
  }
});

describe('a whole match', () => {
  it('chains six bouts of eight seats through the ledger, a stand-in on seat 0', {
    timeout: 300_000,
  }, () => {
    const pool = boutPool();
    const m = playThornfray(1, pool, factory, { prize: 'next', standin: 0 });
    expect(m.bouts).toHaveLength(BOUTS);
    expect(m.bouts.map((b) => b.final)).toEqual([false, false, false, false, false, true]);
    expect(m.prize).toBe('next');
    expect(m.pool).toEqual(pool.map((k) => k.id));
    const paidSum = BOUT_BUSHELS.reduce((a, x) => a + x, 0);
    const totals = new Array<number>(BOUT_SEATS).fill(0);
    m.bouts.forEach((b, i) => {
      const kind = boutKindOf(b.kind)!;
      expect([...b.ranking].sort((x, y) => x - y)).toEqual(seatsIn());
      expect(b.paid.reduce((a, x) => a + x, 0)).toBe(b.final ? paidSum * FINAL_FACTOR : paidSum);
      b.paid.forEach((x, seat) => {
        totals[seat] = totals[seat]! + x;
      });
      expect(b.seats[0]).toBe('standin');
      expect(b.seats.slice(1).every((w) => ['gentle', 'normal', 'strong'].includes(w))).toBe(true);
      expect(b.endedBy).not.toBe('cap');
      if (kind.base === 'respawn') expect(b.endedBy).toBe('clock');
      expect(b.lengthS).toBeLessThanOrEqual(kind.playS + DT);
      expect(b.fightS).toBeLessThanOrEqual(b.nearS);
      expect(b.caches).toHaveLength(BOUT_SEATS);
      // The last bout's winner, a bot, takes a card of its prize in the Lull.
      const before = m.bouts[i - 1]?.ranking[0];
      if (before !== undefined && before !== 0) {
        expect(b.prizeGrafts.some((p) => p.seat === before)).toBe(true);
      }
    });
    expect(m.totals).toEqual(totals);
    expect(m.standings[0]).toBe(m.winner);
    for (let p = 1; p < BOUT_SEATS; p++) {
      expect(m.totals[m.standings[p - 1]!]!).toBeGreaterThanOrEqual(m.totals[m.standings[p]!]!);
    }
    expect(seatsIn()).toContain(m.leaderBeforeFinal);
  });
});

// A bout written by hand: the seats ranked in seat order unless given.
function row(over: Partial<BoutRow> = {}): BoutRow {
  return {
    index: 0,
    kind: 'lastwick',
    region: 'groves',
    final: false,
    lengthS: 60,
    endedBy: 'rule',
    firstFallS: 10,
    ranking: seatsIn(),
    counts: [8, 7, 6, 5, 4, 3, 2, 1],
    paid: [5, 4, 3, 2, 1, 0, 0, 0],
    seats: ['standin', 'strong', 'normal', 'normal', 'normal', 'gentle', 'gentle', 'gentle'],
    takedowns: 7,
    falls: 7,
    duskFalls: 1,
    caches: [0, 1, 1, 1, 1, 0, 0, 0],
    seedfallCaches: new Array(BOUT_SEATS).fill(0),
    nearS: 100,
    fightS: 80,
    decided: { fight: 3, roam: 1 },
    prizeGrafts: [],
    tickMs: 0.1,
    tickMaxMs: 2,
    checksum: 1,
    ...over,
  };
}

function match(over: Partial<MatchRow> = {}): MatchRow {
  return {
    seed: 1,
    prize: 'next',
    pool: ['lastwick', 'starglean'],
    standin: null,
    bouts: [row()],
    totals: [30, 20, 10, 5, 4, 3, 2, 1],
    standings: seatsIn(),
    winner: 0,
    leaderBeforeFinal: 0,
    ...over,
  };
}

const ranked = (first: number): number[] => [first, ...seatsIn().filter((s) => s !== first)];

describe("the summary's figures", () => {
  it('count how often the leader before the Final holds', () => {
    const ms = [match(), match({ leaderBeforeFinal: 3 }), match({ leaderBeforeFinal: -1 })];
    expect(leaderHolds(ms)).toEqual({ held: 1, of: 2 });
  });

  it("count a bout's winner winning the next, by the prize's length", () => {
    const next = match({
      bouts: [
        row({ ranking: ranked(2) }),
        row({ ranking: ranked(2) }),
        row({ ranking: ranked(5) }),
      ],
    });
    const all = match({
      prize: 'all',
      bouts: [row({ ranking: ranked(4) }), row({ ranking: ranked(1) })],
    });
    expect(winnerRepeats([next, all])).toEqual([
      // 2 wins again (place 1), then comes fourth behind 5, 0 and 1.
      { prize: 'next', pairs: 2, repeats: 1, nextPlace: 2.5 },
      // 4 is fifth behind 1, 0, 2 and 3.
      { prize: 'all', pairs: 1, repeats: 0, nextPlace: 5 },
    ]);
  });

  it('spread the bushels by final place, with the winner margin', () => {
    const a = match({ totals: [30, 20, 10, 5, 4, 3, 2, 1] });
    const b = match({ totals: [1, 2, 3, 4, 5, 6, 7, 40], standings: [7, 6, 5, 4, 3, 2, 1, 0] });
    const s = bushelSpread([a, b]);
    expect(s.byPlace).toEqual([35, 13.5, 8, 5, 4, 3, 2, 1]);
    expect(s.margin).toBe((10 + 33) / 2);
  });

  it("sum a kind's bouts: lengths, endings, places by seat, caches by region, fighting", () => {
    const ms = [
      match({
        bouts: [
          row({ lengthS: 50, region: 'groves' }),
          row({ lengthS: 70, region: 'ruins', ranking: ranked(5), firstFallS: 20 }),
          row({ kind: 'starglean', endedBy: 'clock', lengthS: 105 }),
        ],
      }),
    ];
    const k = kindSummary(ms, 'lastwick')!;
    expect(k.bouts).toBe(2);
    expect(k.lengths).toEqual({ min: 50, median: 50, max: 70 });
    expect(k.endedBy).toEqual({ rule: 2, clock: 0, cap: 0 });
    expect(k.firstFall).toBe(10);
    expect(k.places.standin).toEqual({ place: 1.5, wins: 1, seats: 2 });
    expect(k.places.gentle!.wins).toBe(1);
    expect(k.places.strong).toEqual({ place: 2.5, wins: 0, seats: 2 });
    expect(k.cachesByRegion).toEqual({
      groves: { caches: 0.5, bouts: 1 },
      ruins: { caches: 0.5, bouts: 1 },
    });
    expect(k.nearS).toBe(200);
    expect(k.fightS).toBe(160);
    expect(k.decided).toEqual({ fight: 6, roam: 2 });
    expect(kindSummary(ms, 'starglean')!.endedBy.clock).toBe(1);
    expect(kindSummary(ms, 'nothing')).toBeNull();
  });

  it("keep the stand-in's bushels and places", () => {
    const ms = [
      match({ standin: 0, totals: [9, 20, 10, 5, 4, 3, 2, 1] }),
      match({ standin: 0, bouts: [row({ ranking: ranked(3) })] }),
      match(),
    ];
    expect(standinSummary(ms)).toEqual({ bushels: [9, 30], places: { lastwick: [1, 2] } });
  });

  it('print every figure, the planet beside each kind, dumps merged', () => {
    const planet: PlanetRow[] = [
      { variant: 'one_life', seed: 1, lengthS: 400, nearS: 100, fightS: 50, tickMs: 1 },
    ];
    const dump = mergeDumps([
      { matches: [match({ standin: 0 })], planet },
      {
        matches: [match({ prize: 'all', bouts: [row(), row({ ranking: ranked(0) })] })],
        planet: [],
      },
    ]);
    expect(dump.matches).toHaveLength(2);
    const text = formatSummary(dump);
    expect(text).toContain('summary: 2 matches, 3 bouts');
    expect(text).toContain('ended by its rule 3, its clock 0');
    expect(text).toContain('the planet in One life: 50.0% over 1 match');
    expect(text).toContain("prize all: a bout's winner wins the next 1 of 1");
    expect(text).toContain('the leader before the Final wins: 2 of 2');
    expect(text).toContain('the stand-in: bushels 30');
  });
});
