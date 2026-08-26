// The champion registry: data-as-code records merged into one table the
// engine reads. One file per champion; new champions are the flagship
// community contribution. Champion passives that need per-tick hooks are
// deferred to the passive-hook system (see docs/roadmap.md); Sylra's marks
// live entirely in her ability specs.

import type { AbilityDef } from '../../combat/casting';
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

export interface ChampionDef {
  id: string;
  name: string;
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
