// The ONE place a champion's derived stats are computed: base + level growth
// + item stats. Called on level up and on inventory change. Max hp and mana
// increases carry over to current values (buying hp heals by the delta).

import { CHAMPIONS } from './content/champions';
import { ITEMS, type ItemStats } from './content/items';
import type { Unit } from './unit';

function sumItemStats(items: readonly string[]): Required<ItemStats> {
  const out = { hp: 0, mana: 0, ad: 0, ap: 0, armor: 0, mr: 0, attackSpeedPct: 0, moveSpeed: 0 };
  for (const id of items) {
    const def = ITEMS[id];
    if (!def) continue;
    out.hp += def.stats.hp ?? 0;
    out.mana += def.stats.mana ?? 0;
    out.ad += def.stats.ad ?? 0;
    out.ap += def.stats.ap ?? 0;
    out.armor += def.stats.armor ?? 0;
    out.mr += def.stats.mr ?? 0;
    out.attackSpeedPct += def.stats.attackSpeedPct ?? 0;
    out.moveSpeed += def.stats.moveSpeed ?? 0;
  }
  return out;
}

export function recalcChampion(u: Unit): void {
  if (u.championId === null) return;
  const def = CHAMPIONS[u.championId];
  if (!def) return;
  const lvl = u.level - 1;
  const items = sumItemStats(u.items);

  const newMaxHp = def.base.hp + def.growth.hp * lvl + items.hp;
  const hpDelta = newMaxHp - u.maxHp;
  u.maxHp = newMaxHp;
  u.hp = Math.min(u.maxHp, Math.max(0, u.hp + Math.max(0, hpDelta)));

  const newMaxMana = def.base.mana + def.growth.mana * lvl + items.mana;
  const manaDelta = newMaxMana - u.maxMana;
  u.maxMana = newMaxMana;
  u.mana = Math.min(u.maxMana, Math.max(0, u.mana + Math.max(0, manaDelta)));

  u.stats.ad = def.base.ad + def.growth.ad * lvl + items.ad;
  u.stats.ap = items.ap;
  u.stats.armor = def.base.armor + def.growth.armor * lvl + items.armor;
  u.stats.mr = def.base.mr + def.growth.mr * lvl + items.mr;
  u.stats.attackSpeed = def.base.attackSpeed * (1 + items.attackSpeedPct);
  u.moveSpeed = def.base.moveSpeed + items.moveSpeed;
}

// XP needed to go from `level` to `level + 1`. Tuned down after review F.0
// measured levels 2-4 after 10 minutes (ultimates were dead content); the
// full curve now totals ~10900 xp, reachable inside the 20-25 min target.
export function xpForNext(level: number): number {
  return 100 + 60 * level;
}

export const MAX_LEVEL = 18;

// Grants xp and resolves any level ups (stats recalc included).
export function gainXp(u: Unit, amount: number): void {
  if (u.kind !== 'champion' || u.level >= MAX_LEVEL) {
    if (u.kind === 'champion') u.xp += amount;
    return;
  }
  u.xp += amount;
  while (u.level < MAX_LEVEL && u.xp >= xpForNext(u.level)) {
    u.xp -= xpForNext(u.level);
    u.level += 1;
    recalcChampion(u);
  }
}
