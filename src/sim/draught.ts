// The Sapdraught (CONTEXT.md): a consumable drunk from its bag slot gives
// its health back over a few seconds, a share every tick. Damage does not
// stop it and it leaves a recall alone; one runs at a time. Grievous wounds
// cut each share like any other heal.

import { healFactor } from './combat/status';
import { ITEMS } from './content/items';
import type { CombatCtx } from './sim_context';
import { DT } from './types';
import type { Unit } from './unit';

// The seconds of drinking left, 0 when no draught runs.
export function draughtLeft(u: Unit, time: number): number {
  for (const s of u.statuses) {
    if (s.kind === 'draught' && s.until > time && s.left > 0) return s.left / s.perSecond;
  }
  return 0;
}

// Drinks the consumable in `slot`: it leaves the bag and the heal begins.
// Refused when the slot holds no consumable or a draught still runs.
export function startDraught(u: Unit, slot: number, time: number): boolean {
  if (u.kind !== 'champion' || u.dead) return false;
  const itemId = u.items[slot];
  const drink = itemId === undefined ? undefined : ITEMS[itemId]?.drink;
  if (!drink) return false;
  if (draughtLeft(u, time) > 0) return false;
  u.items = u.items.filter((_, i) => i !== slot);
  // A tick of slack past the length, so expiry never cuts the last share.
  u.statuses.push({
    kind: 'draught',
    until: time + drink.seconds + DT,
    perSecond: drink.heal / drink.seconds,
    left: drink.heal,
  });
  return true;
}

export function stepDraughts(ctx: CombatCtx): void {
  for (const u of ctx.units.values()) {
    if (u.dead || ctx.dead.has(u.id) || u.statuses.length === 0) continue;
    for (const s of u.statuses) {
      if (s.kind !== 'draught' || s.until <= ctx.time || s.left <= 0) continue;
      const share = Math.min(s.left, s.perSecond * DT);
      s.left -= share;
      u.hp = Math.min(u.maxHp, u.hp + share * healFactor(u, ctx.time));
      // Done: rounding must not leave a sliver that blocks the next drink.
      if (s.left < 1e-6) {
        s.left = 0;
        s.until = ctx.time;
      }
    }
  }
}
