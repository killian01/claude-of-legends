// The first steps' hide button (ui/hud.ts). A click with a mouse hides the
// guide at once. On a touchscreen the card stands where the ground is
// tapped, so the first tap only asks, and a second tap within HIDE_ARM_S
// hides it; a tap later than that asks again. A tap that lands within
// GROUND_QUIET_S of a tap on the ground is a thumb walking the champion,
// not a choice, so the button does not hear it at all.

export const HIDE_ARM_S = 3;
export const GROUND_QUIET_S = 1;
export const STEPS_HIDE_SURE = 'Tap again to hide';

// When the button was last tapped to ask, in seconds, or null.
export type HideArm = number | null;

export interface HidePress {
  // False when the tap came in the middle of tapping the ground.
  heard: boolean;
  hide: boolean;
  armed: HideArm;
}

// lastGround: when the ground was last tapped, in seconds, or null.
export function pressHide(
  armed: HideArm,
  now: number,
  touch: boolean,
  lastGround: number | null = null,
): HidePress {
  if (!touch) return { heard: true, hide: true, armed: null };
  if (lastGround !== null && now >= lastGround && now - lastGround < GROUND_QUIET_S) {
    return { heard: false, hide: false, armed };
  }
  if (armed !== null && now >= armed && now - armed < HIDE_ARM_S) {
    return { heard: true, hide: true, armed: null };
  }
  return { heard: true, hide: false, armed: now };
}
