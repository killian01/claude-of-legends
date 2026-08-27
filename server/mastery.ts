// Champion mastery: a purely cosmetic per-champion rank derived from how
// many recorded online matches a player has on that champion (CONTEXT.md:
// Mastery). Pure thresholds, no state; the profile builder stamps it on
// each champion line.

// Games needed to REACH each rank: rank 1 at 1 game ... rank 6 at 30.
export const MASTERY_THRESHOLDS = [1, 3, 6, 12, 20, 30] as const;

export const MASTERY_TITLES = [
  'Unranked',
  'Novice',
  'Adept',
  'Veteran',
  'Expert',
  'Master',
  'Legend',
] as const;

export function masteryRank(games: number): number {
  let rank = 0;
  for (const need of MASTERY_THRESHOLDS) {
    if (games >= need) rank++;
    else break;
  }
  return rank;
}

export function masteryTitle(rank: number): string {
  return MASTERY_TITLES[Math.max(0, Math.min(MASTERY_TITLES.length - 1, rank))] ?? 'Unranked';
}
