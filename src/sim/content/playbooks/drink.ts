// The drink every house style leads with (docs/plan-potion.md): hurt and
// away from the fountain, drink the carried Sapdraught. Free and not an
// order, so it costs the slot one tick and the plays below carry on.

import type { PlayDef } from '../../playbook/types';

export const DRINK_PLAY: PlayDef = {
  id: 'drink',
  when: {
    kind: 'all',
    of: [
      { kind: 'hp', below: 0.55 },
      { kind: 'not', of: { kind: 'atFountain' } },
    ],
  },
  do: { kind: 'drink' },
};
