// The ask to turn the phone. The match is laid out for a screen wider than
// it is tall: a phone held upright has to be turned either way, whether the
// browser turns the page with it or the match comes up already turned for a
// phone that stays upright (game/rotated_view.ts), so the turn used to
// happen on the match's time. The loading card before it (src/main.ts)
// asks already, on a touchscreen held upright, and the phone turns during
// the wait; the ask goes as soon as it is sideways. The wall says the same
// words. The rotation-lock line matters only to a player who turned the
// rotated view off: then the wall is all an iPhone with the lock on gets.

import { turnWallUp } from '../game/rotated_view';
import { getSettings } from '../game/settings';

export const TURN_ASK = 'Turn your phone sideways';
export const TURN_LOCK_LINE = 'On iPhone, turn off Portrait Orientation Lock in Control Center.';

// Whether the loading card asks: exactly when the wall would stand if the
// match opened now with no rotated view to fall back on. Nothing has asked
// the browser for landscape yet (the match does, once it opens:
// game/boot.ts), so no lock is held.
export function loadingAsksTurn(coarsePointer: boolean, portrait: boolean): boolean {
  return turnWallUp(coarsePointer, 'refused', false, portrait);
}

// Whether the card adds the iPhone rotation-lock line: only when the
// rotated view is off, since with it on the match turns for a locked phone.
export function loadingTellsLock(rotatedView: boolean): boolean {
  return !rotatedView;
}

const CSS = `
.menu-turn {
  margin-top: 4px; padding: 10px 12px; border-radius: 8px; text-align: center;
  border: 1px solid #8a7430; background: rgba(30, 26, 12, 0.6);
}
.menu-turn[hidden] { display: none; }
.menu-turn b { display: block; font-size: 16px; color: #ffd94a; letter-spacing: 0.3px; }
.menu-turn span { display: block; margin-top: 4px; font-size: 12px; line-height: 1.4; color: #c9bd93; }
/* An author display rule beats the browser's own [hidden]: say it again. */
.menu-turn span[hidden] { display: none; }
`;

let styled = false;

// Puts the ask on a loading card and keeps it true while the phone turns.
// Returns the stop, for the card's own teardown.
export function attachTurnAsk(card: HTMLElement, win: Window = window): () => void {
  if (typeof win.matchMedia !== 'function') return () => undefined;
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    styled = true;
  }
  const coarse = win.matchMedia('(pointer: coarse)');
  const portrait = win.matchMedia('(orientation: portrait)');
  const box = document.createElement('div');
  box.className = 'menu-turn';
  const ask = document.createElement('b');
  ask.textContent = TURN_ASK;
  const lock = document.createElement('span');
  lock.textContent = TURN_LOCK_LINE;
  lock.hidden = !loadingTellsLock(getSettings().rotatedView);
  box.append(ask, lock);
  card.appendChild(box);
  const sync = (): void => {
    box.hidden = !loadingAsksTurn(coarse.matches, portrait.matches);
  };
  sync();
  portrait.addEventListener('change', sync);
  return () => {
    portrait.removeEventListener('change', sync);
    box.remove();
  };
}
