// Where the battle royale's HUD puts what comes and goes while the
// champion fights, on a desktop (ui/royale_hud.ts and ui/hud.ts draw it):
// the notices' lane left of the bar (the loot as it lands, "Completed:",
// the level) and the first steps' card at the top left. At 960x540 both
// stood in the middle, on the champion and its first fight. Pure numbers
// and the boxes they make on a screen at interface size 1, so a test keeps
// each off the champion, the bar and the hints at every size played.

export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// The bottom bar's half width (the level, the bars, Q W E R D F and the
// loot row under them), and the hints' height at the bottom left over
// their 12 px margin.
export const BAR_HALF_PX = 153;
export const HINTS_TOP_PX = 12 + 64;

// The notices' lane: its right edge this far left of the screen's middle,
// its foot this high, up to NOTES_MAX notices of up to NOTE_H_PX each (a
// long line wraps to two).
export const NOTES_FROM_MIDDLE_PX = 172;
export const NOTES_BOTTOM_PX = 92;
export const NOTES_MAX = 4;
export const NOTE_H_PX = 46;
export const SIDE_MARGIN_PX = 12;

// The first steps' card: its corner, and its width at most STEPS_MAX_W_PX
// and never closer to the middle than STEPS_CLEAR_MIDDLE_PX (the Dusk
// line and the count stand there).
export const STEPS_LEFT_PX = 12;
export const STEPS_TOP_PX = 64;
export const STEPS_MAX_W_PX = 300;
export const STEPS_CLEAR_MIDDLE_PX = 200;
// The card's tallest: the label, three lines and the Hide guide button.
export const STEPS_H_PX = 130;

// The champion on the screen: the camera looks at it, so it stands in the
// middle, its head and its nameplate above.
export function championBox(width: number, height: number): ScreenBox {
  return {
    left: width / 2 - 60,
    top: height / 2 - 90,
    right: width / 2 + 60,
    bottom: height / 2 + 30,
  };
}

export function notesLane(width: number, height: number): ScreenBox {
  const bottom = height - NOTES_BOTTOM_PX;
  return {
    left: SIDE_MARGIN_PX,
    top: bottom - NOTES_MAX * NOTE_H_PX,
    right: width / 2 - NOTES_FROM_MIDDLE_PX,
    bottom,
  };
}

export function stepsWidth(width: number): number {
  return Math.min(STEPS_MAX_W_PX, width / 2 - STEPS_CLEAR_MIDDLE_PX);
}

export function stepsBox(width: number): ScreenBox {
  return {
    left: STEPS_LEFT_PX,
    top: STEPS_TOP_PX,
    right: STEPS_LEFT_PX + stepsWidth(width),
    bottom: STEPS_TOP_PX + STEPS_H_PX,
  };
}

export function overlaps(a: ScreenBox, b: ScreenBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
