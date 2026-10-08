// The Respawn wait's globe (CONTEXT.md: Respawn; src/sim/royale/
// return_pick.ts): a moment after the fall, the camera rises to the globe
// the drop is seen from, and a tap or a click on it picks where the
// champion comes back, inside the light it comes back to. What the stage
// (render/planet_stage.ts) and the death wash (ui/hud.ts) both decide off
// the world, pure: whether the globe shows, the light it faces, and the
// wash's line about it. The 5 s wait held nothing but a count: it now
// holds a choice.

import type { SnapDusk, SnapRoyale, WirePoint } from '../net/royale_wire';
import type { Vec3 } from '../sim/geo';
import { intoLight } from '../sim/royale/return_pick';
import { RESPAWN_S } from '../sim/royale/types';
import { burrTarget } from './royale_burr';
import { CHIP_BOTTOM_PX, CHIP_H_PX } from './royale_grafts';

// Seconds after the fall the globe rises: the body is seen to fall first.
export const RETURN_GLOBE_AFTER_S = 1;

// The followed champion as the globe reads it.
export interface ReturnSeat {
  dead: boolean;
  respawnAt: number;
}

// The mode's block as the globe reads it.
export interface ReturnView {
  v: 'respawn' | 'one_life';
  st: 'drop' | 'play' | 'over';
  // Respawn's Last light: a death is final, no return to pick.
  fi?: 1;
}

// Whether the globe shows over a dead champion now: in Respawn's play,
// RETURN_GLOBE_AFTER_S after the fall, until the champion stands again
// (a slow snapshot keeps it up past the return's time, never down early).
export function returnGlobeOn(r: ReturnView, u: ReturnSeat, time: number): boolean {
  if (r.v !== 'respawn' || r.st !== 'play' || r.fi === 1) return false;
  if (!u.dead || !Number.isFinite(u.respawnAt)) return false;
  return time >= u.respawnAt - RESPAWN_S + RETURN_GLOBE_AFTER_S;
}

// The light a return comes back in, as the wire tells the Dusk (src/sim/
// royale/score.ts returnCap): the cap it closes to while it closes, else
// the light now.
export function returnLight(d: SnapDusk): { c: WirePoint; r: number } {
  if (d.sh === 1 && d.nc && d.nr !== undefined) return { c: d.nc, r: d.nr };
  return { c: d.c, r: d.r };
}

// What the wait's globe marks (render/planet_marks.ts): the own pick of
// where to come back (the tap shown at once, else the one the server
// echoes), brought into the light the return comes back in as the sim
// brings it (return_pick.ts intoLight); where the champion fell; and while
// its Burr lasts, where the champion carrying it stands (the bu block's,
// what the owner's observation reads too, CONTEXT.md: Burr), so the pick
// can be made toward it or away from it.
export interface WaitMarks {
  pick: Vec3 | null;
  fell: Vec3 | null;
  burr: Vec3 | null;
}

export function waitMarks(
  r: Pick<SnapRoyale, 'st' | 'dusk' | 'bk' | 'bu'>,
  time: number,
  tapped: Vec3 | null,
  fell: Vec3 | null,
  radius: number,
): WaitMarks {
  const wire = r.bk ? { x: r.bk[0], y: r.bk[1], z: r.bk[2] } : null;
  const picked = tapped ?? wire;
  const light = returnLight(r.dusk);
  const cap = { center: { x: light.c[0], y: light.c[1], z: light.c[2] }, radius: light.r };
  return {
    pick: picked ? intoLight(picked, cap, radius) : null,
    fell,
    burr: burrTarget(r, time)?.at ?? null,
  };
}

// The wash while the globe shows (ui/hud.ts): its lines centered in the
// screen's width less RETURN_WASH_RIGHT_VW on the right, none wider than
// RETURN_WASH_LINE_VW, so they keep left of the globe the camera sets right
// of the middle (render/planet_drop.ts RETURN_GLOBE_RIGHT), whose left edge
// stands some 57 percent across a 1280x720 screen and 60 on a phone's.
export const RETURN_WASH_RIGHT_VW = 34;
export const RETURN_WASH_LINE_VW = 46;
// On a phone the lines stand on the folded Graft chip, which keeps
// CHIP_BOTTOM_PX over the bottom (ui/royale_grafts.ts): their last ends
// RETURN_WASH_CHIP_GAP_PX above it, whatever the screen's height.
export const RETURN_WASH_CHIP_GAP_PX = 6;
export const RETURN_WASH_PHONE_BOTTOM_PX = CHIP_BOTTOM_PX + CHIP_H_PX + RETURN_WASH_CHIP_GAP_PX;

// The wash's line under the recap while the globe shows: what to do with
// it, a phone's tap or a desktop's click, and once picked, that it holds.
export function returnHint(touch: boolean, picked: boolean): string {
  if (picked) return touch ? 'You come back where you tapped' : 'You come back where you clicked';
  return touch
    ? 'Tap the globe to choose where you come back'
    : 'Click the globe to choose where you come back';
}
