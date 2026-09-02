// What a new bot starts as (docs/design/bots.md): the Laner, plus the one
// play a house bot does not have, obeying its owner's coach order, placed
// right under survival so a coach can direct anything but a bot at
// death's door. The owner moves or removes it like any play.

import type { PlaybookDef } from '../../playbook/types';
import { LANER_PLAYBOOK } from './laner';

export const COACH_PLAY_ID = 'coach';

export const NEW_BOT_PLAYBOOK: PlaybookDef = {
  version: LANER_PLAYBOOK.version,
  plays: LANER_PLAYBOOK.plays.flatMap((p) =>
    p.id === 'retreat'
      ? [
          p,
          {
            id: COACH_PLAY_ID,
            when: { kind: 'order' as const },
            do: { kind: 'obeyOrder' as const },
          },
        ]
      : [p],
  ),
};
