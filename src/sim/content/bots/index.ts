// The bot registry: scripted or playbook Policies merged into one table
// (ADR 0002, ADR 0013). One file per bot; new bots are a first-class
// community contribution.

import type { Sim } from '../../sim';
import { type BotDef, LANER } from './laner';

export type { BotDef } from './laner';

const ALL: readonly BotDef[] = [LANER];

export const BOTS: Readonly<Record<string, BotDef>> = Object.fromEntries(ALL.map((b) => [b.id, b]));

export const DEFAULT_BOT_ID = LANER.id;

// Seat a bot on a champion: the one attachment path for every host (the
// server match, the replay, the environment, the offline practice). An
// unknown or absent id falls back to the default bot. A playbook bot goes
// through attachPlaybook so its active play is traced (ADR 0013).
export function attachBot(sim: Sim, unitId: number, botId: string | undefined): void {
  const def = (botId !== undefined ? BOTS[botId] : undefined) ?? BOTS[DEFAULT_BOT_ID];
  if (!def) return;
  if (def.playbook) sim.attachPlaybook(unitId, def.playbook);
  else sim.attachPolicy(unitId, def.policy);
}
