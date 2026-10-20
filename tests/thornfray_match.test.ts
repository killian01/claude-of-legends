// A Thornfray's match on the server (server/thornfray_match.ts, ADR 0035):
// the eight seats dealt once, each bout built over them as they stand, the
// ledger chaining six bouts on real sims (server/royale_build.ts over
// buildBoutSim on the shipped Wanderseed), the same seats in every bout, the
// prize's Graft on the next bout alone, a prize left open through a fall
// and past its bout's end carried and offered again unchanged, and the
// seat a late person takes at the second Lull.

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import { RoyaleMatch } from '../server/royale_match';
import type { RoyalePerson } from '../server/royale_seats';
import {
  type BoutBuild,
  dealThornfray,
  endRows,
  LATE_BOUT,
  lateSeat,
  matchPlaces,
  nextBoutBuild,
  seatBouts,
  seatOfOwner,
  type ThornfrayMatch,
  tableRows,
  takeSeat,
} from '../server/thornfray_match';
import { royaleReplayPlayable } from '../src/net/replay';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { LASTWICK } from '../src/sim/content/bouts/lastwick';
import { BOUT_SEATS, BOUTS } from '../src/sim/content/bouts/match';
import { STARGLEAN } from '../src/sim/content/bouts/starglean';
import { type BoutResult, boutSeed, matchWinner, recordBout } from '../src/sim/royale/bouts/ledger';
import { thornyardOf } from '../src/sim/royale/bouts/plan';
import { royaleGround } from '../src/sim/royale/mode';
import { royaleLayoutOf } from '../src/sim/royale/planet_map';
import { DROP_S } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { loadPlanet } from './royale_planet';

const factory = royaleFactory(loadPlanet);
const planet = loadPlanet();
const layout = royaleLayoutOf(planet.layout);
const ground = royaleGround(planet.ground());

const pick = { championId: 'dain', sigils: ['riftstep', 'mend'] as [string, string], skin: 1 };
const person = (clientId: number, owner: number, guest = false): RoyalePerson => ({
  clientId,
  owner,
  name: `p${owner}`,
  guest,
  pick,
});

// A bout's match built as the service builds one: the people connected on
// their seats, the rest on their bots.
function boutMatch(
  m: ThornfrayMatch,
  people: readonly RoyalePerson[],
  id = 1,
): { match: RoyaleMatch; build: BoutBuild } {
  const clientOf = (owner: number): number | null =>
    people.find((p) => p.owner === owner)?.clientId ?? null;
  const build = nextBoutBuild(m, clientOf)!;
  const match = new RoyaleMatch(id, build.seed, build.kind.base, people, factory, BOUT_SEATS, 1, {
    seats: build.seats,
    bout: build.bout,
  });
  return { match, build };
}

const modeOf = (match: RoyaleMatch) => (match.sim as unknown as Sim).royaleMode!;

// Ticks a bout's match until it is over (or the cap).
function playOut(match: RoyaleMatch, capS = 200): void {
  const cap = Math.round((DROP_S + capS) / DT);
  while (!match.over && match.sim.tickCount < cap) match.tick();
}

// A bout's result written by hand: `first` the winner, the rest in seat
// order.
function handResult(m: ThornfrayMatch, first: number): BoutResult {
  const index = m.ledger.results.length;
  const rest = Array.from({ length: BOUT_SEATS }, (_, s) => s).filter((s) => s !== first);
  return {
    kind: m.ledger.draws[index]!.kind,
    ranking: [first, ...rest],
    counts: new Array(BOUT_SEATS).fill(0),
    pendingPrize: [],
    prizeGrafts: [],
  };
}

