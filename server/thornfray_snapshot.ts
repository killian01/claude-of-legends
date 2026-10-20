// A Thornfray's bout on the wire (ADR 0035): the tf block of a bout's
// match_start (the bout, the six kinds, the recipient's seat, the table and
// the prize's seat), sent at every bout's start and again on a rejoin, so a
// client that comes back during a Lull has the whole table; and the tf block
// of each snapshot (the recipient's count and place, the best count, the
// goal primitives), sent when it changes through sentOnChange, whose memory
// is the seat's own record: a bout seats everyone afresh
// (server/royale_match.ts), so every bout starts it over.

import { goalOnWire } from '../src/net/goal_wire';
import type { BoutStart, SnapBout } from '../src/net/royale_wire';
import type { BoutHost, RoyaleSim } from './royale_sim';
import type { RoyaleViewer } from './royale_snapshot';
import { sentOnChange } from './royale_snapshot_blocks';
import { round2 } from './snapshot';
import { type SeatShown, type ThornfrayMatch, tableRows } from './thornfray_match';

// The recipient's line of the bout as it stands; undefined outside a bout,
// for a viewer holding no seat in it, or when nothing changed since the
// last one this seat was sent.
export function boutSnapBlock(
  sim: RoyaleSim,
  viewer: RoyaleViewer,
  bout: BoutHost,
): SnapBout | undefined {
  const b = sim.royale.bout;
  if (!b) return undefined;
  const seat = b.seats.indexOf(viewer.unitId);
  if (seat < 0) return undefined;
  let best = 0;
  for (const c of b.counts) best = Math.max(best, c);
  const goals = bout.primitives().map((p) =>
    goalOnWire({
      shape: p.shape,
      at: p.at,
      radius: p.radius,
      holder: p.holder !== null ? (b.seats[p.holder] ?? null) : null,
    }),
  );
  const value: SnapBout = {
    c: round2(b.counts[seat] ?? 0),
    pl: bout.ranking().indexOf(seat) + 1,
    bc: round2(best),
    ...(goals.length > 0 ? { g: goals } : {}),
  };
  return sentOnChange(viewer, 'tf', value, sim.time);
}

// A bout's match_start block for the person on `seat`: which bout, the
// kinds in order, their seat, the table best first (each seat's unit in
// this bout), and the seat offered a prize this bout.
export function boutStartBlock(
  m: ThornfrayMatch,
  index: number,
  unitIds: readonly number[],
  seat: number,
  shown: (seat: number) => SeatShown,
  prize: number | null,
): BoutStart {
  return {
    b: index,
    k: m.ledger.draws.map((d) => d.kind),
    s: seat,
    t: tableRows(m, unitIds, shown),
    ...(prize !== null ? { p: prize } : {}),
  };
}
