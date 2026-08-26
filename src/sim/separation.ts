// Soft unit collision among minions: overlapping minions push each other
// apart a little each tick, so waves read as formations instead of a single
// stacked blob (review F.0). Deterministic pair order; pushes never land on
// blocked ground.

import type { NavGrid } from './navgrid';
import type { CombatCtx } from './sim_context';
import type { Unit } from './unit';

export function stepSeparation(ctx: CombatCtx, nav: NavGrid): void {
  const minions: Unit[] = [];
  for (const u of ctx.units.values()) {
    if (u.kind === 'minion' && !u.dead && !ctx.dead.has(u.id)) minions.push(u);
  }
  for (let i = 0; i < minions.length; i++) {
    const a = minions[i]!;
    for (let j = i + 1; j < minions.length; j++) {
      const b = minions[j]!;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const dist = Math.hypot(dx, dz);
      const minDist = a.radius + b.radius;
      if (dist >= minDist || dist < 1e-6) continue;
      const push = Math.min(0.12, (minDist - dist) / 2);
      const nx = dx / dist;
      const nz = dz / dist;
      const ax = a.pos.x - nx * push;
      const az = a.pos.z - nz * push;
      const bx = b.pos.x + nx * push;
      const bz = b.pos.z + nz * push;
      if (nav.isWalkableAt(ax, az)) {
        a.pos.x = ax;
        a.pos.z = az;
      }
      if (nav.isWalkableAt(bx, bz)) {
        b.pos.x = bx;
        b.pos.z = bz;
      }
    }
  }
}
