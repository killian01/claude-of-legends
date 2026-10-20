// The Thornfray's ledger (CONTEXT.md: Thornfray, Bushel, Final; ADR 0035,
// The ledger is in the sim, the chain in the host): pure over plain data,
// what the server, the headless report and the tests chain bouts through.
//
// The draw: the six kinds and their Thornyards drawn at the start from the
// match's seed on a stream of its own, as one sequence holding three
// rules: never the kind just played; once the pool holds three kinds or
// more, never a kind three times in a match; each Thornyard around the
// heart of a region the kind allows, never the region just played unless
// the kind allows no other. A seeded shuffle of a deck (every kind as
// often as the rules allow it) is drawn again a bounded number of times,
// then a construction that always holds takes over (the shuffled pool in
// a cycle, each kind on the first of its regions that is not the last one
// played), so the draw never dead-ends: drawn one bout at a time, two
// kinds taken twice each and a third just played would leave no sixth.
//
// Then, bout by bout: the bout's seed, the bushels its places pay (double
// in the Final), the totals by seat index (never by unit id: each bout's
// Sim mints its own), the order of the table down to a total one, each
// bout's winner and the next bout's prize.

import { BOUT_BUSHELS, BOUT_SEATS, BOUTS, FINAL_FACTOR } from '../../content/bouts/match';
import type { BoutKind, BoutKindId } from '../../content/bouts/types';
import { Rng } from '../../rng';
import { REGION_IDS, type RegionId } from '../layout';

// The streams the ledger draws on, each of its own: the sequence, and the
// bouts' seeds.
export const BOUT_DRAW_SALT = 0x7b0a7f;
export const BOUT_SEED_SALT = 0x3f17a1;
// Decks shuffled before the construction takes over.
export const BOUT_DRAW_TRIES = 64;

// One bout of the sequence: its kind and its Thornyard's region.
export interface BoutDraw {
  kind: BoutKindId;
  region: RegionId;
}

// A prize carried unpicked to the next bout: its seat and its cards.
export interface PendingPrize {
  seat: number;
  cards: string[];
}

// A bout as it ended: every seat best first, the counts, the prizes still
// open, and the Grafts each seat picked from a prize during it.
export interface BoutResult {
  kind: BoutKindId;
  ranking: number[];
  counts: number[];
  pendingPrize: PendingPrize[];
  prizeGrafts: { seat: number; graft: string }[];
}

export interface Ledger {
  matchSeed: number;
  seats: number;
  draws: BoutDraw[];
  results: BoutResult[];
}

function regionsOf(kind: BoutKind): readonly RegionId[] {
  const own = kind.thornyard.regions;
  return own && own.length > 0 ? own : REGION_IDS;
}

function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = items[i]!;
    items[i] = items[j]!;
    items[j] = t;
  }
  return items;
}

// How often a kind may stand in a match of `bouts` from a pool of `n`.
export function kindCap(n: number, bouts = BOUTS): number {
  return n >= 3 ? 2 : Math.ceil(bouts / Math.max(1, n));
}

// Whether a sequence of kinds holds the draw's two kind rules.
export function kindsHold(kinds: readonly BoutKindId[], poolSize: number): boolean {
  const seen = new Map<BoutKindId, number>();
  for (let i = 0; i < kinds.length; i++) {
    if (i > 0 && kinds[i] === kinds[i - 1] && poolSize > 1) return false;
    const n = (seen.get(kinds[i]!) ?? 0) + 1;
    seen.set(kinds[i]!, n);
    if (poolSize >= 3 && n > 2) return false;
  }
  return true;
}

// The six bouts of a match, drawn from its seed (see the header).
export function drawBouts(matchSeed: number, pool: readonly BoutKind[], bouts = BOUTS): BoutDraw[] {
  if (pool.length === 0) throw new Error('a Thornfray draws its bouts from one kind at least');
  const rng = new Rng((matchSeed ^ BOUT_DRAW_SALT) >>> 0);
  const cap = kindCap(pool.length, bouts);
  for (let attempt = 0; attempt < BOUT_DRAW_TRIES; attempt++) {
    const deck: number[] = [];
    pool.forEach((_, i) => {
      for (let c = 0; c < cap; c++) deck.push(i);
    });
    const seq = shuffle(rng, deck).slice(0, bouts);
    if (seq.length < bouts) break;
    if (
      !kindsHold(
        seq.map((i) => pool[i]!.id),
        pool.length,
      )
    )
      continue;
    // Each Thornyard drawn among the kind's regions but the last one.
    let last: RegionId | null = null;
    return seq.map((i) => {
      const kind = pool[i]!;
      const allowed = regionsOf(kind);
      const fresh = allowed.filter((r) => r !== last);
      const from = fresh.length > 0 ? fresh : allowed;
      last = from[rng.int(from.length)]!;
      return { kind: kind.id, region: last };
    });
  }
  // The construction that always holds.
  const order = shuffle(
    rng,
    pool.map((_, i) => i),
  );
  let last: RegionId | null = null;
  const out: BoutDraw[] = [];
  for (let b = 0; b < bouts; b++) {
    const kind = pool[order[b % order.length]!]!;
    const allowed = regionsOf(kind);
    last = allowed.find((r) => r !== last) ?? allowed[0]!;
    out.push({ kind: kind.id, region: last });
  }
  return out;
}

