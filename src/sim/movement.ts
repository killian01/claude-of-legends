// Walks a unit along its path at the given speed, consuming several waypoints
// in one tick when they are close together. Pure function of the unit, dt,
// and the effective speed (statuses are resolved by the caller). Only the
// position and the path are read, so the online client's prediction walks
// its own champion with this very step (src/net/self_predict.ts). On the
// planet each leg is a great circle (geo.ts, ADR 0029).

import { assign, dist, stepToward } from './geo';
import type { Vec2 } from './types';

export function stepMovement(u: { pos: Vec2; path: Vec2[] }, dt: number, speed: number): void {
  let budget = speed * dt;
  while (budget > 1e-9 && u.path.length > 0) {
    const wp = u.path[0]!;
    const d = dist(u.pos, wp);
    if (d <= budget) {
      assign(u.pos, wp);
      u.path.shift();
      budget -= d;
    } else {
      stepToward(u.pos, wp, budget);
      budget = 0;
    }
  }
}
