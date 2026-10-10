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

// With the thumbs the hint sits just under the kill feed's first line, past
// the touch bar's column (ui/hud.ts .hud.thumbs .hud-hints), and a feed of
// two lines or more ran over it. While the hint is up the feed reads under
// it instead: the HUD leaves where that is as --hints-feed-top, a few pixels
// below the hint's bottom edge, and drops it once the hint has faded. The
// tap scheme's hint is at the bottom and a mouse keeps the feed's corner.
export const HINTS_FEED_GAP_PX = 6;

export function feedTopUnderHints(
  thumbs: boolean,
  faded: boolean,
  hintsBottom: number,
): number | null {
  return thumbs && !faded ? Math.ceil(hintsBottom) + HINTS_FEED_GAP_PX : null;
}
