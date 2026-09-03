// The Laner: the default bot (ADR 0002 phase 1). Since ADR 0013 it is the
// default PLAYBOOK (src/sim/content/playbooks/laner.ts) run by the shared
// interpreter and micro (src/sim/playbook/); the scripted brain it grew out
// of was retired with ADR 0014 once the playbook was proven tick for tick.
// One file per bot, contributable by PR: implement or compose a Policy,
// register in index.ts, done.

import { playbookPolicy } from '../../playbook/interpreter';
import type { PlaybookDef } from '../../playbook/types';
import type { Policy } from '../../policy';
import { LANER_PLAYBOOK } from '../playbooks/laner';

export { REGROUP_AT_S } from '../../playbook/micro';

export interface BotDef {
  id: string;
  name: string;
  policy: Policy;
  // Present when the policy is a playbook: attached through
  // Sim.attachPlaybook so the active play is traced (ADR 0013).
  playbook?: PlaybookDef;
}

export const LANER: BotDef = {
  id: 'laner',
  name: 'Laner',
  policy: playbookPolicy(LANER_PLAYBOOK),
  playbook: LANER_PLAYBOOK,
};
