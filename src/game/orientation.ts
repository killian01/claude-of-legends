// The phone turns itself for a match (CONTEXT.md: Thumb stick). The game
// is laid out for a screen wider than it is tall, and a visitor who
// arrives on a phone holding it upright used to meet a line telling them
// to turn it: the two people who tried the game on phones one evening
// both stopped there. So the match asks the browser for landscape
// instead, and only the browsers that refuse still get the line.
//
// The lock is granted to a fullscreen document, which is why the match's
// entry points take the screen in the same click (game/fullscreen.ts).
// Safari on iOS has no orientation lock at all and always refuses; the
// wall is what it falls back to.

// The narrow slice of the Screen Orientation API this needs, typed here
// because lock() is absent from the DOM library's ScreenOrientation.
interface LockableOrientation {
  type?: string;
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
}

function orientationOf(win: Window): LockableOrientation | undefined {
  return (win.screen as unknown as { orientation?: LockableOrientation } | undefined)?.orientation;
}

// True once the screen is held in landscape by the browser itself. False
// when there is no lock to be had (iOS, a desktop, an older browser) or
// when it was refused; the caller then leaves the wall in place.
export async function lockLandscape(win: Window = window): Promise<boolean> {
  const orientation = orientationOf(win);
  if (typeof orientation?.lock !== 'function') return false;
  try {
    await orientation.lock('landscape');
    return true;
  } catch {
    // Refused: not fullscreen, a browser that does not lock, or a screen
    // the user has locked from the system.
    return false;
  }
}

// Gives the screen back at the end of a match, so the rest of the site
// turns with the phone like any page.
export function unlockOrientation(win: Window = window): void {
  try {
    orientationOf(win)?.unlock?.();
  } catch {
    // Nothing held it.
  }
}

// Whether the match still has to ask for the phone to be turned: only on
// a touchscreen, only while the browser has not taken the screen itself.
export function needsTurnPrompt(coarsePointer: boolean, landscapeLocked: boolean): boolean {
  return coarsePointer && !landscapeLocked;
}
