// The seat a replay follows: their team, their fog, their deaths as the
// red marks on the bar. A Match sheet names the unit to follow (the bot
// its Record belongs to; the picks alone cannot say which seat that is
// when both versions of one bot are in the match). Without one, the first
// seat that is not a house bot: the owner in a sparring, the first human
// in a live match.

import type { ReplayPick } from '../net/replay';

export function followedSeat(
  picks: readonly ReplayPick[],
  unitIds: readonly number[],
  follow: number | undefined,
): number {
  if (follow !== undefined) {
    const i = unitIds.indexOf(follow);
    if (i !== -1 && picks[i] !== undefined) return i;
  }
  return Math.max(
    0,
    picks.findIndex((p) => !p.bot),
  );
}
