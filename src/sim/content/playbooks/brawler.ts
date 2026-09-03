// The Brawler, a house style (CONTEXT.md: House style): the fight first.
// The Laner's survival core, then a walk-in on every enemy in sight, front
// stance whatever the champion, engaging with nobody beside it, joining a
// fight from across the map, hunting and answering a vanish while hurt,
// retreating late, no camps, and the group push bell at eight minutes.
// Sparring against it reads as a scrap; against the Sieger as a race.

import type { PlaybookDef } from '../../playbook/types';

export const BRAWLER_PLAYBOOK: PlaybookDef = {
  version: 2,
  plays: [
    { id: 'retreat', when: { kind: 'hp', below: 0.25 }, do: { kind: 'retreat' } },
    {
      id: 'rest',
      when: { kind: 'all', of: [{ kind: 'atFountain' }, { kind: 'hp', below: 0.7 }] },
      do: { kind: 'hold' },
    },
    { id: 'shop', when: { kind: 'atFountain' }, do: { kind: 'shop' } },
    {
      id: 'shop-trip',
      when: {
        kind: 'all',
        of: [
          { kind: 'not', of: { kind: 'atFountain' } },
          { kind: 'gold', atLeast: 1000 },
        ],
      },
      do: { kind: 'goShop' },
    },
    // Dives with a thinner escort and deeper into the red than the Laner.
    {
      id: 'avoid-tower',
      when: { kind: 'underTower' },
      do: { kind: 'avoidTower', escortMin: 2, hpBelow: 0.5 },
    },
    { id: 'finish', when: { kind: 'always' }, do: { kind: 'finishSanctum' } },
    // The fight first, but with the numbers: even or better within 20.
    {
      id: 'fight',
      when: {
        kind: 'all',
        of: [{ kind: 'enemyVisible' }, { kind: 'numbers', within: 20, atLeast: 0 }],
      },
      do: { kind: 'fight', stance: 'auto', alone: 'engage' },
    },
    // Outnumbered: under the tower, where the numbers turn.
    {
      id: 'outnumbered',
      when: { kind: 'numbers', within: 20, atMost: -1 },
      do: { kind: 'fallBack' },
    },
    {
      id: 'join',
      when: { kind: 'allyFighting', within: 80 },
      do: { kind: 'joinAlly', within: 80 },
    },
    {
      id: 'hunt',
      when: { kind: 'not', of: { kind: 'enemyVisible' } },
      do: { kind: 'hunt', hpAbove: 0.35 },
    },
    {
      id: 'vanish',
      when: { kind: 'not', of: { kind: 'enemyVisible' } },
      do: { kind: 'answerVanish', hpAtLeast: 0.4 },
    },
    { id: 'warden', when: { kind: 'always' }, do: { kind: 'contestWarden' } },
    { id: 'farm', when: { kind: 'always' }, do: { kind: 'farm' } },
    { id: 'siege', when: { kind: 'always' }, do: { kind: 'siege' } },
    { id: 'push', when: { kind: 'always' }, do: { kind: 'push', regroupAt: 8 * 60 } },
  ],
};
