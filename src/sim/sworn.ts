// Ostrand's Sworn (docs/design/ostrand.md, CONTEXT.md: Sworn): the one
// enemy champion he has named. The mark is a status on the Sworn, keyed by
// its source, so two Ostrands keep two oaths and every viewer reads the
// mark off the unit itself. His first hit on an enemy champion names it;
// a hit on the Sworn renews it; another champion is taken only once the
// mark lapses or its holder dies, or by a spell that swears outright.

import type { CombatCtx } from './sim_context';
import { hostile, type Unit } from './unit';

export const SWORN_S = 8;

function live(ctx: CombatCtx, u: Unit): boolean {
  return !u.dead && !ctx.dead.has(u.id);
}

// Whether `target` carries the Sworn mark of `sourceId` at `time`.
export function isSwornBy(target: Unit, sourceId: number, time: number): boolean {
  return target.statuses.some(
    (s) => s.kind === 'sworn' && s.sourceId === sourceId && s.until > time,
  );
}

// The living champion `self` has sworn, if any.
export function swornOf(ctx: CombatCtx, self: Unit): Unit | null {
  for (const u of ctx.units.values()) {
    if (u.kind === 'champion' && live(ctx, u) && isSwornBy(u, self.id, ctx.time)) return u;
  }
  return null;
}

// Names `target` as the Sworn of `self`. Without `overwrite` a living Sworn
// elsewhere keeps the oath and the call does nothing; with it (Gauntlet
// Throw, Oathfield) the old mark is struck and the new one taken. Returns
// whether `target` is the Sworn afterwards.
export function swear(ctx: CombatCtx, self: Unit, target: Unit, overwrite: boolean): boolean {
  if (target.kind !== 'champion' || !hostile(self, target) || !live(ctx, target)) return false;
  const held = swornOf(ctx, self);
  if (held && held.id !== target.id) {
    if (!overwrite) return false;
    held.statuses = held.statuses.filter((s) => !(s.kind === 'sworn' && s.sourceId === self.id));
  }
  const mark = target.statuses.find((s) => s.kind === 'sworn' && s.sourceId === self.id);
  if (mark) mark.until = ctx.time + SWORN_S;
  else target.statuses.push({ kind: 'sworn', until: ctx.time + SWORN_S, sourceId: self.id });
  return true;
}
