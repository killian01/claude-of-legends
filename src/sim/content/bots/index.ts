// The bot registry: scripted Policies merged into one table (ADR 0002).
// One file per bot; new bots are a first-class community contribution.

import { type BotDef, LANER } from './laner';

export type { BotDef } from './laner';

const ALL: readonly BotDef[] = [LANER];

export const BOTS: Readonly<Record<string, BotDef>> = Object.fromEntries(ALL.map((b) => [b.id, b]));

export const DEFAULT_BOT_ID = LANER.id;
