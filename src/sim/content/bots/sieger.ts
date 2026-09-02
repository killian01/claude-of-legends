// The Sieger: a house style (CONTEXT.md: House style), the playbook in
// src/sim/content/playbooks/sieger.ts run by the shared interpreter.

import { playbookPolicy } from '../../playbook/interpreter';
import { SIEGER_PLAYBOOK } from '../playbooks/sieger';
import type { BotDef } from './laner';

export const SIEGER: BotDef = {
  id: 'sieger',
  name: 'Sieger',
  policy: playbookPolicy(SIEGER_PLAYBOOK),
  playbook: SIEGER_PLAYBOOK,
};
