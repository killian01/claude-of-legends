// A Thornfray's flow on the page (ADR 0035; docs/design/thornfray.md, The
// HUD and the phone), decided: what each bout's match_start does to the
// screen, and what comes after the end screen. Pure, so the loop in
// src/main.ts (runThornfray) is testable.
//
// One match layer across every bout: the first bout's start opens the
// match on its first snapshot, as the battle royale does; every later start
// (the next bout, a rebuilt Lull, a rejoin's) switches the screen's rule
// set to the bout's (Presentation.setBout) and keeps the match on screen,
// the renderer and its loaded planet included. A seat keeps its unit id
// from one bout to the next (src/net/replay.ts buildBoutSim seats the eight
// in seat order on a map no bout adds a unit to before them), so the
// screen follows the same champion; should a start ever name another, the
// screen is built again on it rather than following a unit that is not
// the person's.
//
// After the end screen: Play again enters a new gathering with the same
// pick, Battle royale opens the Respawn quick pick, and everything else
// leaves for the page it came from.

import type { RoyaleVariant } from '../sim/royale/types';
import type { PostMatchAction } from './flow';

export type BoutArrival = 'open' | 'switch' | 'rebuild';

// What a bout's start does: `shownSelf` is the unit id the match on screen
// follows (null before it opened), `selfUnitId` the start's.
export function boutArrival(shownSelf: number | null, selfUnitId: number): BoutArrival {
  if (shownSelf === null) return 'open';
  return shownSelf === selfUnitId ? 'switch' : 'rebuild';
}

export type ThornfrayNext =
  | { to: 'thornfray' }
  | { to: 'royale'; variant: RoyaleVariant }
  | { to: 'home' };

export function thornfrayNext(action: PostMatchAction): ThornfrayNext {
  if (action === 'again') return { to: 'thornfray' };
  if (action === 'other') return { to: 'royale', variant: 'respawn' };
  return { to: 'home' };
}