describe('the seats', () => {
  it('are dealt once, the people first, each owned by its person', () => {
    const m = dealThornfray([person(1, 70), person(2, -71, true)], 9, BOUT_KINDS);
    expect(m.seats).toHaveLength(BOUT_SEATS);
    expect(m.seats.slice(0, 2).map((s) => s.name)).toEqual(['p70', 'p-71']);
    expect(m.owners).toEqual([70, -71, null, null, null, null, null, null]);
    expect(m.guestsOnly).toBe(false);
    expect(m.seats.slice(2).every((s) => s.bot?.softened === false)).toBe(true);
    expect(seatOfOwner(m, -71)).toBe(1);
    expect(seatOfOwner(m, 5)).toBeNull();
    expect(m.ledger.draws).toHaveLength(BOUTS);
    const guests = dealThornfray([person(1, -70, true)], 9, BOUT_KINDS);
    expect(guests.guestsOnly).toBe(true);
    expect(guests.seats.slice(1).every((s) => s.bot?.softened === true)).toBe(true);
  });

  it('build each bout over the seats as they stand: a person away is the seat bot', () => {
    const m = dealThornfray([person(1, 70), person(2, 71)], 9, BOUT_KINDS);
    const build = nextBoutBuild(m, (owner) => (owner === 70 ? 5 : null))!;
    expect(build.seats[0]).toMatchObject({ clientId: 5, name: 'p70' });
    expect(build.seats[0]!.bot).toBeUndefined();
    expect(build.seats[1]).toMatchObject({ clientId: null, name: 'p71', bot: { softened: false } });
    expect(build.bout).toEqual({
      matchSeed: 9,
      index: 0,
      kind: m.ledger.draws[0]!.kind,
      region: m.ledger.draws[0]!.region,
      prize: null,
      pendingPrize: [],
      grafts: Array.from({ length: BOUT_SEATS }, () => []),
      guestsOnly: false,
    });
    expect(build.seed).toBe(boutSeed(9, 0));
  });

  it('match in bouts 1 and 2 on every seat name, champion, sigils, skin and skill', () => {
    const m = dealThornfray([person(1, 70)], 4, BOUT_KINDS);
    const first = boutMatch(m, [person(1, 70)]);
    recordBout(m.ledger, handResult(m, 3));
    // Away in the second: the bot plays the seat, its skill the same.
    const second = boutMatch(m, []);
    expect(second.build.index).toBe(1);
    const seatOf = (match: RoyaleMatch, i: number) => {
      const u = match.sim.units.get(match.unitIds[i]!)!;
      return {
        name: match.seatLabel(u.id)?.name,
        championId: u.championId,
        sigils: [...u.sigils],
        skin: u.skin,
        skill: modeOf(match).skillOf(u.id),
      };
    };
    for (let i = 0; i < BOUT_SEATS; i++) {
      expect(seatOf(second.match, i)).toEqual(seatOf(first.match, i));
    }
    // The records alike, but the seat whose person was away: its bot's.
    const kit = (match: RoyaleMatch) =>
      match.replayRecord()!.picks.map((p) => [p.name, p.championId, p.sigils, p.skin]);
    expect(kit(second.match)).toEqual(kit(first.match));
    expect(second.match.replayRecord()!.picks[0]!.bot).toBeDefined();
    expect(first.match.replayRecord()!.picks[0]!.bot).toBeUndefined();
  });
});

