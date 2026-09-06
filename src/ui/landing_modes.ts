// What an account opens, as the landing shows it: the same three modes
// the home stands at full height, in the same order and wearing the same
// paintings, so the page behind the door looks like the page in front of
// it. Ranked is here because a visitor knows what it is; Bots and the
// Forge are here because they do not exist offline at all, and a mode you
// have to be shown is a mode worth the space.
//
// Pure data, no DOM, so a test reads the row without a browser;
// ui/landing.ts draws it. The lines are the landing's own and shorter than
// the play tiles' (ui/home_tiles.ts): out here a mode is being named, not
// chosen. The painting is the tile's, so a mode looks the same on both
// sides of the door.

import { type TileId, tileArtUrl } from './home_tiles';

export interface LandingMode {
  // The play tile this stands for, which is what pins the two rows together.
  id: TileId;
  title: string;
  line: string;
  // Painted behind it: the same file the tile wears.
  art: string;
}

export const LANDING_MODES: readonly LandingMode[] = [
  {
    id: 'ranked',
    title: 'Ranked',
    line: 'The public queue, with a rating, a match history and a place on the ladder.',
    art: tileArtUrl('ranked'),
  },
  {
    id: 'bots',
    title: 'Bots',
    line: "Write a bot's playbook in the Academy, spar it in seconds, then send it up the ladder.",
    art: tileArtUrl('bots'),
  },
  {
    id: 'forge',
    title: 'Forge',
    line: 'Build a champion from scratch, kit and all, then take it into the Forge queue.',
    art: tileArtUrl('forge'),
  },
];
