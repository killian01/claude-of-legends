// The bot registry: scripted or playbook Policies merged into one table
// (ADR 0002, ADR 0013). One file per bot; new bots are a first-class
// community contribution. Today every registered bot is a house style
// (house.ts); a bot that is not one is appended here, not there.

import type { LanePreference } from '../../playbook/types';
import type { Policy } from '../../policy';
import type { Sim } from '../../sim';
import { HOUSE_STYLES } from './house';
import { JUNGLER } from './jungler';
import { type BotDef, LANER } from './laner';

export type { BotDef } from './laner';

const ALL: readonly BotDef[] = [...HOUSE_STYLES];

export const BOTS: Readonly<Record<string, BotDef>> = Object.fromEntries(ALL.map((b) => [b.id, b]));

export const DEFAULT_BOT_ID = LANER.id;

// The default bot for a seat: the Jungler on a seat that asked for the
// forest itself (Unit.pickedLanes: a person's choice at select, a house
// Jungler's fill seat; ADR 0026), so the stand-in on a dropped forest seat
// walks the camps instead of taking a lane; the Laner everywhere else,
// and on any seat when no unit is named. Read from the seat alone, so the
// live stand-in, the replay's bot_on and a checkpoint restore choose alike;
// a record from before seats asked (pickedLanes null) gets the Laner, as
// it did.
export function defaultBotId(sim: Sim, unitId?: number): string {
  const seat = unitId !== undefined ? sim.units.get(unitId) : undefined;
  return defaultBotFor(seat?.pickedLanes);
}

// The same rule on a seat's lanes before any unit exists: what a host
// that names every bot seat up front (the environment) puts on a seat
// that names none.
export function defaultBotFor(lanes: readonly LanePreference[] | null | undefined): string {
  return lanes?.[0] === 'jungle' ? JUNGLER.id : DEFAULT_BOT_ID;
}

function resolve(sim: Sim, botId: string | undefined, unitId?: number): BotDef | undefined {
  return (botId !== undefined ? BOTS[botId] : undefined) ?? BOTS[defaultBotId(sim, unitId)];
}

// Seat a bot on a champion: the one attachment path for every host (the
// server match, the replay, the environment, the offline practice). An
// unknown or absent id falls back to the seat's default bot. A playbook
// bot goes through attachPlaybook so its active play is traced (ADR 0013).
export function attachBot(sim: Sim, unitId: number, botId: string | undefined): void {
  const def = resolve(sim, botId, unitId);
  if (!def) return;
  if (def.playbook) sim.attachPlaybook(unitId, def.playbook);
  else sim.attachPolicy(unitId, def.policy);
}

// The bot's Policy alone, with the same fallback (the seat's default bot
// when the seat is named), and none of the seating attachBot does: what a
// replay puts back on a seat after a checkpoint restore
// (src/net/replay.ts, restorePolicies).
export function botPolicy(sim: Sim, botId: string | undefined, unitId?: number): Policy | null {
  const def = resolve(sim, botId, unitId);
  if (!def) return null;
  return def.playbook ? sim.policyForPlaybook(def.playbook) : def.policy;
}
