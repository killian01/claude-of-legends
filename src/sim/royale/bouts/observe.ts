// A bout in a seat's observation (ObsRoyale.bout, policy contract v0,
// additive; ADR 0035): the kind, the bout's index and how many there are,
// the Final's double, the seat's own count and its place as the bout
// stands, the best count, and the kind's goal primitives (absent when it
// stands none), each holder named by its unit id. What the HUD shows a
// person, no more: a bot reads a bout's goal from here alone.

import { BOUTS } from '../../content/bouts/match';
import type { ObsGoal, ObsRoyale } from '../../policy';
import type { Sim } from '../../sim';
import type { Unit } from '../../unit';
import type { RoyaleMode } from '../mode';
import { boutRanking } from './end';
import { boutPrimitives } from './goals';

export function observeBout(mode: RoyaleMode, sim: Sim, u: Unit): Pick<ObsRoyale, 'bout'> {
  const b = mode.state.bout;
  if (!b) return {};
  const seat = b.seats.indexOf(u.id);
  const ranking = boutRanking(mode, sim);
  let best = 0;
  for (const c of b.counts) best = Math.max(best, c);
  const goals: ObsGoal[] = boutPrimitives(mode).map((p) => ({
    shape: p.shape,
    x: p.at.x,
    y: p.at.y,
    z: p.at.z,
    radius: p.radius,
    holder: p.holder !== null ? (b.seats[p.holder] ?? null) : null,
  }));
  return {
    bout: {
      kind: b.kind,
      index: b.index,
      of: BOUTS,
      double: b.final,
      count: seat >= 0 ? (b.counts[seat] ?? 0) : 0,
      place: seat >= 0 ? ranking.indexOf(seat) + 1 : 0,
      best,
      ...(goals.length > 0 ? { goals } : {}),
    },
  };
}
