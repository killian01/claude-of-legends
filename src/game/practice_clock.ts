// The practice match's clock (CONTEXT.md: Practice). The match runs in
// the tab, one player against house bots, so nothing is lost by holding
// it still while that player cannot play: the phone still upright behind
// the line asking for a turn, the pause menu open, or the shop that opens
// by itself at the start of the match still up. A phone visitor used to
// lose the first seconds of the match to all three, and on an iPhone the
// wall could last until the tab was closed. A match against the server
// never holds; its clock is the server's (src/main.ts only asks this of
// the practice loop).
//
// Held, the sim does not step at all; let go, it picks up from the next
// frame, with no burst of ticks to catch up the time it stood still.

// What stands over the match right now (the HUD knows, ui/hud.ts).
export interface MatchCover {
  // The line asking a phone held upright to be turned.
  turnWall: boolean;
  pauseMenu: boolean;
  // The shop opened for the player at the start of the match, until it is
  // first closed; the shop opened again later does not hold the match.
  openingShop: boolean;
}

export function practiceHeld(cover: MatchCover): boolean {
  return cover.turnWall || cover.pauseMenu || cover.openingShop;
}

// The frame loop's accumulator: the time of the last frame and the time
// owed to the sim, in milliseconds.
export interface PracticeClock {
  last: number;
  acc: number;
}

// A frame never counts for more than this: a tab that was in the
// background comes back to the match where it left it, not to a second
// of ticks run in one go.
export const MAX_FRAME_MS = 250;

// One animation frame: how many ticks to step now, and the clock after.
// The first frame's timestamp can predate the clock (the presentation's
// own setup ran in between), so a frame never counts for less than
// nothing.
export function advancePracticeClock(
  clock: PracticeClock,
  now: number,
  held: boolean,
  tickMs: number,
): { clock: PracticeClock; ticks: number } {
  if (held) return { clock: { last: now, acc: clock.acc }, ticks: 0 };
  let acc = clock.acc + Math.max(0, Math.min(now - clock.last, MAX_FRAME_MS));
  let ticks = 0;
  while (acc >= tickMs) {
    acc -= tickMs;
    ticks += 1;
  }
  return { clock: { last: now, acc }, ticks };
}
