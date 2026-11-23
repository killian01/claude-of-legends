// Trading places (CONTEXT.md: Trade places): two units stand, in one tick,
// each where the other stood. Ysmer's Changeling Spark trades her with the
// enemy champion it strikes, In My Stead with the champion nearest her
// aim, ally or enemy. A trade is a blink
// for both: walls, rings and cliffs are not crossed on foot, so none stops
// it, exactly as a blink clears an Oathfield's rim (docs/design/ysmer.md).
// Both spots were standing ground a moment before, on the plane and on the
// sphere alike, so no landing search runs and no rounding enters; a larger
// body set down where a smaller one stood is eased off a wall by the usual
// separation, as after any blink.

import { copy } from '../geo';
import type { CombatCtx } from '../sim_context';
import type { Unit } from '../unit';
import { cancelRecall, isUntargetable } from './status';

// Whether a unit can be moved by a trade: alive, mobile, never a structure,
// and never untargetable (a champion on a launch pad's flight, a strike in
// the air): the trade is refused rather than leaving one of the two on a
// flight's line while the other is put back on it.
function tradeable(ctx: CombatCtx, u: Unit): boolean {
  if (u.dead || ctx.dead.has(u.id) || u.hp <= 0) return false;
  if (u.kind === 'tower' || u.kind === 'sanctum') return false;
  if (isUntargetable(u, ctx.time)) return false;
  return u.moveSpeed > 0;
}

// Trades the two units' places. Any flight either was on ends where it
// stood (a trade is not a landing: no landing payload fires), both walks
// are dropped so neither keeps walking a path laid from the old spot, and
// a recall's channel is broken as any move breaks it: a held enemy does
// not go home from where it was brought. Returns false, moving nobody,
// when either cannot be moved.
export function tradePlaces(ctx: CombatCtx, a: Unit, b: Unit): boolean {
  if (a.id === b.id || !tradeable(ctx, a) || !tradeable(ctx, b)) return false;
  const was = copy(a.pos);
  a.pos = copy(b.pos);
  b.pos = was;
  a.path = [];
  b.path = [];
  a.activeDash = null;
  b.activeDash = null;
  cancelRecall(a);
  cancelRecall(b);
  return true;
}
