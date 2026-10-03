// What comes after a battle royale (ADR 0031), decided from the exit the
// end screen or the pause menu gave and the rule set the match ran on.
// Pure, so the loop in src/main.ts is testable: Play again goes straight
// into the next match of the same rule set with the same pick, Try One
// life or Try Respawn straight into the other with the same pick, and
// everything else leaves the loop for the page it came from (the landing's
// register tab for the account offer).

import type { RoyaleVariant } from '../sim/royale/types';
import type { PostMatchAction } from './flow';

export type RoyaleNext =
  | { to: 'match'; variant: RoyaleVariant }
  | { to: 'home' }
  | { to: 'register' };

export function royaleNext(action: PostMatchAction, variant: RoyaleVariant): RoyaleNext {
  if (action === 'again') return { to: 'match', variant };
  if (action === 'other') {
    return { to: 'match', variant: variant === 'respawn' ? 'one_life' : 'respawn' };
  }
  if (action === 'account') return { to: 'register' };
  return { to: 'home' };
}
