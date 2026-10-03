// Where a battle royale bot lands: a share of the bots hot-drop the
// Sanctuary, the rest spread over the regions, each a little way off its
// region's heart in a direction of its own. Drawn from the match's stream
// the first slot of the drop.

import type { Vec3 } from '../../geo';
import type { Rng } from '../../rng';
import { nearPole, type RoyaleLayout, randomAround } from '../layout';

// The share of the bots that land in the Sanctuary, and how far around its
// heart; how far around a region's heart the others land.
export const HOT_DROP_SHARE = 0.2;
export const HOT_DROP_M = 16;
export const REGION_DROP_M = 38;

export function pickDropPoint(layout: RoyaleLayout, rng: Rng): Vec3 {
  const R = layout.radius;
  const sanctuary = layout.regions.find((r) => r.id === 'sanctuary');
  const others = layout.regions.filter((r) => r.id !== 'sanctuary');
  const hot = sanctuary !== undefined && rng.next() < HOT_DROP_SHARE;
  const region = hot ? sanctuary : others[rng.int(others.length)];
  const heart = region?.heart ?? { x: R, y: 0, z: 0 };
  const reach = hot ? HOT_DROP_M : REGION_DROP_M;
  for (let i = 0; i < 6; i++) {
    const p = randomAround(rng, heart, reach * (0.15 + 0.85 * rng.next()), R);
    if (!nearPole(p, R)) return p;
  }
  return heart;
}
