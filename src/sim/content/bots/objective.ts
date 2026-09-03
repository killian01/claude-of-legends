// The Objective player: a house style (CONTEXT.md: House style), the
// playbook in src/sim/content/playbooks/objective.ts run by the shared
// interpreter.

import { playbookPolicy } from '../../playbook/interpreter';
import { OBJECTIVE_PLAYBOOK } from '../playbooks/objective';
import type { BotDef } from './laner';

export const OBJECTIVE: BotDef = {
  id: 'objective',
  name: 'Objective player',
  policy: playbookPolicy(OBJECTIVE_PLAYBOOK),
  playbook: OBJECTIVE_PLAYBOOK,
};
