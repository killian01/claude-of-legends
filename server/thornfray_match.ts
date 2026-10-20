// A Thornfray's match as the server keeps it (CONTEXT.md: Thornfray, Bout,
// Bushel, Lull; ADR 0035): the eight seats dealt once for the whole match
// from its seed (royaleSeats: the house bots' names, champions, skins and
// sigils; buildBoutSim deals the bots' skills from the same seed), the
// ledger that draws the six bouts and keeps the bushels, who owns each seat
// (the reservations, by seat index: a person who leaves keeps their seat for
// the match, played by its bot until they come back), what the next bout is
// built from (the prize and the prizes carried unpicked included), and the
// seat a late person takes at the second Lull. Pure: the service
// (server/thornfray_service.ts) builds each bout from what this answers.

import type { BoutTableRow, ThornfrayEndRow } from '../src/net/royale_wire';
import { boutKindOf } from '../src/sim/content/bouts';
import { BOUT_SEATS, PRIZE_LASTS } from '../src/sim/content/bouts/match';
import type { BoutKind } from '../src/sim/content/bouts/types';
import {
  boutPaid,
  boutsWon,
  type Ledger,
  newLedger,
  nextBout,
  standings,
  totals,
} from '../src/sim/royale/bouts/ledger';
import { type RoyalePerson, type RoyaleSeat, royaleSeats } from './royale_seats';
import type { RoyaleBoutArgs } from './royale_sim';

export interface ThornfrayMatch {
  matchSeed: number;
  // The kinds the bouts were drawn from (the released pool at the start).
  kinds: readonly BoutKind[];
  ledger: Ledger;
  // The seats as dealt, in seat order; a late person's take puts their
  // name, champion, sigils and skin on theirs.
  seats: RoyaleSeat[];
  // Who owns each seat (an account, or a Guest's negative id), null for a
  // house bot's: a person's seat is theirs for the match, whether they are
  // in it now or not.
  owners: (number | null)[];
  // Only Guests among the people it started with: its bots play softer,
  // every bout alike.
  guestsOnly: boolean;
}

// A new match: its seats dealt from its seed, the people first.
export function dealThornfray(
  people: readonly RoyalePerson[],
  matchSeed: number,
  pool: readonly BoutKind[],
  seatCount = BOUT_SEATS,
): ThornfrayMatch {
  const seats = royaleSeats(people, matchSeed, seatCount);
  return {
    matchSeed,
    kinds: [...pool],
    ledger: newLedger(matchSeed, pool, seatCount),
    seats,
    owners: seats.map((s) => people.find((p) => p.clientId === s.clientId)?.owner ?? null),
    guestsOnly: people.length > 0 && people.every((p) => p.guest),
  };
}

// The seat an owner holds in this match, null for none.
export function seatOfOwner(m: ThornfrayMatch, owner: number): number | null {
  const seat = m.owners.indexOf(owner);
  return seat >= 0 ? seat : null;
}

// What the next bout is built from, null once the Final is played: its
// index, seed and kind, whether it is the Final, the seats as they stand
// (a person's while they are in it, `clientOf` answering their connection,
// else the seat's bot, with its softening), and the factory's bout.
export interface BoutBuild {
  index: number;
  seed: number;
  kind: BoutKind;
  final: boolean;
  seats: RoyaleSeat[];
  bout: RoyaleBoutArgs;
}

export function nextBoutBuild(
  m: ThornfrayMatch,
  clientOf: (owner: number) => number | null,
): BoutBuild | null {
  const next = nextBout(m.ledger, PRIZE_LASTS);
  if (!next) return null;
  const kind = boutKindOf(next.kind, m.kinds);
  if (!kind) throw new Error(`no bout kind ${next.kind}`);
  const seats = m.seats.map((s, i): RoyaleSeat => {
    const owner = m.owners[i] ?? null;
    const clientId = owner === null ? null : clientOf(owner);
    const { bot: _bot, clientId: _dealt, newcomer, ...pick } = s;
    return clientId === null
      ? { ...pick, clientId: null, bot: { softened: m.guestsOnly } }
      : { ...pick, clientId, ...(newcomer ? { newcomer } : {}) };
  });
  return {
    index: next.index,
    seed: next.seed,
    kind,
    final: next.final,
    seats,
    bout: {
      matchSeed: m.matchSeed,
      index: next.index,
      kind: next.kind,
      region: next.region,
      prize: next.prize,
      pendingPrize: next.pendingPrize,
      grafts: next.grafts,
      guestsOnly: m.guestsOnly,
    },
  };
}

