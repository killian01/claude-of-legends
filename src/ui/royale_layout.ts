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

// The kill feed at the top right (ui/royale_hud.ts): under the K/D/A box,
// a line at most FEED_MAX_W_PX wide (a long name is cut short), up to four
// lines and the "+N elsewhere" fold.
export const FEED_TOP_PX = 62;
export const FEED_RIGHT_PX = 12;
export const FEED_MAX_W_PX = 280;
// A name in the feed at most this wide, so a line with two names and
// their bot marks keeps inside FEED_MAX_W_PX.
export const FEED_NAME_MAX_W_PX = 86;
export const FEED_LINE_H_PX = 27;
export const FEED_LINES = 5;

export function feedBox(width: number): ScreenBox {
  return {
    left: width - FEED_RIGHT_PX - FEED_MAX_W_PX,
    top: FEED_TOP_PX,
    right: width - FEED_RIGHT_PX,
    bottom: FEED_TOP_PX + FEED_LINES * FEED_LINE_H_PX,
  };
}

// The announcement (ui/hud.ts announce: "You took down Rushlantern", "Two
// Seedfalls have landed"): centered under the top line, and never wider
// than the room between the first steps' card and the feed, with
// ANNOUNCE_GAP_PX either side, so a long one wraps rather than runs under
// the feed (at 960x540 with four lines up, "Rushlantern" read
// "Rushlanterr"). Two lines at most.
export const ANNOUNCE_TOP_PX = 112;
export const ANNOUNCE_GAP_PX = 12;
export const ANNOUNCE_LINE_PX = 32;
export const ANNOUNCE_LINES = 2;

// How far in from each side the widest of the two reaches.
export function announceReach(width: number): number {
  return Math.max(FEED_RIGHT_PX + FEED_MAX_W_PX, STEPS_LEFT_PX + stepsWidth(width));
}

export function announceWidth(width: number): number {
  return width - 2 * (announceReach(width) + ANNOUNCE_GAP_PX);
}

export function announceBox(width: number): ScreenBox {
  const half = announceWidth(width) / 2;
  return {
    left: width / 2 - half,
    top: ANNOUNCE_TOP_PX,
    right: width / 2 + half,
    bottom: ANNOUNCE_TOP_PX + ANNOUNCE_LINES * ANNOUNCE_LINE_PX,
  };
}

// The announcement's max-width as CSS: announceWidth with the card's
// width as the stylesheet computes it (ui/hud.ts).
export function announceMaxWidthCss(): string {
  const steps = `(${STEPS_LEFT_PX}px + min(${STEPS_MAX_W_PX}px, 50% - ${STEPS_CLEAR_MIDDLE_PX}px))`;
  const reach = `max(${FEED_RIGHT_PX + FEED_MAX_W_PX}px, ${steps})`;
  return `calc(100% - 2 * (${reach} + ${ANNOUNCE_GAP_PX}px))`;
}

// The wash over a dead champion (ui/hud.ts .hud-overlay, SLAIN or OUT)
// stands over the field, and the announcement over the wash: SLAIN dimmed
// "Two Seedfalls have landed" under it. The modal screens (the pause
// menu, the end card) stand over both.
export const WASH_Z = 10;
export const ANNOUNCE_Z = 11;
export const MODAL_Z = 41;

// The wash's title and line, centered on the screen.
export function slainBox(width: number, height: number): ScreenBox {
  return {
    left: width / 2 - 260,
    top: height / 2 - 40,
    right: width / 2 + 260,
    bottom: height / 2 + 40,
  };
}

// The spotlight (ui/royale_hud_moments.ts: ABLAZE, WILDFIRE) fades in and
// out over SPOT_FADE_MS. On a phone it stands in the first steps' band, so
// the card is gone from its first frame until its fade out is over: from
// the call for `holdMs` and SPOT_FADE_MS more.
export const SPOT_FADE_MS = 220;

export function spotCoverMs(holdMs: number): number {
  return Math.max(0, holdMs) + SPOT_FADE_MS;
}

