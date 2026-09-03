// The Brawler, a house style (CONTEXT.md: House style): the fight first.
// The Laner's survival core, then a fight on every enemy in sight that
// walks in only with the odds (even or better within twenty, the lowest
// enemy first), the ground given under the tower when the odds turn badly,
// a join from across the map, hunting and answering a vanish while hurt,
// retreating late, no camps, and the group push bell at eight minutes.
// Sparring against it reads as a scrap; against the Sieger as a race.
// Plan-bots phase 16 measured three Brawlers against the matrix under the
// Boon's waves: the numbers trigger (30/20/45 against Laner, Sieger,
// Objective player), the collapse on threatened towers (50/25/20), and
// this one on the odds (40/30/30), the evenest of the three; the fight
// with the odds is what the style is, so it carries it.

import type { PlaybookDef } from '../../playbook/types';

export const BRAWLER_PLAYBOOK: PlaybookDef = {
  version: 4,
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
    // The fight first, walking in only with the odds, the lowest enemy first.
    {
      id: 'fight',
      when: { kind: 'enemyVisible' },
      do: { kind: 'fight', stance: 'auto', alone: 'engage', target: 'lowest', commitAt: 0.5 },
    },
    // The odds turned badly: under the tower, where they turn back.
    {
      id: 'outnumbered',
      when: { kind: 'odds', below: 0.4 },
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
