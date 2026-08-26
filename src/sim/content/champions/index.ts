// The champion registry: data-as-code records merged into one table the
// engine reads. One file per champion; new champions are the flagship
// community contribution. Passives hook into the engine through
// ChampionPassive (src/sim/passive_types.ts); Sylra's marks live entirely
// in her ability specs, so her passive entry is descriptive only.

import type { AbilityDef } from '../../combat/casting';
import type { ChampionPassive } from '../../passive_types';
import type { AbilityKey } from '../../types';
import { ASHVYN } from './ashvyn';
import { DAIN } from './dain';
import { ELOWEN } from './elowen';
import { FENN } from './fenn';
import { KORRATH } from './korrath';
import { MAERA } from './maera';
import { RHOKA } from './rhoka';
import { SYLRA } from './sylra';
import { TORV } from './torv';
import { VESK } from './vesk';

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

export type ChampionRole =
  | 'Tank'
  | 'Fighter'
  | 'Mage'
  | 'Battlemage'
  | 'Assassin'
  | 'Marksman'
  | 'Support'
  | 'Skirmisher';

export interface ChampionDef {
  id: string;
  name: string;
  role: ChampionRole;
  // One line of play-style intent, shown on the select screen.
  blurb: string;
  passive: ChampionPassive;
  base: ChampionBaseStats;
  growth: ChampionGrowth;
  abilities: Record<AbilityKey, AbilityDef>;
}

const ALL: readonly ChampionDef[] = [
  KORRATH,
  DAIN,
  SYLRA,
  FENN,
  ELOWEN,
  VESK,
  ASHVYN,
  MAERA,
  TORV,
  RHOKA,
];

export const CHAMPIONS: Readonly<Record<string, ChampionDef>> = Object.fromEntries(
  ALL.map((c) => [c.id, c]),
);

export const CHAMPION_LIST: readonly ChampionDef[] = ALL;

export const DEFAULT_CHAMPION_ID = SYLRA.id;
