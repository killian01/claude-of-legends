// Walks a unit along its path at the given speed, consuming several waypoints
// in one tick when they are close together. Pure function of the unit, dt,
// and the effective speed (statuses are resolved by the caller). Only the
// position and the path are read, so the online client's prediction walks
// its own champion with this very step (src/net/self_predict.ts).

import { hypot } from './exact';
import type { Vec2 } from './types';

export function stepMovement(u: { pos: Vec2; path: Vec2[] }, dt: number, speed: number): void {
  let budget = speed * dt;
  while (budget > 1e-9 && u.path.length > 0) {
    const wp = u.path[0]!;
    const dx = wp.x - u.pos.x;
    const dz = wp.z - u.pos.z;
    const d = hypot(dx, dz);
    if (d <= budget) {
      u.pos.x = wp.x;
      u.pos.z = wp.z;
      u.path.shift();
      budget -= d;
    } else {
      u.pos.x += (dx / d) * budget;
      u.pos.z += (dz / d) * budget;
      budget = 0;
    }
  }
}
