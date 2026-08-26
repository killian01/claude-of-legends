// Runs the champion passive hooks. Passives are code-bearing content
// declared on ChampionDef (src/sim/content/champions/); this module is the
// only place the engine calls them from.

import { CHAMPIONS } from './content/champions';
import type { ChampionPassive } from './passive_types';
import type { CombatCtx } from './sim_context';
import type { Unit } from './unit';

export const PASSIVE_PERIOD_TICKS = 5;

export function passiveOf(u: Unit): ChampionPassive | undefined {
  if (u.kind !== 'champion' || u.championId === null) return undefined;
  return CHAMPIONS[u.championId]?.passive;
}

export function stepPassives(ctx: CombatCtx, tickCount: number): void {
  for (const u of ctx.units.values()) {
    if (u.kind !== 'champion' || u.dead || ctx.dead.has(u.id)) continue;
    if ((tickCount + u.id) % PASSIVE_PERIOD_TICKS !== 0) continue;
    passiveOf(u)?.onTick?.(ctx, u);
  }
}
