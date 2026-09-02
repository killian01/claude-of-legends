// The Brawler: a house style (CONTEXT.md: House style), the playbook in
// src/sim/content/playbooks/brawler.ts run by the shared interpreter. One
// file per bot, as the registry asks.

import { playbookPolicy } from '../../playbook/interpreter';
import { BRAWLER_PLAYBOOK } from '../playbooks/brawler';
import type { BotDef } from './laner';

export const BRAWLER: BotDef = {
  id: 'brawler',
  name: 'Brawler',
  policy: playbookPolicy(BRAWLER_PLAYBOOK),
  playbook: BRAWLER_PLAYBOOK,
};