describe('the chain', () => {
  it('plays six bouts on a seed, each its own sim, seed and record, to one winner', () => {
    const m = dealThornfray([], 3, BOUT_KINDS);
    const seeds: number[] = [];
    const prizes: (number | null)[] = [];
    for (let index = 0; index < BOUTS; index++) {
      const { match, build } = boutMatch(m, [], 10 + index);
      expect(build.index).toBe(index);
      expect(build.kind.id).toBe(m.ledger.draws[index]!.kind);
      expect(build.final).toBe(index === BOUTS - 1);
      seeds.push(build.seed);
      prizes.push(build.bout.prize);
      playOut(match);
      expect(match.over).toBe(true);
      const record = match.replayRecord()!;
      expect(record.royale.bout).toMatchObject({ matchSeed: 3, index, kind: build.kind.id });
      expect(royaleReplayPlayable(record)).toBe(true);
      recordBout(m.ledger, match.bout!.result());
    }
    expect(new Set(seeds).size).toBe(BOUTS);
    // The prize is the last bout's winner, from the second on.
    expect(prizes[0]).toBeNull();
    for (let i = 1; i < BOUTS; i++) expect(prizes[i]).toBe(m.ledger.results[i - 1]!.ranking[0]);
    expect(nextBoutBuild(m, () => null)).toBeNull();
    const winner = matchWinner(m.ledger)!;
    expect(matchPlaces(m)[winner]).toBe(1);
    expect([...matchPlaces(m)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(seatBouts(m, winner)).toHaveLength(BOUTS);
    expect(endRows(m, () => ({ name: 'x', bot: true }))[0]![0]).toBe(winner);
  });
});

describe('the prize', () => {
  it('stands on the next bout only: picked there, gone from the one after', () => {
    const m = dealThornfray([], 6, BOUT_KINDS);
    recordBout(m.ledger, handResult(m, 2));
    const second = boutMatch(m, []);
    expect(second.build.bout.prize).toBe(2);
    const holder = second.match.unitIds[2]!;
    while (second.match.stage === 'drop') second.match.tick();
    // The seat's bot picked the prize over the Lull: the one Graft standing.
    const held = [...second.match.sim.royale.grafts].filter(([, g]) => g.length > 0);
    expect(held.map(([id]) => id)).toEqual([holder]);
    playOut(second.match);
    const result = second.match.bout!.result();
    expect(result.prizeGrafts.map((p) => p.seat)).toEqual([2]);
    recordBout(m.ledger, result);
    const third = boutMatch(m, []);
    expect(third.build.bout.grafts.every((g) => g.length === 0)).toBe(true);
    expect(third.match.sim.units.get(third.match.unitIds[2]!)!.grafts).toEqual([]);
  });

  it('stays open through a fall and is carried, unchanged, to the next bout', () => {
    const m = dealThornfray([person(1, 70)], 8, [LASTWICK]);
    recordBout(m.ledger, handResult(m, 0));
    const second = boutMatch(m, [person(1, 70)]);
    const u = second.match.sim.units.get(second.match.unitIds[0]!)!;
    while (second.match.stage === 'drop') second.match.tick();
    const offer = second.match.sim.royale.offers.get(u.id)?.[0];
    expect(offer?.prize).toBe(true);
    // Brought down by the burn far outside the Thornyard: out for the bout.
    const away = second.build.bout.region === 'sanctuary' ? 'cliffs' : 'sanctuary';
    u.pos = ground.nearestWalkable(thornyardOf(layout, away, 40).center)!;
    u.path = [];
    u.hp = 1;
    second.match.tick();
    expect(u.dead).toBe(true);
    expect(second.match.isOut(u.id)).toBe(true);
    expect(second.match.sim.royale.offers.get(u.id)?.[0]).toEqual(offer);
    playOut(second.match);
    const result = second.match.bout!.result();
    expect(result.pendingPrize).toEqual([{ seat: 0, cards: offer!.cards }]);
    recordBout(m.ledger, result);
    const third = boutMatch(m, [person(1, 70)]);
    expect(third.build.bout.pendingPrize).toEqual([{ seat: 0, cards: offer!.cards }]);
    third.match.tick();
    const again = third.match.sim.royale.offers.get(third.match.unitIds[0]!)?.[0];
    expect(again?.cards).toEqual(offer!.cards);
    expect(again?.prize).toBe(true);
  });

  it('carries an offer left unpicked at its bout end, and offers it again', () => {
    const m = dealThornfray([person(1, 70)], 5, [STARGLEAN]);
    recordBout(m.ledger, handResult(m, 0));
    const second = boutMatch(m, [person(1, 70)]);
    playOut(second.match);
    const result = second.match.bout!.result();
    const open = result.pendingPrize.find((p) => p.seat === 0);
    expect(open?.cards).toHaveLength(3);
    recordBout(m.ledger, result);
    const third = boutMatch(m, [person(1, 70)]);
    third.match.tick();
    const head = third.match.sim.royale.offers.get(third.match.unitIds[0]!)!;
    expect(
      head.some((o) => o.prize && JSON.stringify(o.cards) === JSON.stringify(open!.cards)),
    ).toBe(true);
  });
});

describe('a late person', () => {
  it('takes the fewest-bushels bot seat at the second Lull, and only then', () => {
    const m = dealThornfray([person(1, 70)], 2, BOUT_KINDS);
    expect(lateSeat(m)).toBeNull();
    // Seat 0 (the person) last; the bots 5, 6 and 7 at nothing besides it.
    recordBout(m.ledger, { ...handResult(m, 1), ranking: [1, 2, 3, 4, 7, 6, 5, 0] });
    expect(m.ledger.results).toHaveLength(LATE_BOUT);
    expect(lateSeat(m)).toBe(5);
    const bushels = tableRows(m, [], () => ({ name: '', bot: true })).find((r) => r[0] === 5)![5];
    takeSeat(m, 5, { ...person(9, 90), pick: { ...pick, championId: 'torv' } });
    expect(m.owners[5]).toBe(90);
    expect(m.seats[5]).toMatchObject({ name: 'p90', championId: 'torv', clientId: 9 });
    expect(m.seats[5]!.bot).toBeUndefined();
    // Its bushels kept; the next late seat is the next bot's.
    expect(tableRows(m, [], () => ({ name: '', bot: false })).find((r) => r[0] === 5)![5]).toBe(
      bushels,
    );
    expect(lateSeat(m)).toBe(6);
    recordBout(m.ledger, handResult(m, 1));
    expect(lateSeat(m)).toBeNull();
  });
});
