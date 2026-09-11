// The Jungler, a house style (CONTEXT.md: House style, Jungler; ADR 0023):
// the forest's post. Asks for no lane; walks its forest's round (the
// Spinecrest, the Brackenlings, the Barkmaw) on what its team has seen,
// clearing each camp with its abilities, and is the team's first body at
// every neutral objective: the Objective player's stance on the Warden,
// the Ascendant and the creatures, from across the map. Between rounds
// it ganks: a fight that holds alone (a walk-in only beside an ally, so
// a level-two jungler meeting a laner strikes what reaches it), a join
// from sixty units; then the Laner's tail without a lane of its own, the
// mid push. The Laner's survival core on top: it recalls to spend like
// everyone, once the round is done.

import type { PlaybookDef } from '../../playbook/types';

export const JUNGLER_PLAYBOOK: PlaybookDef = {
  version: 4,
  lanes: ['jungle'],
  plays: [
    { id: 'retreat', when: { kind: 'hp', below: 0.32 }, do: { kind: 'retreat' } },
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
    { id: 'avoid-tower', when: { kind: 'underTower' }, do: { kind: 'avoidTower' } },
    { id: 'finish', when: { kind: 'always' }, do: { kind: 'finishSanctum' } },
    // A body nearly down beats a fight (docs/plan-rings.md, round two).
    {
      id: 'finish-warden',
      when: { kind: 'warden', state: 'up', hpAtMost: 0.2, near: 10 },
      do: { kind: 'contestWarden', partyAtLeast: 1 },
    },
    {
      id: 'finish-creature',
      when: { kind: 'creature', state: 'up', hpAtMost: 0.2, near: 10 },
      do: { kind: 'contestCreature', partyAtLeast: 1 },
    },
    // The objectives first, from anywhere on the map, with nobody close.
    {
      id: 'warden',
      when: { kind: 'enemies', within: 12, atMost: 0 },
      do: { kind: 'contestWarden', hpAtLeast: 0.6, prepSeconds: 45 },
    },
    {
      id: 'ascendant',
      when: { kind: 'enemies', within: 12, atMost: 0 },
      do: {
        kind: 'contestCreature',
        which: 'ascendant',
        hpAtLeast: 0.6,
        prepSeconds: 45,
        within: 90,
      },
    },
    {
      id: 'creature',
      when: { kind: 'enemies', within: 12, atMost: 0 },
      do: { kind: 'contestCreature', hpAtLeast: 0.6, prepSeconds: 45, within: 90 },
    },
    {
      id: 'outnumbered',
      when: {
        kind: 'all',
        of: [
          { kind: 'enemies', within: 15, atLeast: 2 },
          { kind: 'allies', within: 15, atMost: 0 },
        ],
      },
      do: { kind: 'fallBack' },
    },
    { id: 'fight', when: { kind: 'enemyVisible' }, do: { kind: 'fight', alone: 'hold' } },
    // The gank: an ally in a fight near is where the jungler goes, once it
    // has a few levels and the health for it (a level-one jungler that
    // joined every skirmish walked into tower fire, measured on seed 42).
    {
      id: 'join',
      when: {
        kind: 'all',
        of: [
          { kind: 'allyFighting', within: 45 },
          { kind: 'hp', atLeast: 0.6 },
          { kind: 'level', atLeast: 3 },
        ],
      },
      do: { kind: 'joinAlly', within: 45 },
    },
    // The round, with no enemy champion close: the team's sight of an
    // enemy across the map is not a reason to leave a camp.
    {
      id: 'jungle',
      when: { kind: 'enemies', within: 20, atMost: 0 },
      do: { kind: 'jungle' },
    },
    { id: 'hunt', when: { kind: 'not', of: { kind: 'enemyVisible' } }, do: { kind: 'hunt' } },
    {
      id: 'vanish',
      when: { kind: 'not', of: { kind: 'enemyVisible' } },
      do: { kind: 'answerVanish' },
    },
    { id: 'farm', when: { kind: 'always' }, do: { kind: 'farm' } },
    { id: 'siege', when: { kind: 'always' }, do: { kind: 'siege' } },
    { id: 'push', when: { kind: 'always' }, do: { kind: 'push', lane: 'mid' } },
  ],
};
