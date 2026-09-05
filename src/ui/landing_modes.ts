// What the landing says about the two modes waiting behind the door.
//
// The front door offers the two ways in, ranked and the offline practice
// match, because that is the choice a visitor has to make. It said nothing
// at all about the two modes that are the reason to want an account: the
// Academy, where a bot is written, and the Forge, where a champion is. Both
// are modes you have to be shown, so a name in a nav bar does not carry
// them and the landing has to say what they are.
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