// A bout's seed, from the match's on its own stream: the bout's index-th
// draw, so every bout of a match is seeded apart from every other.
export function boutSeed(matchSeed: number, index: number): number {
  const rng = new Rng((matchSeed ^ BOUT_SEED_SALT) >>> 0);
  let seed = 0;
  for (let i = 0; i <= index; i++) seed = rng.int(0x100000000);
  return seed >>> 0;
}

// Whether bout `index` is the Final.
export function isFinal(index: number, bouts = BOUTS): boolean {
  return index === bouts - 1;
}

// What a place (1 for the first) pays in a bout, the Final double.
export function bushelsFor(place: number, final: boolean): number {
  const paid = BOUT_BUSHELS[place - 1] ?? 0;
  return final ? paid * FINAL_FACTOR : paid;
}

export function newLedger(
  matchSeed: number,
  pool: readonly BoutKind[],
  seats = BOUT_SEATS,
  bouts = BOUTS,
): Ledger {
  return { matchSeed, seats, draws: drawBouts(matchSeed, pool, bouts), results: [] };
}

// A bout ended: its result kept, its ranking checked to name every seat
// once.
export function recordBout(ledger: Ledger, result: BoutResult): void {
  if (ledger.results.length >= ledger.draws.length) throw new Error('the match is over');
  const seen = new Set(result.ranking);
  const whole =
    result.ranking.length === ledger.seats &&
    seen.size === ledger.seats &&
    result.ranking.every((s) => Number.isInteger(s) && s >= 0 && s < ledger.seats);
  if (!whole) throw new Error('a bout ranks every seat once');
  ledger.results.push(result);
}

// The bushels bout `index` paid, by seat.
export function boutPaid(ledger: Ledger, index: number): number[] {
  const out = new Array<number>(ledger.seats).fill(0);
  const result = ledger.results[index];
  if (!result) return out;
  const final = isFinal(index, ledger.draws.length);
  result.ranking.forEach((seat, i) => {
    out[seat] = bushelsFor(i + 1, final);
  });
  return out;
}

// Every seat's bushels so far.
export function totals(ledger: Ledger): number[] {
  const out = new Array<number>(ledger.seats).fill(0);
  ledger.results.forEach((_, index) => {
    boutPaid(ledger, index).forEach((b, seat) => {
      out[seat] = out[seat]! + b;
    });
  });
  return out;
}

// Bouts each seat won so far.
export function boutsWon(ledger: Ledger): number[] {
  const out = new Array<number>(ledger.seats).fill(0);
  for (const r of ledger.results) {
    const w = r.ranking[0];
    if (w !== undefined) out[w] = out[w]! + 1;
  }
  return out;
}

// The table, best first, a total order: the most bushels, then the most
// bouts won, then the better place in the latest bout played (the
// Final's, once it is played: always distinct), then the lower seat.
export function standings(ledger: Ledger): number[] {
  const bushels = totals(ledger);
  const won = boutsWon(ledger);
  const latest = ledger.results[ledger.results.length - 1];
  const place = (seat: number): number => (latest ? latest.ranking.indexOf(seat) : 0);
  return Array.from({ length: ledger.seats }, (_, i) => i).sort(
    (a, b) => bushels[b]! - bushels[a]! || won[b]! - won[a]! || place(a) - place(b) || a - b,
  );
}

// The Thornfray's winner once every bout is played, null before.
export function matchWinner(ledger: Ledger): number | null {
  if (ledger.results.length < ledger.draws.length) return null;
  return standings(ledger)[0] ?? null;
}

// The Grafts each seat carries into the next bout: none while the prize
// lasts the next bout only; every prize Graft picked so far when it lasts
// the match.
export function carriedGrafts(ledger: Ledger, lasts: 'next' | 'all'): string[][] {
  const out: string[][] = Array.from({ length: ledger.seats }, () => []);
  if (lasts === 'next') return out;
  for (const r of ledger.results) for (const p of r.prizeGrafts) out[p.seat]!.push(p.graft);
  return out;
}

// What the next bout is built from, null once the match is over: its index,
// kind, region and seed, whether it is the Final, the seat offered a fresh
// prize (the last bout's winner), the prizes carried unpicked, and the
// Grafts each seat carries in.
export interface NextBout {
  index: number;
  kind: BoutKindId;
  region: RegionId;
  seed: number;
  final: boolean;
  prize: number | null;
  pendingPrize: PendingPrize[];
  grafts: string[][];
}

export function nextBout(ledger: Ledger, lasts: 'next' | 'all'): NextBout | null {
  const index = ledger.results.length;
  const draw = ledger.draws[index];
  if (!draw) return null;
  const last = ledger.results[index - 1];
  return {
    index,
    kind: draw.kind,
    region: draw.region,
    seed: boutSeed(ledger.matchSeed, index),
    final: isFinal(index, ledger.draws.length),
    prize: last ? (last.ranking[0] ?? null) : null,
    pendingPrize: last ? last.pendingPrize.map((p) => ({ seat: p.seat, cards: [...p.cards] })) : [],
    grafts: carriedGrafts(ledger, lasts),
  };
}
