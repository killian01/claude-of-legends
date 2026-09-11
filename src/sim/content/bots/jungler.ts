// The Jungler: a house style (CONTEXT.md: House style, Jungler), the
// playbook in src/sim/content/playbooks/jungler.ts run by the shared
// interpreter. The one style the fill seats by post rather than by draw:
// every five-seat house team fields one (house.ts).

import { playbookPolicy } from '../../playbook/interpreter';
import { JUNGLER_PLAYBOOK } from '../playbooks/jungler';
import type { BotDef } from './laner';

export const JUNGLER: BotDef = {
  id: 'jungler',
  name: 'Jungler',
  policy: playbookPolicy(JUNGLER_PLAYBOOK),
  playbook: JUNGLER_PLAYBOOK,
};
