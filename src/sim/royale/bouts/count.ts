// The shared scorers (CONTEXT.md: Bout; ADR 0035, A bout's count is its
// own): what a kind names as its `count` when no scorer of its own is
// needed. Each writes the bout's counts only, by seat, from the tick's
// events the mode feeds it (bouts/goals.ts stepBout), the takedown score
// left alone: the bots' sharpening, the Lodestar, the scoreboard and the
// points keep reading takedowns.
//
// - survival: the order of the falls. Every seat starts at the number of
//   seats; a seat that falls is set to the number of seats already out,
//   those falling on one tick placed by the health they had on the tick
//   before (worse first), the higher seat first on a tie: One life's
//   placing (score.ts placeFallen).
// - weighted: a cache opened counts by its kind (plain, golden, Seedfall),
//   and a takedown moves `steal` from the fallen to its taker (none from a
//   fallen at nothing).
// - held time: every seat standing inside a circle, and the holder of a
//   carrier, counts the seconds it holds it.

import type { BoutScorer, BoutView } from '../../content/bouts/types';
import { dist2 } from '../../geo';
import type { SimEvent } from '../../sim';
import { DT } from '../../types';
import type { CacheKind } from '../types';

export const survivalScorer: BoutScorer = {
  id: 'survival',
  start(bout) {
    for (let i = 0; i < bout.seatCount; i++) bout.counts[i] = bout.seatCount;
  },
  onEvents(events, bout) {
    const fell: { seat: number; hp: number }[] = [];
    for (const e of events) {
      if (e.type !== 'death') continue;
      const seat = bout.seatOf(e.unitId);
      if (seat === null || bout.counts[seat]! < bout.seatCount) continue;
      if (fell.some((f) => f.seat === seat)) continue;
      fell.push({ seat, hp: bout.hpBefore(seat) });
    }
    if (fell.length === 0) return;
    fell.sort((a, b) => a.hp - b.hp || b.seat - a.seat);
    let out = 0;
    for (let i = 0; i < bout.seatCount; i++) if (bout.counts[i]! < bout.seatCount) out++;
    for (const f of fell) bout.counts[f.seat] = out++;
  },
};

export interface Weights {
  plain: number;
  golden: number;
  seedfall: number;
  // Moved from the fallen to its taker on a takedown.
  steal: number;
}

function weightOf(w: Weights, kind: CacheKind | null): number {
  if (kind === 'golden') return w.golden;
  if (kind === 'seedfall') return w.seedfall;
  return kind === 'plain' ? w.plain : 0;
}

export function weightedScorer(id: string, w: Weights): BoutScorer {
  return {
    id,
    onEvents(events: readonly SimEvent[], bout: BoutView) {
      for (const e of events) {
        if (e.type === 'royale_cache') {
          const seat = bout.seatOf(e.unitId);
          if (seat === null) continue;
          bout.counts[seat] = bout.counts[seat]! + weightOf(w, bout.cacheKind(e.cacheId));
        } else if (e.type === 'death') {
          const fallen = bout.seatOf(e.unitId);
          const taker = bout.seatOf(e.killerId);
          if (fallen === null || taker === null || taker === fallen) continue;
          const moved = Math.min(w.steal, bout.counts[fallen]!);
          if (moved <= 0) continue;
          bout.counts[fallen] = bout.counts[fallen]! - moved;
          bout.counts[taker] = bout.counts[taker]! + moved;
        }
      }
    },
  };
}

export function heldTimeScorer(id: string): BoutScorer {
  return {
    id,
    onEvents(_events: readonly SimEvent[], bout: BoutView) {
      const held = new Set<number>();
      for (const p of bout.primitives()) {
        if (p.shape === 'carrier' && p.holder !== null) held.add(p.holder);
        if (p.shape !== 'circle') continue;
        const r2 = p.radius * p.radius;
        for (let seat = 0; seat < bout.seatCount; seat++) {
          const s = bout.seat(seat);
          if (s && !s.dead && s.pos && dist2(s.pos, p.at) <= r2) held.add(seat);
        }
      }
      for (const seat of [...held].sort((a, b) => a - b)) {
        bout.counts[seat] = bout.counts[seat]! + DT;
      }
    },
  };
}
