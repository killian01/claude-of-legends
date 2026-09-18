// The landing's request: what a visitor with no account reads of the
// ladder. The top of the ladder by hand and the top bots, as names and
// numbers, so the page shows whose names stand there before it asks for
// theirs. Everything here is already public on the ladder page to any
// account; what this answer leaves out is what a visitor has no use for
// and a scraper would: ids, form, favorites, and any reader.
//
// Pure over the same seeds and stats the home and the ladder page read
// (server/home_page.ts), so the rows agree with the ladder to the number.

import { buildLadderPage, type LadderSeed } from './ladder_page';
import type { WayStats } from './way_stats';
import type { Way } from './ways';

export const LANDING_LADDER_ROWS = 5;

// Nobody is reading: no row is "mine" and no place is computed.
const NO_READER = -1;

export interface LandingLadderRow {
  rank: number;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  // The owner's name on a bot row; null by hand.
  owner: string | null;
}

export interface LandingLadder {
  way: Way;
  // Placed subjects on the way, so the page can say how many stand behind
  // the rows it shows.
  total: number;
  rows: LandingLadderRow[];
}

export interface LandingPage {
  ladder: LandingLadder;
  bots: LandingLadder;
  // Accounts on the server, the same count the public stats give.
  accounts: number;
}

export interface LandingInput {
  seeds: (way: Way) => readonly LadderSeed[];
  stats: (way: Way) => ReadonlyMap<string | number, WayStats>;
  accounts: number;
}

export interface LandingOpts {
  rows?: number;
}

export function buildLandingPage(input: LandingInput, opts: LandingOpts = {}): LandingPage {
  const cap = opts.rows ?? LANDING_LADDER_ROWS;
  const top = (way: Way): LandingLadder => {
    const page = buildLadderPage(way, input.seeds(way), input.stats(way), NO_READER, { cap });
    return {
      way,
      total: page.total,
      rows: page.rows.map((r) => ({
        rank: r.rank,
        name: r.name,
        rating: r.rating,
        wins: r.wins,
        losses: r.losses,
        owner: way === 'hand' ? null : (r.owner ?? null),
      })),
    };
  };
  // The Arena's top, or live play's until the Arena has placed a bot: the
  // same rule as the home's panel, so the two never disagree.
  let bots = top('arena');
  if (bots.total === 0) {
    const live = top('bot');
    if (live.total > 0) bots = live;
  }
  return { ladder: top('hand'), bots, accounts: input.accounts };
}