// The bout whose Lull still takes a late person: the second.
export const LATE_BOUT = 1;

// The seat a late person takes at the second Lull: a house bot's (nobody
// owns it), the one with the fewest bushels, the lower seat on a tie; null
// at any other time or with none left.
export function lateSeat(m: ThornfrayMatch): number | null {
  if (m.ledger.results.length !== LATE_BOUT) return null;
  const bushels = totals(m.ledger);
  let best: number | null = null;
  m.owners.forEach((owner, seat) => {
    if (owner !== null) return;
    if (best === null || bushels[seat]! < bushels[best]!) best = seat;
  });
  return best;
}

// A late person takes a seat: theirs from now on, its bushels kept, its
// champion, sigils and skin replaced by the ones they picked.
export function takeSeat(m: ThornfrayMatch, seat: number, person: RoyalePerson): void {
  const was = m.seats[seat];
  if (!was) return;
  m.seats[seat] = {
    name: person.name,
    team: was.team,
    championId: person.pick.championId,
    sigils: [person.pick.sigils[0], person.pick.sigils[1]],
    skin: person.pick.skin,
    clientId: person.clientId,
  };
  m.owners[seat] = person.owner;
}

// Every seat's place in the match as it stands (1 the first), by seat.
export function matchPlaces(m: ThornfrayMatch): number[] {
  const out = new Array<number>(m.seats.length).fill(0);
  standings(m.ledger).forEach((seat, i) => {
    out[seat] = i + 1;
  });
  return out;
}

// Who holds a seat now, as the table shows it.
export interface SeatShown {
  name: string;
  bot: boolean;
}

// The table a bout starts with, best first: each seat's index, its unit in
// this bout, name, champion, bot mark, bushels, the bushels the last bout
// paid it and the bouts it won.
export function tableRows(
  m: ThornfrayMatch,
  unitIds: readonly number[],
  shown: (seat: number) => SeatShown,
): BoutTableRow[] {
  const bushels = totals(m.ledger);
  const last = boutPaid(m.ledger, m.ledger.results.length - 1);
  const won = boutsWon(m.ledger);
  return standings(m.ledger).map((seat): BoutTableRow => {
    const s = shown(seat);
    return [
      seat,
      unitIds[seat] ?? 0,
      s.name,
      m.seats[seat]?.championId ?? '',
      s.bot ? 1 : 0,
      bushels[seat] ?? 0,
      last[seat] ?? 0,
      won[seat] ?? 0,
    ];
  });
}

// The table at the match's end, best first.
export function endRows(m: ThornfrayMatch, shown: (seat: number) => SeatShown): ThornfrayEndRow[] {
  const bushels = totals(m.ledger);
  const won = boutsWon(m.ledger);
  return standings(m.ledger).map((seat): ThornfrayEndRow => {
    const s = shown(seat);
    return [
      seat,
      s.name,
      m.seats[seat]?.championId ?? '',
      s.bot ? 1 : 0,
      bushels[seat] ?? 0,
      won[seat] ?? 0,
    ];
  });
}

// One seat bout by bout: the kind, its place and the bushels it paid.
export function seatBouts(
  m: ThornfrayMatch,
  seat: number,
): { k: string; pl: number; paid: number }[] {
  return m.ledger.results.map((r, index) => ({
    k: r.kind,
    pl: r.ranking.indexOf(seat) + 1,
    paid: boutPaid(m.ledger, index)[seat] ?? 0,
  }));
}
