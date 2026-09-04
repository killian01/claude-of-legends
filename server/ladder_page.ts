// The ladder page (CONTEXT.md: Ladder): one way at a time, the placed
// accounts by rating with what the match log says of each, the reader's
// own place whether or not they are in the top, and the accounts still in
// placement. Pure over the ratings of the way and the way's stats, so
// every number on the page is pinned by tests.

import { LADDER_CAP, MIN_RATED_GAMES } from './ladder';
import { BASE_RATING } from './rating';
import { favoriteOf, type Result, type WayStats } from './way_stats';
import type { Way } from './ways';

export const PLACING_CAP = 20;
// The form a row shows; the reader's own place shows the whole FORM_CAP.
export const ROW_FORM = 5;

// One account's rating on the way, however the way stores it.
export interface LadderSeed {
  accountId: number;
  // Null when the account is gone: it does not place.
  name: string | null;
  rating: number;
  games: number;
  createdAt?: number;
}

export interface BotSummary {
  id: string;
  name: string;
  championId: string;
  tally: { wins: number; losses: number };
}

export interface Favorite {
  championId: string;
  games: number;
  // A forged champion (the Forge queue): its name and its splash, when it
  // has one, since a forged id means nothing to the client on its own.
  forged?: { name: string; splash: string | null };
}

export interface LadderPageRow {
  rank: number;
  id: number;
  name: string;
  rating: number;
  ratedGames: number;
  wins: number;
  losses: number;
  form: Result[];
  favorite: Favorite | null;
  // The account's ranked bots, on the bot ways.
  bots?: BotSummary[];
}

export interface PlacingRow {
  id: number;
  name: string;
  ratedGames: number;
  lastAt: number | null;
}

export interface MePlace {
  // Null until placed.
  rank: number | null;
  rating: number;
  ratedGames: number;
  placed: boolean;
  wins: number;
  losses: number;
  form: Result[];
  // The reader's own row when placed beyond the page's cap, to pin under
  // the table with its true rank.
  pinned?: LadderPageRow;
}

export interface LadderPage {
  way: Way;
  // Placed accounts on the way.
  total: number;
  rows: LadderPageRow[];
  placing: PlacingRow[];
  me: MePlace;
}

export interface LadderPageOpts {
  cap?: number;
  placingCap?: number;
  bots?: (accountId: number) => BotSummary[];
  forged?: (championId: string) => { name: string; splash: string | null } | null;
}

interface Placed extends LadderSeed {
  name: string;
}

function byPlace(a: Placed, b: Placed): number {
  return (
    b.rating - a.rating ||
    b.games - a.games ||
    (a.createdAt ?? 0) - (b.createdAt ?? 0) ||
    a.accountId - b.accountId
  );
}

function placedOf(seeds: readonly LadderSeed[]): Placed[] {
  const out: Placed[] = [];
  for (const s of seeds) {
    if (s.name !== null && s.games >= MIN_RATED_GAMES) out.push({ ...s, name: s.name });
  }
  return out.sort(byPlace);
}

function rowOf(
  rank: number,
  s: Placed,
  stats: ReadonlyMap<number, WayStats>,
  opts: LadderPageOpts,
): LadderPageRow {
  const st = stats.get(s.accountId);
  const fav = favoriteOf(st);
  let favorite: Favorite | null = null;
  if (fav) {
    const forged = opts.forged?.(fav.championId) ?? null;
    favorite = forged ? { ...fav, forged } : fav;
  }
  const bots = opts.bots?.(s.accountId);
  return {
    rank,
    id: s.accountId,
    name: s.name,
    rating: s.rating,
    ratedGames: s.games,
    wins: st?.wins ?? 0,
    losses: st?.losses ?? 0,
    form: st?.form.slice(0, ROW_FORM) ?? [],
    favorite,
    ...(bots !== undefined ? { bots } : {}),
  };
}

export function buildLadderPage(
  way: Way,
  seeds: readonly LadderSeed[],
  stats: ReadonlyMap<number, WayStats>,
  readerId: number,
  opts: LadderPageOpts = {},
): LadderPage {
  const cap = opts.cap ?? LADDER_CAP;
  const placed = placedOf(seeds);
  const rows = placed.slice(0, cap).map((s, i) => rowOf(i + 1, s, stats, opts));

  const mine = seeds.find((s) => s.accountId === readerId);
  const myStats = stats.get(readerId);
  const myIndex = placed.findIndex((s) => s.accountId === readerId);
  const me: MePlace = {
    rank: myIndex === -1 ? null : myIndex + 1,
    rating: mine?.rating ?? BASE_RATING,
    ratedGames: mine?.games ?? 0,
    placed: myIndex !== -1,
    wins: myStats?.wins ?? 0,
    losses: myStats?.losses ?? 0,
    form: myStats?.form ?? [],
  };
  if (myIndex >= cap) me.pinned = rowOf(myIndex + 1, placed[myIndex]!, stats, opts);

  const placing: PlacingRow[] = [];
  for (const s of seeds) {
    if (s.name === null || s.games <= 0 || s.games >= MIN_RATED_GAMES) continue;
    placing.push({
      id: s.accountId,
      name: s.name,
      ratedGames: s.games,
      lastAt: stats.get(s.accountId)?.lastAt ?? null,
    });
  }
  placing.sort((a, b) => b.ratedGames - a.ratedGames || (b.lastAt ?? 0) - (a.lastAt ?? 0));

  return {
    way,
    total: placed.length,
    rows,
    placing: placing.slice(0, opts.placingCap ?? PLACING_CAP),
    me,
  };
}

// The account's place on one way, for the home card: rank when placed,
// the rating and games either way, the placed count for "of N".
export interface Place {
  rank: number | null;
  rating: number;
  games: number;
  placed: boolean;
  total: number;
}

export function placeOf(seeds: readonly LadderSeed[], readerId: number): Place {
  const placed = placedOf(seeds);
  const i = placed.findIndex((s) => s.accountId === readerId);
  const mine = seeds.find((s) => s.accountId === readerId);
  return {
    rank: i === -1 ? null : i + 1,
    rating: mine?.rating ?? BASE_RATING,
    games: mine?.games ?? 0,
    placed: i !== -1,
    total: placed.length,
  };
}
