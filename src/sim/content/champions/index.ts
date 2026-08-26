// The champion registry: data-as-code records merged into one table the
// engine reads. One file per champion; the other nine land in phase 5.

import type { AbilityDef } from '../../combat/casting';
import type { AbilityKey } from '../../types';
import { SYLRA } from './sylra';

export interface ChampionBaseStats {
  hp: number;
  mana: number;
  ad: number;
  ap: number;
  armor: number;
  mr: number;
  attackRange: number;
  attackSpeed: number;
  moveSpeed: number;
  hpRegen: number;
  manaRegen: number;
  radius: number;
}

export interface ChampionGrowth {
  hp: number;
  mana: number;
  ad: number;
  armor: number;
  mr: number;
}

export interface ChampionDef {
  id: string;
  name: string;
  base: ChampionBaseStats;
  growth: ChampionGrowth;
  abilities: Record<AbilityKey, AbilityDef>;
}

export const CHAMPIONS: Readonly<Record<string, ChampionDef>> = {
  [SYLRA.id]: SYLRA,
};

export const DEFAULT_CHAMPION_ID = SYLRA.id;
