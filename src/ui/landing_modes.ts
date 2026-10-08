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

import type { RoyaleVariant } from '../sim/royale/types';
import { type TileId, tileArtUrl } from './home_tiles';
import {
  CLASSIC_LINE,
  CLASSIC_TITLE,
  ONE_LIFE_LINE,
  RESPAWN_LINE,
  ROYALE_LABEL,
  royaleMode,
} from './royale_modes';

export interface LandingMode {
  // The play tile this stands for, which is what pins the two rows together.
  id: TileId;
  title: string;
  line: string;
  // What you would do there, in a verb and as few words as fit under a
  // name on a painting a third of a band wide. The line above says what
  // the mode IS, at a length only the home's tile has room for; this is
  // what the landing draws, because a visitor deciding whether to sign up
  // wants the verb and not the definition.
  call: string;
  // Painted behind it: the same file the tile wears.
  art: string;
}

// The painting the 5v5 wears among the ways in: the ranked tile's, a match
// against people. It was the whole Play now card's until the card became
// the battle royale's door (ADR 0031), and before that the practice
// match's, whose straw dummies were the wrong picture of a public match
// (the maintainer, 2026-10-02).
export const CLASSIC_ART = tileArtUrl('ranked');
// Its button. It used to say "Play offline", which reads as a lesser game
// to someone who came to play; what it offers is a match right here, with
// nothing to install and no account: the public queue as a Guest (ADR
// 0024), people when they are on and bots in every empty seat.
export const PLAY_NOW_CALL = 'Play in the browser now';

// The line under the hero's tagline, the first thing read after what the
// game is: a game with a ladder, from the first match, with no account.
// The tagline above it is the link preview's sentence too
// (tests/social_card.test.ts), so the news goes under it. The one place
// the page says it: the Play now card and the ladder used to say it again,
// in their own words, until the page read as one promise three times (the
// maintainer, 2026-10-02).
export const HERO_RANKED_LINE =
  'Ranked from your first match: every match scores on the ladder. No account needed.';

// What the account card says an account adds: the points on every device,
// and the three modes painted beside the form.
export const ACCOUNT_LINE =
  'It keeps your points on every device, and opens ranked, bots and the Forge.';

// What a way in plays as a Guest (ADR 0024): the battle royale on one of its
// two rule sets (ADR 0031), or the 5v5 on the Star Orchard.
export type LandingPlay = { to: 'royale'; variant: RoyaleVariant } | { to: 'classic' };

// The way in that needs nothing: what its button says, and what the
// landing resolves with when it is pressed (ui/landing.ts). The Play now
// card's button is built from it, so what the button says and what it
// does cannot come apart. It plays Respawn (ADR 0031: Play now launches
// Respawn); One life and the 5v5 are the card's other two ways in. The
// offline practice link that stood under it left the landing (ADR 0027):
// visitors play online now, and the page falls back to practice by itself
// when no Guest can be opened.
export interface LandingDoor {
  call: string;
  kind: 'guest';
  play: LandingPlay;
}
export const PLAY_NOW: LandingDoor = {
  call: PLAY_NOW_CALL,
  kind: 'guest',
  play: { to: 'royale', variant: 'respawn' },
};

// The Play now card's ways in, one row each, in the order they stand: the
// two rule sets of the battle royale, Respawn first since the gold button
// over them plays it, and the 5v5. Each row is a door of its own.
export interface LandingWay {
  id: RoyaleVariant | 'classic';
  // The small word over the name: what kind of match it is.
  kicker: string;
  title: string;
  line: string;
  door: LandingDoor;
}

// The small heading over the rows.
export const WAYS_LABEL = 'Three ways to play';

// The battle royale's arrival, said at the top of the Play now card
// (ADR 0031): the word New, the planet's name, and what one does there,
// over the gold button that plays it. A banner, not a second card: a
// second card pushed the button under the first screen of a phone held
// sideways. The line says what the button gives: Respawn always has a
// match to drop into (server/royale_service.ts), and a drop-in is set down
// a few steps from a fair first fight rather than where it likes (ADR 0031,
// amended 2026-10-08: 16 of 18 visitors dropped in).
export const NEW_TAG = 'New';
export const NEW_TITLE = 'The Wanderseed';
export const NEW_LINE =
  'Fifty champions on a small planet you can walk all the way round. Drop into a match under ' +
  'way, a fair fight a few steps off; loot, and stay in the light.';

export const LANDING_WAYS: readonly LandingWay[] = [
  {
    id: 'respawn',
    kicker: ROYALE_LABEL,
    title: royaleMode('respawn').title,
    line: RESPAWN_LINE,
    door: PLAY_NOW,
  },
  {
    id: 'one_life',
    kicker: ROYALE_LABEL,
    title: royaleMode('one_life').title,
    line: ONE_LIFE_LINE,
    door: {
      call: royaleMode('one_life').call,
      kind: 'guest',
      play: { to: 'royale', variant: 'one_life' },
    },
  },
  {
    id: 'classic',
    kicker: 'Star Orchard',
    title: CLASSIC_TITLE,
    line: CLASSIC_LINE,
    door: { call: 'Play the 5v5', kind: 'guest', play: { to: 'classic' } },
  },
];

export const LANDING_MODES: readonly LandingMode[] = [
  {
    id: 'ranked',
    call: 'Play in ranked',
    title: 'Ranked',
    line: 'The public queue, with a rating, a match history and a place on the rating ladder.',
    art: tileArtUrl('ranked'),
  },
  {
    id: 'bots',
    call: 'Create your bot',
    title: 'Bots',
    line: "Write a bot's playbook in the Academy, spar it in seconds, then send it up the ladder.",
    art: tileArtUrl('bots'),
  },
  {
    id: 'forge',
    call: 'Forge your champion',
    title: 'Forge',
    line: 'Build a champion from scratch, kit and all, then take it into the Forge queue.',
    art: tileArtUrl('forge'),
  },
];
