// The one seam between simulation and presentation. src/render/ and src/ui/
// talk only to IWorld, never to Sim (or, later, ClientWorld) concretely. The
// offline Sim satisfies it structurally; the online mirror world will
// implement it in phase 6, pinned by a parity test.

import type { ChampionDef } from './sim/content/champions';
import type { GameMap } from './sim/content/map';
import type { Projectile } from './sim/projectiles';
import type { AbilityKey, ScoreRow, TeamId, Vec2 } from './sim/types';
import type { Unit } from './sim/unit';
import type { Zone } from './sim/zones';

export interface IWorld {
  readonly map: GameMap;
  readonly time: number;
  readonly winner: TeamId | null;
  readonly units: ReadonlyMap<number, Readonly<Unit>>;
  readonly projectiles: ReadonlyMap<number, Readonly<Projectile>>;
  readonly zones: ReadonlyMap<number, Readonly<Zone>>;
  championDef(championId: string): ChampionDef | null;
  scoreboard(): readonly ScoreRow[];
  isVisible(team: TeamId, unitId: number): boolean;
  // The Warden's Boon state for a team, null when inactive.
  teamBuff(team: TeamId): { until: number; stacks: number } | null;
  // When the next Warden rises; null while one is alive.
  objectiveSpawnAt(): number | null;
  orderMove(unitId: number, x: number, z: number): void;
  orderAttack(unitId: number, targetId: number): void;
  orderAttackMove(unitId: number, x: number, z: number): void;
  orderStop(unitId: number): void;
  startRecall(unitId: number): void;
  castAbility(unitId: number, key: AbilityKey, aim: Vec2): boolean;
  castSigil(unitId: number, slot: number, aim: Vec2): boolean;
  buyItem(unitId: number, itemId: string): boolean;
  sellItem(unitId: number, slot: number): boolean;
  levelAbility(unitId: number, key: AbilityKey): boolean;
}
