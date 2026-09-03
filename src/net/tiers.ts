// The tiers (CONTEXT.md: Tier): the named bands of a rating, the same on
// every ladder, so a number reads as a place. Original names (ADR 0004),
// nothing borrowed from other games' metals. Types and a pure function,
// shared by the server's ladders and the client's panels.

export interface Tier {
  name: string;
  // The lowest rating in the band.
  min: number;
}

// From the base rating of 1000 (server/rating.ts) upward in steps of a
// hundred; below it, the Recruit.
export const TIERS: readonly Tier[] = [
  { name: 'Recruit', min: Number.NEGATIVE_INFINITY },
  { name: 'Regular', min: 1000 },
  { name: 'Veteran', min: 1100 },
  { name: 'Elite', min: 1200 },
  { name: 'Legend', min: 1300 },
];

export function tierOf(rating: number): Tier {
  let best = TIERS[0]!;
  for (const t of TIERS) if (rating >= t.min) best = t;
  return best;
}

// The rating a tier starts at, for "N to the next tier".
export function nextTier(rating: number): Tier | null {
  return TIERS.find((t) => t.min > rating) ?? null;
}
