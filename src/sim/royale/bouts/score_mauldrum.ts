// Mauldrum's count (CONTEXT.md: Mauldrum; docs/design/mauldrum.md): the
// struck, the damage each seat lands on the Voidmaul, a whole point for
// each point of damage (each blow rounded on its own, so the count stays a
// whole number), MAUL_FELL_BONUS more for the blow that fells it, and a
// takedown moving MAUL_STEAL_SHARE of the fallen's struck (rounded down)
// to its taker. A Mauldrum bout stands no camp, no Warden and no ring but
// the Voidmaul's (content/bouts/mauldrum.ts systems), so every body a seat
// strikes that is not a seat's champion is the Voidmaul; the kind's test
// pins that.

import type { BoutScorer } from '../../content/bouts/types';

// What felling the Voidmaul adds to the seat that lands the last blow.
export const MAUL_FELL_BONUS = 400;
// The share of the fallen's struck a takedown hands to its taker.
export const MAUL_STEAL_SHARE = 0.2;

export const mauldrumScorer: BoutScorer = {
  id: 'struck',
  onEvents(events, bout) {
    for (const e of events) {
      if (e.type === 'damage') {
        const from = bout.seatOf(e.sourceId);
        if (from === null || bout.seatOf(e.targetId) !== null) continue;
        const pts = Math.round(e.amount);
        if (pts > 0) bout.counts[from] = bout.counts[from]! + pts;
      } else if (e.type === 'death') {
        const taker = bout.seatOf(e.killerId);
        if (taker === null) continue;
        const fallen = bout.seatOf(e.unitId);
        if (fallen === null) {
          bout.counts[taker] = bout.counts[taker]! + MAUL_FELL_BONUS;
          continue;
        }
        if (fallen === taker) continue;
        const moved = Math.floor(bout.counts[fallen]! * MAUL_STEAL_SHARE);
        if (moved <= 0) continue;
        bout.counts[fallen] = bout.counts[fallen]! - moved;
        bout.counts[taker] = bout.counts[taker]! + moved;
      }
    }
  },
};
