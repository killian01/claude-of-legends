// When a bout ends and how it ranks (ADR 0035; docs/design/thornfray.md,
// Bushels): at its clock (its landing plus the kind's playS), or in a bout
// of One life's death as soon as one champion stands, or none. Every bout
// ranks all its seats: the count first (more is better), then the kind's
// tie-breaks in order (content/bouts/types.ts BoutTie), then the lower
// seat, so every place is paid once. What carries to the next bout (the
// prizes still open, the Grafts picked from a prize) is read here too.

import type { BoutTie } from '../../content/bouts/types';
import type { Sim } from '../../sim';
import { openPrizes } from '../grafts';
import type { RoyaleMode } from '../mode';
import type { BoutState } from '../types';
import type { BoutResult } from './ledger';

// Whether the bout is over now (the mode asks after the deaths).
export function boutOver(mode: RoyaleMode, sim: Sim): boolean {
  const s = mode.state;
  if (s.stage !== 'play' || !s.bout) return false;
  if (sim.time + 1e-9 >= s.endsAt) return true;
  if (mode.variant !== 'one_life') return false;
  let standing = 0;
  for (const id of s.bout.seats) {
    const u = sim.units.get(id);
    if (u && !u.dead) standing++;
  }
  return standing <= 1;
}

// A seat's health for the 'health' tie: before its fall when it fell (One
// life), its health now while it stands.
function healthOf(b: BoutState, sim: Sim, seat: number): number {
  const fell = b.fellHp[seat];
  if (fell !== null && fell !== undefined) return fell;
  const u = sim.units.get(b.seats[seat]!);
  return u && !u.dead ? u.hp : 0;
}

function tieOrder(tie: BoutTie, b: BoutState, sim: Sim, a: number, c: number): number {
  switch (tie) {
    case 'seedfalls':
      return b.seedfalls[c]! - b.seedfalls[a]!;
    case 'falls':
      return b.falls[a]! - b.falls[c]!;
    case 'reached':
      return b.reached[a]! - b.reached[c]!;
    case 'health':
      return healthOf(b, sim, c) - healthOf(b, sim, a);
    case 'seat':
      return a - c;
  }
}

// The seats best first, as the bout stands now (its ranking once over).
export function boutRanking(mode: RoyaleMode, sim: Sim): number[] {
  const b = mode.state.bout;
  if (!b) return [];
  if (b.ranking) return [...b.ranking];
  const ties = mode.bout?.kind.ties ?? [];
  return b.seats
    .map((_, seat) => seat)
    .sort((a, c) => {
      const byCount = b.counts[c]! - b.counts[a]!;
      if (byCount !== 0) return byCount;
      for (const tie of ties) {
        const d = tieOrder(tie, b, sim, a, c);
        if (d !== 0) return d;
      }
      return a - c;
    });
}

// The bout as it ended, for the ledger (ledger.ts recordBout): every seat
// best first, the counts, every prize still open (carried unpicked to the
// next bout), and the Grafts each seat picked from a prize in it.
export function boutResult(mode: RoyaleMode, sim: Sim): BoutResult {
  const b = mode.state.bout!;
  const carried = mode.bout?.grafts ?? [];
  const pendingPrize: BoutResult['pendingPrize'] = [];
  const prizeGrafts: BoutResult['prizeGrafts'] = [];
  b.seats.forEach((id, seat) => {
    for (const open of openPrizes(mode, id)) pendingPrize.push({ seat, cards: [...open.cards] });
    const held = [...(mode.state.grafts.get(id) ?? [])];
    for (const g of carried[seat] ?? []) {
      const i = held.indexOf(g);
      if (i >= 0) held.splice(i, 1);
    }
    for (const graft of held) prizeGrafts.push({ seat, graft });
  });
  return {
    kind: b.kind,
    ranking: boutRanking(mode, sim),
    counts: [...b.counts],
    pendingPrize,
    prizeGrafts,
  };
}
