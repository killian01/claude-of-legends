// The first steps' hide button (ui/hud.ts). A click with a mouse hides the
// guide at once. On a touchscreen the card stands where the ground is
// tapped, so the first tap only asks, and a second tap within HIDE_ARM_S
// hides it; a tap later than that asks again.

export const HIDE_ARM_S = 3;
export const STEPS_HIDE_SURE = 'Tap again to hide';

// When the button was last tapped to ask, in seconds, or null.
export type HideArm = number | null;

export interface HidePress {
  hide: boolean;
  armed: HideArm;
}

export function pressHide(armed: HideArm, now: number, touch: boolean): HidePress {
  if (!touch) return { hide: true, armed: null };
  if (armed !== null && now >= armed && now - armed < HIDE_ARM_S) {
    return { hide: true, armed: null };
  }
  return { hide: false, armed: now };
}
