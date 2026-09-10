// Fountain regeneration (game definition: "full regen at fountain"): a
// champion standing on its own fountain heals a large fraction of its
// maximum hp and mana per second, on top of base regen. Review finding F.0:
// without this, healing home took 337 measured seconds and both teams ended
// up AFK at base.
//
// Where the fountain is: its pad, and the further pads a map lists beside
// it (FountainSpot.pads in content/map.ts; the Star Orchard's spawn terrace,
// a band around the Sanctum whose far seats stand eleven meters from the
// pad). Healing and the shop (sim.ts buyItem, sellItem) cover all of it,
// for a champion and a bot alike. The burn on enemies covers the fountain's
// own pad only: the ground behind a Sanctum is not a wall of true damage.

import { dealDamage } from './combat/damage';
import type { Disc, FountainSpot, GameMap } from './content/map';
import { hypot } from './exact';
import type { CombatCtx } from './sim_context';
import { DT, type TeamId, type Vec2 } from './types';

export const FOUNTAIN_HP_FRAC_PER_S = 0.09;
export const FOUNTAIN_MANA_FRAC_PER_S = 0.12;
// How far past a pad's edge the fountain still counts.
export const FOUNTAIN_PAD = 2;
// Enemies inside a fountain melt: diving the fountain is never free.
export const FOUNTAIN_TRUE_DPS = 220;

function onPad(pad: Disc, pos: Vec2): boolean {
  return hypot(pos.x - pad.x, pos.z - pad.z) <= pad.r + FOUNTAIN_PAD;
}

// Standing on the fountain: its own pad, or any pad listed beside it.
export function onFountain(fountain: FountainSpot, pos: Vec2): boolean {
  return onPad(fountain, pos) || (fountain.pads ?? []).some((pad) => onPad(pad, pos));
}

// Standing on the team's own fountain; false for a team without one.
export function withinFountain(map: GameMap, team: TeamId, pos: Vec2): boolean {
  const fountain = map.fountains.find((f) => f.team === team);
  return fountain !== undefined && onFountain(fountain, pos);
}

export function applyFountainRegen(ctx: CombatCtx, map: GameMap): void {
  for (const u of ctx.units.values()) {
    if (u.dead || ctx.dead.has(u.id)) continue;
    for (const fountain of map.fountains) {
      if (fountain.team === u.team) {
        if (u.kind !== 'champion' || !onFountain(fountain, u.pos)) continue;
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * FOUNTAIN_HP_FRAC_PER_S * DT);
        u.mana = Math.min(u.maxMana, u.mana + u.maxMana * FOUNTAIN_MANA_FRAC_PER_S * DT);
      } else if (onPad(fountain, u.pos)) {
        dealDamage(ctx, 0, u, FOUNTAIN_TRUE_DPS * DT, 'true');
      }
    }
  }
}
