// The Gentle player: a house style (CONTEXT.md: House style), the playbook
// in src/sim/content/playbooks/gentle.ts run by the shared interpreter.
// Seated by post on the enemy lane seats a newcomer meets (house.ts,
// gentleSeats), never drawn.

import { playbookPolicy } from '../../playbook/interpreter';
import { GENTLE_PLAYBOOK } from '../playbooks/gentle';
import type { BotDef } from './laner';

export const GENTLE: BotDef = {
  id: 'gentle',
  name: 'Gentle player',
  policy: playbookPolicy(GENTLE_PLAYBOOK),
  playbook: GENTLE_PLAYBOOK,
};
