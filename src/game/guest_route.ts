// What a Guest's way in from the landing leads to (ui/landing_modes.ts
// LandingPlay; ADR 0024): the battle royale's loop on its rule set (ADR
// 0031), a Thornfray's (ADR 0035), or the 5v5's public queue. Pure, so a
// test walks every door; src/main.ts (playAsGuest) runs the loop it names.
// The switch is exhaustive: a new kind of way in that is not routed here is
// a compile error, never a fall through to the 5v5's queue.

import type { RoyaleVariant } from '../sim/royale/types';
import type { LandingPlay } from '../ui/landing_modes';

export type GuestLoop =
  | { loop: 'royale'; variant: RoyaleVariant; solo: boolean }
  | { loop: 'thornfray' }
  | { loop: 'queue' };

export function guestLoop(play: LandingPlay): GuestLoop {
  switch (play.to) {
    case 'royale':
      return { loop: 'royale', variant: play.variant, solo: play.solo === true };
    case 'thornfray':
      return { loop: 'thornfray' };
    case 'classic':
      return { loop: 'queue' };
    default:
      return unrouted(play);
  }
}

function unrouted(play: never): never {
  throw new Error(`a way in with no loop: ${JSON.stringify(play)}`);
}
