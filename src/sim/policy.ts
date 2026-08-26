// The single abstraction behind every bot, scripted or trained (ADR 0002).
// A Policy is deterministic, does zero I/O, and sees only what its team sees
// (the observation is built from team vision; see observe.ts). Contract
// version 0, FROZEN at phase 7: the headless Gym env will expose exactly
// this observation and action space, and changing it breaks every
// community-trained bot, so it is versioned and evolved deliberately.
// The static map (src/sim/content/map.ts) is a known constant of the
// contract; policies may read it directly.

import type { Rng } from './rng';
import type { AbilityKey, TeamId } from './types';
import type { UnitKind } from './unit';

export const POLICY_CONTRACT_VERSION = 0;

export interface ObsUnit {
  id: number;
  kind: UnitKind;
  friendly: boolean;
  x: number;
  z: number;
  hpFrac: number;
  radius: number;
  // Structures only: true while layer protection makes it immune (additive
  // v0 field; without it a policy cannot know a target is untouchable).
  invulnerable?: boolean;
}

export interface ObsSelf {
  id: number;
  team: TeamId;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  hpFrac: number;
  mana: number;
  maxMana: number;
  level: number;
  gold: number;
  dead: boolean;
  // Cooldown, mana, and rank gates resolved; the decision budget is not
  // part of readiness (a ready ability can still be budget-rejected).
  abilityReady: Record<AbilityKey, boolean>;
  // Effective ability ranks (R reads 0 until champion level 6) and unspent
  // skill points. Additive v0 fields, like `invulnerable` on ObsUnit.
  abilityRanks: Record<AbilityKey, number>;
  skillPoints: number;
  sigils: readonly string[];
  sigilReady: readonly boolean[];
  items: readonly string[];
  // Which champion this policy is driving. Additive v0 field (like
  // `abilityRanks`): policies use it to pick role-appropriate item builds.
  championId: string | null;
  // The lane this participant was assigned, null for unassigned (humans).
  // Additive v0 field; bots use it to hold a lane instead of flocking.
  lane: 'top' | 'mid' | 'bot' | null;
}

export interface Observation {
  tick: number;
  time: number;
  winner: TeamId | null;
  self: ObsSelf;
  // Everything the team currently sees, self excluded.
  units: readonly ObsUnit[];
  // When the next Warden rises, null while one is alive. Additive v0 field:
  // the spawn clock is the one objective fact unit rows cannot carry.
  objectiveSpawnAt?: number | null;
}

export type Action =
  | { kind: 'noop' }
  | { kind: 'move'; x: number; z: number }
  | { kind: 'attack'; targetId: number }
  | { kind: 'cast'; key: AbilityKey; x: number; z: number }
  | { kind: 'sigil'; slot: number; x: number; z: number }
  | { kind: 'buy'; itemId: string }
  // Spends one skill point (free action, outside the decision budget).
  | { kind: 'level'; key: AbilityKey };

export type Policy = (obs: Observation, rng: Rng) => Action;
