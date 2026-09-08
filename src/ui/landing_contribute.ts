// What the landing says about the thing this game has that the genre does
// not: the whole of it is open, and a stranger can change it.
//
// The bar carried one small word, "Source", which names a place and asks
// nothing. That undersells the point badly. A MOBA is normally a thing you
// are handed; this one is a thing you can add a champion to on a Sunday,
// and the front door has to say so somewhere a visitor will actually look.
//
// Three ways in, and they are ordered by how far a newcomer has to walk.
// Adding a champion is first because it is the one that sounds impossible
// and is not. Training a bot is second because it is the strangest thing
// here and the reason some people will stay. An open issue is last because
// it is the ordinary answer, and the one that needs no imagination.
//
// Each line says what the visitor would get to do, and nothing about how
// it is built: file counts, data formats and determinism belong to the
// guide behind the link, not to a front door read by someone deciding
// whether to click it.
//
// Pure data, no DOM, so a test reads the row without a browser;
// ui/landing.ts draws it. Every href goes to something that exists in the
// repository, which is what tests/landing_contribute.test.ts holds.

import { REPO } from './links';

export interface ContributeWay {
  title: string;
  line: string;
  // What the link says, in the imperative: each one is a thing to go do.
  cta: string;
  href: string;
}

export const CONTRIBUTE_WAYS: readonly ContributeWay[] = [
  {
    title: 'Add a champion',
    line:
      'Design a champion of your own, give it a kit, and see it in the roster. ' +
      'The guide takes you through it step by step.',
    cta: 'Read the guide',
    href: `${REPO}/blob/main/docs/adding-a-champion.md`,
  },
  {
    title: 'Train a bot',
    line:
      'Build a bot that plays the game, then send it up the ladder against ' +
      "everyone else's. How you make it smart is up to you.",
    cta: 'See how',
    href: `${REPO}/blob/main/headless/README.md`,
  },
  {
    title: 'Take an issue',
    line:
      'There is always something to fix or improve. The ones marked good first ' +
      'issue are meant for a first pull request.',
    cta: 'Browse the issues',
    href: `${REPO}/labels/good%20first%20issue`,
  },
];

// The heading and the line above the three. Here rather than in the view
// so the whole of what this section claims can be read in one file.
export const CONTRIBUTE_TITLE = 'Anyone can build this game';
export const CONTRIBUTE_LEAD =
  'The client, the server and the simulation are one open repository under the ' +
  'MIT licence. No engine to buy, no asset pipeline to install: clone it, run ' +
  'one command, and the game is running on your machine.';
