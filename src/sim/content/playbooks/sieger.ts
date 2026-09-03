// The Sieger, a house style (CONTEXT.md: House style): the wave and the
// towers. The Laner's survival core with an earlier retreat and a deeper
// dive under towers (a thinner escort, more of the red), the ground given
// under the nearest tower when the odds turn badly, a fight that holds with
// nobody beside it, a join only for a fight close by, then the structure in
// reach with a single minion of escort BEFORE the wave (the Laner sieges
// last, once nothing is left to farm), the Warden only when healthy and
// close to its spawn, no hunt, no vanish answer, no camps, and NO regroup
// bell: three lanes of pressure all match long. Its matches are decided in
// towers. Plan-bots phase 16 measured this pressing Sieger against the
// matrix: it beats the Laner 60%, the Brawler 70% and the Objective player
// 55%, the strongest style the engine has; the grouped Sieger it replaced
// sat at 45/60/40.

import type { PlaybookDef } from '../../playbook/types';

export const SIEGER_PLAYBOOK: PlaybookDef = {
  version: 4,
  plays: [
    { id: 'retreat', when: { kind: 'hp', below: 0.3 }, do: { kind: 'retreat' } },
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
    {
      id: 'avoid-tower',
      when: { kind: 'underTower' },
      do: { kind: 'avoidTower', escortMin: 2, hpBelow: 0.5 },
    },
    { id: 'finish', when: { kind: 'always' }, do: { kind: 'finishSanctum' } },
    // The odds turned badly: under the tower, where they turn back.
    {
      id: 'outnumbered',
      when: { kind: 'odds', below: 0.35 },
      do: { kind: 'fallBack' },
    },
    { id: 'fight', when: { kind: 'enemyVisible' }, do: { kind: 'fight', alone: 'hold' } },
    {
      id: 'join',
      when: { kind: 'allyFighting', within: 25 },
      do: { kind: 'joinAlly', within: 25 },
    },
    { id: 'siege', when: { kind: 'always' }, do: { kind: 'siege', escortMin: 1 } },
    {
      id: 'warden',
      when: { kind: 'hp', atLeast: 0.7 },
      do: { kind: 'contestWarden', hpAtLeast: 0.7, prepSeconds: 10 },
    },
    { id: 'farm', when: { kind: 'always' }, do: { kind: 'farm' } },
    { id: 'push', when: { kind: 'always' }, do: { kind: 'push', regroupAt: null } },
  ],
};
