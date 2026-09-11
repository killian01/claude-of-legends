// The Objective player, a house style (CONTEXT.md: House style): the
// Warden, the rings and the camps. The Laner's survival core, then the Warden ahead
// of any fight while no enemy stands close (at the pit forty-five seconds
// before it rises, the Laner twenty), ground given under the nearest tower
// when outnumbered with no ally near, a fight that holds with nobody
// beside it, a join from far, the camps before the wave, then the Laner's
// tail. Its matches are decided at the pits.

import type { PlaybookDef } from '../../playbook/types';

export const OBJECTIVE_PLAYBOOK: PlaybookDef = {
  version: 2,
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
    {
      id: 'warden',
      when: { kind: 'enemies', within: 12, atMost: 0 },
      do: { kind: 'contestWarden', hpAtLeast: 0.6, prepSeconds: 45 },
    },
    {
      id: 'creature',
      when: { kind: 'enemies', within: 12, atMost: 0 },
      do: { kind: 'contestCreature', hpAtLeast: 0.6, prepSeconds: 45, within: 70 },
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
    {
      id: 'join',
      when: { kind: 'allyFighting', within: 60 },
      do: { kind: 'joinAlly', within: 60 },
    },
    { id: 'camp', when: { kind: 'not', of: { kind: 'enemyVisible' } }, do: { kind: 'takeCamp' } },
    { id: 'hunt', when: { kind: 'not', of: { kind: 'enemyVisible' } }, do: { kind: 'hunt' } },
    {
      id: 'vanish',
      when: { kind: 'not', of: { kind: 'enemyVisible' } },
      do: { kind: 'answerVanish' },
    },
    { id: 'farm', when: { kind: 'always' }, do: { kind: 'farm' } },
    { id: 'siege', when: { kind: 'always' }, do: { kind: 'siege' } },
    { id: 'push', when: { kind: 'always' }, do: { kind: 'push' } },
  ],
};
