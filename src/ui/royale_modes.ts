// The battle royale as the front door and the home offer it (ADR 0031):
// its two rule sets, Respawn and One life, each with its name, its line and
// its call, and the 5v5 beside them under the name it keeps there. Pure
// data, no DOM, so a test reads the offer without a browser; ui/landing.ts
// and ui/home_screen.ts draw it.

import type { RoyaleVariant } from '../sim/royale/types';

export interface RoyaleMode {
  variant: RoyaleVariant;
  title: string;
  // What the rules are, in a line: said the same on the landing, the home
  // and the quick pick.
  line: string;
  // What its button says where it has one of its own.
  call: string;
}

// The kicker over the two: what they both are.
export const ROYALE_LABEL = 'Battle royale';

export const RESPAWN_LINE =
  'Fifty champions on a small planet. Come back five seconds after a death; the most ' +
  'takedowns when the last light goes out wins.';
export const ONE_LIFE_LINE = 'Fifty champions, one life each. The last one standing wins.';

// Respawn first: it is what Play now launches.
export const ROYALE_MODES: readonly RoyaleMode[] = [
  { variant: 'respawn', title: 'Respawn', line: RESPAWN_LINE, call: 'Play Respawn' },
  { variant: 'one_life', title: 'One life', line: ONE_LIFE_LINE, call: 'Play One life' },
];

export function royaleMode(variant: RoyaleVariant): RoyaleMode {
  return ROYALE_MODES.find((m) => m.variant === variant) ?? ROYALE_MODES[0]!;
}

// The other rule set: what the end screen offers to try next.
export function otherVariant(variant: RoyaleVariant): RoyaleVariant {
  return variant === 'respawn' ? 'one_life' : 'respawn';
}

// The 5v5 on the Star Orchard, as the landing names it now that Play now
// is the battle royale: the game it has always been, as one tile of three.
export const CLASSIC_TITLE = 'Classic 5v5';
export const CLASSIC_LINE =
  'Five against five on the Star Orchard: three lanes, towers, and the Sanctum to take.';
