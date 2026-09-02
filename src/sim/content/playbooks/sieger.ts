// The Sieger, a house style (CONTEXT.md: House style): the wave and the
// towers. The Laner's survival core with an earlier retreat, a fight that
// holds with nobody beside it, a join only for a fight close by, then the
// structure in reach with any escort BEFORE the wave (the Laner sieges
// last, once nothing is left to farm), the Warden only when healthy and
// close to its spawn, no hunt, no vanish answer, no camps, and the group
// push mid at ten minutes. Its matches are decided in towers.

import type { PlaybookDef } from '../../playbook/types';

export const SIEGER_PLAYBOOK: PlaybookDef = {
  version: 2,
  plays: [
    { id: 'retreat', when: { kind: 'hp', below: 0.35 }, do: { kind: 'retreat' } },
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
    { id: 'fight', when: { kind: 'enemyVisible' }, do: { kind: 'fight', alone: 'hold' } },
    {
      id: 'join',
      when: { kind: 'allyFighting', within: 25 },
      do: { kind: 'joinAlly', within: 25 },
    },
    { id: 'siege', when: { kind: 'always' }, do: { kind: 'siege', escortMin: 2 } },
    {
      id: 'warden',
      when: { kind: 'hp', atLeast: 0.7 },
      do: { kind: 'contestWarden', hpAtLeast: 0.7, prepSeconds: 10 },
    },
    { id: 'farm', when: { kind: 'always' }, do: { kind: 'farm' } },
    { id: 'push', when: { kind: 'always' }, do: { kind: 'push', regroupAt: 10 * 60 } },
  ],
};
