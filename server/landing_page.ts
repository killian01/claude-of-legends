// The landing's request: the ladder a visitor reads before anything else,
// which is the ladder of every human (ADR 0027): the accounts and the
// Guests with points, ranked by them, so the page shows whose names stand
// there and that one match puts a visitor's own beside them. The bot
// ladders stay inside the home and the Academy, where their owners read
// them. Names and numbers only, and the reader's own place when the
// request carries a Guest who has been here before.
//
// Pure over the same lines /api/public/ladder ranks (server/points_ladder.ts),
// so the two never disagree.

import {
  buildPointsLadder,
  type PointsEntry,
  type PointsLadder,
  type PointsReader,
} from './points_ladder';

export const LANDING_LADDER_ROWS = 10;

export interface LandingPage {
  ladder: PointsLadder;
}

export interface LandingInput {
  entries: readonly PointsEntry[];
  reader: PointsReader | null;
}

export interface LandingOpts {
  rows?: number;
}

export function buildLandingPage(input: LandingInput, opts: LandingOpts = {}): LandingPage {
  return {
    ladder: buildPointsLadder(input.entries, input.reader, opts.rows ?? LANDING_LADDER_ROWS),
  };
}
