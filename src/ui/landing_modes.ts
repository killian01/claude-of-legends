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
  // What you would do there, in a verb and as few words as fit under a
  // name on a painting a third of a band wide. The line above says what
  // the mode IS, at a length only the home's tile has room for; this is
  // what the landing draws, because a visitor deciding whether to sign up
  // wants the verb and not the definition.
  call: string;
  // Painted behind it: the same file the tile wears.
  art: string;
}

// The painting the other way in wears. The practice match is not one of
// the three above, because nobody signs up for it: it is the door that
// needs no account. It gets its tile's painting all the same, so the two
// cards on the landing are an offer and an offer, rather than an offer and
// a footnote under it.
export const PRACTICE_ART = tileArtUrl('practice');
// Its button. It used to say "Play offline", which reads as a lesser game
// to someone who came to play; what it offers is a match right here, with
// nothing to install and no account: the public queue as a Guest (ADR
// 0024), people when they are on and bots in every empty seat.
export const PLAY_NOW_CALL = 'Play in the browser now';
export const PLAY_NOW_LINE =
  'A real 5v5 online: players when they are on, bots in every empty seat.';

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

// The way in that needs nothing: what its button says, and what the
// landing resolves with when it is pressed (ui/landing.ts). The Play now
// card's button is built from it, so what the button says and what it
// does cannot come apart. The offline practice link that stood under it
// left the landing (ADR 0027): visitors play online now, and the page
// falls back to practice by itself when no Guest can be opened.
export interface LandingDoor {
  call: string;
  kind: 'guest';
}
export const PLAY_NOW: LandingDoor = { call: PLAY_NOW_CALL, kind: 'guest' };

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
