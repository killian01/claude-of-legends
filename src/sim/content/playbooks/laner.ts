// The Laner as a playbook: the default every bot starts as, and the house
// bot's brain. The same priorities the scripted Laner grew through three
// playtest rounds (survive, shop, stay out of tower fire, close out the
// Sanctum, fight, hunt, contest the Warden, farm, push with the wave), now
// as an ordered list of plays interpreted by src/sim/playbook/. Each
// behavior falls back to its engine default parameters; only the trigger
// thresholds are spelled out here because they are the play's condition.
// tests/playbook.test.ts pins this playbook tick for tick to the scripted
// Laner it replaced (tests/fixtures/legacy_laner.ts).

import type { PlaybookDef } from '../../playbook/types';

export const LANER_PLAYBOOK: PlaybookDef = {
  version: 1,
  plays: [
    // Survive first: under a third of health, run home by the fastest
    // means (escape key, Riftstep, Zephyr, Mend, recall, feet).
    { id: 'retreat', when: { kind: 'hp', below: 0.32 }, do: { kind: 'retreat' } },
    // Heal up before walking back out (fountain regen makes this quick).
    {
      id: 'rest',
      when: { kind: 'all', of: [{ kind: 'atFountain' }, { kind: 'hp', below: 0.7 }] },
      do: { kind: 'hold' },
    },
    { id: 'shop', when: { kind: 'atFountain' }, do: { kind: 'shop' } },
    // A full purse is a power spike waiting: go convert it once the bank
    // covers the next build step.
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
    { id: 'fight', when: { kind: 'enemyVisible' }, do: { kind: 'fight' } },
    { id: 'hunt', when: { kind: 'not', of: { kind: 'enemyVisible' } }, do: { kind: 'hunt' } },
    {
      id: 'vanish',
      when: { kind: 'not', of: { kind: 'enemyVisible' } },
      do: { kind: 'answerVanish' },
    },
    { id: 'warden', when: { kind: 'always' }, do: { kind: 'contestWarden' } },
    { id: 'farm', when: { kind: 'always' }, do: { kind: 'farm' } },
    { id: 'camp', when: { kind: 'not', of: { kind: 'enemyVisible' } }, do: { kind: 'takeCamp' } },
    { id: 'siege', when: { kind: 'always' }, do: { kind: 'siege' } },
    { id: 'push', when: { kind: 'always' }, do: { kind: 'push' } },
  ],
};
