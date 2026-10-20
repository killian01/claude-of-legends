// Where a battle royale bot lands: a share of the bots hot-drop the
// Sanctuary, the rest spread over the regions, each a little way off its
// region's heart in a direction of its own. Drawn from the match's stream
// the first slot of the drop. In a Thornfray's bout, inside the Thornyard
// the observation shows (the Dusk's phase 0 cap), spread over it.

import type { Vec3 } from '../../geo';
import type { Rng } from '../../rng';
import { nearPole, type RoyaleLayout, randomAround } from '../layout';
import type { DuskCap } from '../types';

// The share of the bots that land in the Sanctuary, and how far around its
// heart; how far around a region's heart the others land. Spread wide: ten
// bots on the Sanctuary and eight around each heart made the second minute
// a bloodbath that emptied half of One life.
export const HOT_DROP_SHARE = 0.12;
export const HOT_DROP_M = 22;
export const REGION_DROP_M = 56;
// In a bout, how far short of the Thornyard's edge a bot's pick stands.
export const BOUT_DROP_EDGE_M = 4;

// The pick: on the planet (`within` null) by region; in a bout inside
// `within`, the Thornyard.
export function pickDropPoint(layout: RoyaleLayout, rng: Rng, within: DuskCap | null = null): Vec3 {
  if (within) return pickInside(layout, rng, within);
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

// A bout's pick: drawn uniformly over the cap short of its edge by
// BOUT_DROP_EDGE_M (the larger of two draws for the distance from its
// center), away from the poles when six draws allow it (two regions'
// hearts stand on them; the landing snaps a pick there off the spire),
// so none lands on the edge as the first closing comes.
function pickInside(layout: RoyaleLayout, rng: Rng, cap: DuskCap): Vec3 {
  const R = layout.radius;
  const reach = Math.max(0, cap.radius - BOUT_DROP_EDGE_M);
  let p = cap.center;
  for (let i = 0; i < 6; i++) {
    const s = reach * Math.max(rng.next(), rng.next());
    p = randomAround(rng, cap.center, s, R);
    if (!nearPole(p, R)) return p;
  }
  return p;
}
