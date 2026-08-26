// Ticks damage-over-time statuses through the one damage pipeline.

import type { CombatCtx } from '../sim_context';
import { DT } from '../types';
import { dealDamage } from './damage';

export function stepDots(ctx: CombatCtx): void {
  for (const u of ctx.units.values()) {
    if (u.dead || ctx.dead.has(u.id) || u.statuses.length === 0) continue;
    // Copy first: dealDamage can rewrite the status list (shield pruning).
    const dots = u.statuses.filter((s) => s.kind === 'dot' && s.until > ctx.time);
    for (const d of dots) {
      if (d.kind === 'dot') dealDamage(ctx, d.sourceId, u, d.perSecond * DT, d.dtype);
    }
  }
}
