// The controls hint on a touchscreen (the few lines saying how the thumbs
// play, ui/hud.ts): it fades once it has been read, and it is only read
// while nothing covers it. It used to fade 12 s after the HUD appeared
// whatever stood over it, and on a phone the opening shop and the turn
// wall stood over it for most of those 12 s: closing the shop after 8 s
// left it barely seen. So its clock runs only while nothing covers the
// HUD (the shop, the pause menu, the end screen, the turn wall), in match
// seconds, the lane card's clock (ui/lane_guide.ts).

// Seconds of uncovered screen before the hint fades: the thumb controls'
// hint is short, the older tap-to-walk one is a paragraph. A mouse keeps
// its hint (null).
export const HINTS_HOLD_THUMBS = 12;
export const HINTS_HOLD_TAP = 25;

export function hintsHold(coarsePointer: boolean, thumbs: boolean): number | null {
  if (!coarsePointer) return null;
  return thumbs ? HINTS_HOLD_THUMBS : HINTS_HOLD_TAP;
}

export interface HintsClock {
  // Uncovered seconds counted so far.
  seen: number;
  // Match time of the last step with nothing over the hint; null while
  // something covers it (or before the first step), so a covered stretch
  // never counts.
  last: number | null;
  faded: boolean;
}

export const HINTS_START: HintsClock = { seen: 0, last: null, faded: false };

export function stepHints(
  state: HintsClock,
  time: number,
  covered: boolean,
  hold: number | null,
): HintsClock {
  if (hold === null || state.faded) return state;
  if (covered) return state.last === null ? state : { ...state, last: null };
  const seen = state.seen + (state.last === null ? 0 : Math.max(0, time - state.last));
  return { seen, last: time, faded: seen >= hold };
}
