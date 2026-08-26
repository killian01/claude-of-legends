// Walks a unit along its path at its move speed, consuming several waypoints
// in one tick when they are close together. Pure function of the unit and dt.

import type { Unit } from './unit';

export function stepMovement(u: Unit, dt: number): void {
  let budget = u.moveSpeed * dt;
  while (budget > 1e-9 && u.path.length > 0) {
    const wp = u.path[0]!;
    const dx = wp.x - u.pos.x;
    const dz = wp.z - u.pos.z;
    const d = Math.hypot(dx, dz);
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
