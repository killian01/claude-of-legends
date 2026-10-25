// What walking out of a live 5v5 match costs (server/main.ts
// walkOutOfMatch): the rating penalty, with the queue lockout beside it
// whenever it is above zero. Only a deliberate leave of a match still being
// decided can cost anything: a coach leaves its bot playing, a seat taken
// mid-match was never rated, and a match with a human on one side only
// rates nobody (rating.ts isRated).

import type { TeamId } from '../src/sim/types';
import { leaverPenalty } from './rating';

export interface WalkOutSeat {
  team: TeamId;
  // Whether this seat's person is still connected.
  connected: boolean;
}

export interface WalkOut {
  // The match could be rated when it began (no guest, a public queue).
  ratedEligible: boolean;
  // The match already has a winner.
  decided: boolean;
  // The leaver coaches a bot seat.
  coach: boolean;
  // The leaver took the seat mid-match.
  droppedIn: boolean;
  // Every seat a person holds, the leaver's included.
  seats: readonly WalkOutSeat[];
}

// The rating the walk-out costs, 0 when it costs nothing.
export function walkOutPenalty(w: WalkOut): number {
  if (!w.ratedEligible || w.decided || w.coach || w.droppedIn) return 0;
  const humansByTeam = [0, 0];
  for (const s of w.seats) {
    if (s.connected) humansByTeam[s.team] = (humansByTeam[s.team] ?? 0) + 1;
  }
  return leaverPenalty(humansByTeam);
}
