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
// and is not: the roster is data, so the work is a file and three table
// entries. Training a bot is second because it is the strangest thing here
// and the reason some people will stay. An open issue is last because it
// is the ordinary answer, and the one that needs no imagination.
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
      'The roster is data, not code. A new champion is one file and three table ' +
      'entries, and the guide walks every one of them.',
    cta: 'Read the guide',
    href: `${REPO}/blob/main/docs/adding-a-champion.md`,
  },
  {
    title: 'Train a bot',
    line:
      'Every bot is a deterministic policy behind one versioned contract, and the ' +
      'match runs headless over NDJSON. Bring your own trainer.',
    cta: 'See the contract',
    href: `${REPO}/blob/main/headless/README.md`,
  },
  {
    title: 'Take an issue',
    line:
      'Balance, rendering, netcode, docs. The ones marked good first issue are ' +
      'scoped so that the first pull request is a small one.',
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