// A phone's notices (ui/royale_hud_moments.ts): a loot line wraps in a
// column COMPACT_NOTE_MAX_W_PX wide, but a finished item's line ("Completed:
// Doombrand · Deathmark", the names only on a phone) and "Build complete"
// hold one line, up to COMPACT_DONE_MAX_W_PX wide (border included); the
// chrome is the icon, its gap, the padding and the border.
export const COMPACT_NOTE_MAX_W_PX = 300;
export const COMPACT_DONE_MAX_W_PX = 360;
export const COMPACT_NOTE_FONT_PX = 12.5;
export const COMPACT_NOTE_CHROME_PX = 22 + 8 + 14 + 2;
// A bold system face's widest average letter, in ems.
export const BOLD_EM_PER_CHAR = 0.64;

export function compactNoteWidth(text: string): number {
  return text.length * COMPACT_NOTE_FONT_PX * BOLD_EM_PER_CHAR + COMPACT_NOTE_CHROME_PX;
}

// The top line (ui/royale_hud.ts .br-top) at its fullest, a test's
// worst case: the Dusk's line and the count, the mark's badge and the
// Dusk's pill under them; on a phone the line and the count share a row.
export const TOP_LINE_TOP_PX = 8;
export const TOP_LINE_HALF_W_PX = 170;
export const TOP_LINE_H_PX = 104;
export const COMPACT_TOP_LINE_HALF_W_PX = 190;
export const COMPACT_TOP_LINE_H_PX = 78;

export function topLineBox(width: number, compact: boolean): ScreenBox {
  const half = compact ? COMPACT_TOP_LINE_HALF_W_PX : TOP_LINE_HALF_W_PX;
  return {
    left: width / 2 - half,
    top: TOP_LINE_TOP_PX,
    right: width / 2 + half,
    bottom: TOP_LINE_TOP_PX + (compact ? COMPACT_TOP_LINE_H_PX : TOP_LINE_H_PX),
  };
}

// The spotlight (ui/royale_hud_moments.ts .br-spot, ABLAZE, WILDFIRE) at
// its biggest: 30 percent down a desktop, under the announcement on a
// phone.
export const SPOT_TOP_SHARE = 0.3;
export const SPOT_HALF_W_PX = 330;
export const SPOT_H_PX = 84;
export const COMPACT_SPOT_TOP_PX = 98;
export const COMPACT_SPOT_HALF_W_PX = 190;
export const COMPACT_SPOT_H_PX = 46;

export function spotBox(width: number, height: number, compact: boolean): ScreenBox {
  const top = compact ? COMPACT_SPOT_TOP_PX : height * SPOT_TOP_SHARE;
  const half = compact ? COMPACT_SPOT_HALF_W_PX : SPOT_HALF_W_PX;
  return {
    left: width / 2 - half,
    top,
    right: width / 2 + half,
    bottom: top + (compact ? COMPACT_SPOT_H_PX : SPOT_H_PX),
  };
}

// A phone's notices' column (ui/royale_hud_moments.ts .br-notes): centered
// over the bar, or with the thumb controls left of the middle between the
// stick and the ability buttons, its foot this high; two notices show, a
// loot line wrapped to two lines at most, a finished item's on one line
// up to COMPACT_DONE_MAX_W_PX wide.
export const COMPACT_NOTES_BOTTOM_PX = 112;
export const THUMBS_NOTES_BOTTOM_PX = 82;
export const THUMBS_NOTES_LEFT_PCT = 44;
export const COMPACT_NOTES_SHOWN = 2;
export const COMPACT_NOTE_H_PX = 40;
export const COMPACT_NOTES_GAP_PX = 6;

export function compactNotesBox(width: number, height: number, thumbs: boolean): ScreenBox {
  const mid = thumbs ? (width * THUMBS_NOTES_LEFT_PCT) / 100 : width / 2;
  const bottom = height - (thumbs ? THUMBS_NOTES_BOTTOM_PX : COMPACT_NOTES_BOTTOM_PX);
  const tall =
    COMPACT_NOTES_SHOWN * COMPACT_NOTE_H_PX + (COMPACT_NOTES_SHOWN - 1) * COMPACT_NOTES_GAP_PX;
  return {
    left: mid - COMPACT_DONE_MAX_W_PX / 2,
    top: bottom - tall,
    right: mid + COMPACT_DONE_MAX_W_PX / 2,
    bottom,
  };
}
