// Shield detonations (kits-v2): a shield declared with a burst payload
// fires it around its holder the moment the shield is drained by damage
// (onBreak) or expires with value left (onExpire), then leaves the status
// list. Runs each tick BEFORE generic status expiry so an expiring burst is
// never silently pruned.

import { hypot } from '../exact';
import type { CombatCtx } from '../sim_context';
import { isSpellTarget } from '../spell_targets';
import { hostile } from '../unit';
import { applyEffects } from './effects';

export function stepShieldBursts(ctx: CombatCtx): void {
  for (const u of ctx.units.values()) {
    if (u.statuses.length === 0) continue;
    let fired = false;
    for (const s of u.statuses) {
      if (s.kind !== 'shield' || !s.burst) continue;
      const broken = s.remaining <= 0;
      const expired = s.until <= ctx.time;
      if (!broken && !expired) continue;
      const effects = broken ? s.burst.onBreak : s.burst.onExpire;
      if (effects.length > 0 && !u.dead && !ctx.dead.has(u.id)) {
        for (const other of ctx.units.values()) {
          if (!hostile(u, other) || other.dead || ctx.dead.has(other.id)) continue;
          if (!isSpellTarget(other)) continue;
          const d = hypot(other.pos.x - u.pos.x, other.pos.z - u.pos.z);
          if (d > s.burst.radius + other.radius) continue;
          applyEffects(ctx, s.burst.sourceId, s.burst.power, other, effects, 'ability', {
            center: u.pos,
          });
        }
      }
      s.burst = undefined;
      fired = true;
    }
    if (fired) {
      u.statuses = u.statuses.filter(
        (s) => s.kind !== 'shield' || (s.remaining > 0 && s.until > ctx.time),
      );
    }
  }
}
