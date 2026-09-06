// What a champion costs and what a match pays, in laurels (ADR 0018).
// Data as code and the only place a price is written down, the twin of
// server/embers.ts and here for the same reason: a price never reaches a
// match, so it has no business in src/sim/.
//
// The two units never meet. An ember is a cent the server spends at a
// provider and is granted, never earned; a laurel is earned by playing
// and buys only what costs nothing to hand out. Nothing converts one into
// the other, because an economy where playtime reaches the provider bill
// has no ceiling (ADR 0017, ADR 0018).

import { CHAMPION_LIST } from '../src/sim/content/champions';
import type { MatchRecord } from './records';
import { playedByHand, seatWay } from './ways';

// The collection every account starts with (CONTEXT.md: Collection). A
// frontline, an assassin, a marksman, and the mage the matchmaker already
// falls back to, so DEFAULT_CHAMPION_ID is something every account owns.
// None of the four has top as its home lane: the missing top laner is the
// first thing a new account wants, and the shop's first lesson.
export const STARTER_COLLECTION: readonly string[] = ['torv', 'fenn', 'ashvyn', 'sylra'];

// Hand-set, per champion, moved in either direction whenever the
// maintainer decides; there is deliberately no formula behind these
// (ADR 0018). Korrath and Vesk cost more because they arrive with their
// own models while the other eight wear shared CC0 pack assets
// (src/render/champions/manifest.ts).
export const CHAMPION_PRICES: Readonly<Record<string, number>> = {
  korrath: 800,
  vesk: 800,
  dain: 500,
  elowen: 500,
  maera: 500,
  rhoka: 500,
};

// What a match pays. The fixed part is deliberately the small one: it is
// the part an idle player collects. Only the hand and forge ways pay at
// all (server/ways.ts), so a bot playing overnight earns nothing.
export const MATCH_LAURELS = 60;
export const WIN_LAURELS = 150;
export const FIRST_WIN_BONUS = 200;

export function matchLaurels(won: boolean, firstWinOfDay: boolean): number {
  return (won ? WIN_LAURELS : MATCH_LAURELS) + (won && firstWinOfDay ? FIRST_WIN_BONUS : 0);
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

// The day and week a moment falls in. Both are plain divisions of the
// epoch rather than calendar arithmetic: no timezone, no scheduler, no
// stored state, and the same answer on every host.
export function dayIndex(at: number): number {
  return Math.floor(at / DAY_MS);
}

export function weekIndex(at: number): number {
  return Math.floor(at / WEEK_MS);
}

export const ROTATION_SIZE = 3;

// What the rotation draws from: every roster champion outside the
// starter, in roster order. A starter in the rotation would be a week
// spent on champions everyone already owns.
export const ROTATION_POOL: readonly string[] = CHAMPION_LIST.map((c) => c.id).filter(
  (id) => !STARTER_COLLECTION.includes(id),
);

// The three champions every account may play this week whatever its
// collection (CONTEXT.md: Rotation), the same three for everyone. A
// window of three sliding one step a week, so each champion of the pool
// is free three weeks out of six and the cycle never stalls.
export function rotationAt(at: number): string[] {
  const pool = ROTATION_POOL;
  if (pool.length <= ROTATION_SIZE) return [...pool];
  const week = weekIndex(at);
  const out: string[] = [];
  for (let i = 0; i < ROTATION_SIZE; i++) {
    const id = pool[(((week + i) % pool.length) + pool.length) % pool.length];
    if (id !== undefined) out.push(id);
  }
  return out;
}

// Everything an account may pick right now: its collection plus the week's
// rotation. The floor this holds is what keeps blind pick from jamming
// (ADR 0018): four starters plus three rotating is seven, and a team can
// never take more than four of them from one player.
export function playableAt(collection: readonly string[], at: number): string[] {
  const out = [...collection];
  for (const id of rotationAt(at)) if (!out.includes(id)) out.push(id);
  return out;
}

// What this champion costs, or null when it is not for sale (a starter,
// or an id that is not a roster champion at all).
export function championPrice(championId: string): number | null {
  return CHAMPION_PRICES[championId] ?? null;
}

export interface Backfill {
  laurels: number;
  lastWinDay: number | null;
}

// What an account's recorded matches would have earned, for the one
// crossing into this economy (ADR 0018). Only the ways a person sat at
// the keyboard for count, exactly as they will from now on, so a bot's
// night of Arena rounds pays nothing retroactively either. Records arrive
// oldest first, which is what makes the first win of each day readable.
export function backfillLaurels(records: readonly MatchRecord[], accountId: number): Backfill {
  let laurels = 0;
  let lastWinDay: number | null = null;
  for (const rec of records) {
    for (const seat of rec.players) {
      if (seat.accountId !== accountId) continue;
      if (!playedByHand(seatWay(rec, seat))) continue;
      const won = seat.team === rec.winner;
      const day = dayIndex(rec.at);
      const first = won && day !== lastWinDay;
      if (first) lastWinDay = day;
      laurels += matchLaurels(won, first);
    }
  }
  return { laurels, lastWinDay };
}
