// The ONE place a champion's derived stats are computed: base + level growth
// + item stats. Called on level up and on inventory change. Max hp and mana
// increases carry over to current values (buying hp heals by the delta).

import { ITEMS, type ItemStats } from './content/items';
import type { Unit } from './unit';

function sumItemStats(items: readonly string[]): Required<ItemStats> {
  const out = {
    hp: 0,
    mana: 0,
    ad: 0,
    ap: 0,
    armor: 0,
    mr: 0,
    attackSpeedPct: 0,
    moveSpeed: 0,
    armorPen: 0,
    mrPen: 0,
    armorPenPct: 0,
    mrPenPct: 0,
  };
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
    out.armorPen += def.stats.armorPen ?? 0;
    out.mrPen += def.stats.mrPen ?? 0;
    out.armorPenPct += def.stats.armorPenPct ?? 0;
    out.mrPenPct += def.stats.mrPenPct ?? 0;
  }
  return out;
}

export function recalcChampion(u: Unit): void {
  // The unit carries its resolved definition (roster or forged), so the
  // recalc never consults a global table (match-scoped resolution).
  const def = u.champion;
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
  u.stats.armorPen = items.armorPen;
  u.stats.mrPen = items.mrPen;
  u.stats.armorPenPct = Math.min(0.7, items.armorPenPct);
  u.stats.mrPenPct = Math.min(0.7, items.mrPenPct);
  u.moveSpeed = def.base.moveSpeed + items.moveSpeed;
}

// XP needed to go from `level` to `level + 1`. Tuned down after review F.0
// (ultimates were dead content), then again by the pacing review: the full
// curve now totals ~9400 xp so level and ability spikes land noticeably
// faster inside the 20-25 min target.
export function xpForNext(level: number): number {
  return 85 + 52 * level;
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
    u.skillPoints += 1;
    recalcChampion(u);
  }
}

// Walks a champion up the xp curve to `level` (clamped to the cap) through
// gainXp, so every level's skill point and stat recalc land exactly as a
// match would grant them; xp toward the next level ends at zero. Practice
// starts (a Forge test drive at the ultimate's level) use it.
export function levelTo(u: Unit, level: number): void {
  if (u.kind !== 'champion') return;
  const target = Math.min(MAX_LEVEL, Math.floor(level));
  while (u.level < target) gainXp(u, xpForNext(u.level) - u.xp);
}

// The live rank of an ability. Basics are always at least rank 1; R counts
// as rank 1 from champion level 6 even before a point is invested.
export function effectiveRank(u: Unit, key: 'Q' | 'W' | 'E' | 'R'): number {
  const stored = u.abilityRanks[key] ?? 0;
  if (key === 'R') return stored > 0 ? stored : u.level >= 6 ? 1 : 0;
  // Basics are EARNED: rank 0 means unlearned (the level 1 skill choice).
  return stored;
}

export const BASIC_MAX_RANK = 5;
export const ULT_MAX_RANK = 3;
export const ULT_RANK_LEVELS: readonly number[] = [6, 11, 16];
// Generic rank scaling: base amounts grow, cooldowns shrink.
// Raised twice by the pacing and snowball reviews: rank 5 is now 3.2x the
// rank 1 base, genre-shaped, so a level lead is a real damage lead (and the
// only offensive level scaling mages have).
export const RANK_BASE_SCALE = 0.55;
export const RANK_CD_SCALE = 0.06;
