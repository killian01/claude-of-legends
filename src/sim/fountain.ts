// Fountain regeneration (game definition: "full regen at fountain"): a
// champion standing on its own fountain pad heals a large fraction of its
// maximum hp and mana per second, on top of base regen. Review finding F.0:
// without this, healing home took 337 measured seconds and both teams ended
// up AFK at base.

import type { GameMap } from './content/map';
import type { CombatCtx } from './sim_context';
import { DT } from './types';

export const FOUNTAIN_HP_FRAC_PER_S = 0.09;
export const FOUNTAIN_MANA_FRAC_PER_S = 0.12;
export const FOUNTAIN_PAD = 2;

export function applyFountainRegen(ctx: CombatCtx, map: GameMap): void {
  for (const u of ctx.units.values()) {
    if (u.kind !== 'champion' || u.dead || ctx.dead.has(u.id)) continue;
    const fountain = map.fountains.find((f) => f.team === u.team);
    if (!fountain) continue;
    const d = Math.hypot(u.pos.x - fountain.x, u.pos.z - fountain.z);
    if (d > fountain.r + FOUNTAIN_PAD) continue;
    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * FOUNTAIN_HP_FRAC_PER_S * DT);
    u.mana = Math.min(u.maxMana, u.mana + u.maxMana * FOUNTAIN_MANA_FRAC_PER_S * DT);
  }
}
