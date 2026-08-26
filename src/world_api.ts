// The one seam between simulation and presentation. src/render/ and src/ui/
// talk only to IWorld, never to Sim (or, later, ClientWorld) concretely. The
// offline Sim satisfies it structurally; the online mirror world will
// implement it in phase 6, pinned by a parity test.

import type { ChampionDef } from './sim/content/champions';
import type { GameMap } from './sim/content/map';
import type { Projectile } from './sim/projectiles';
import type { AbilityKey, Vec2 } from './sim/types';
import type { Unit } from './sim/unit';
import type { Zone } from './sim/zones';

export interface IWorld {
  readonly map: GameMap;
  readonly time: number;
  readonly units: ReadonlyMap<number, Readonly<Unit>>;
  readonly projectiles: ReadonlyMap<number, Readonly<Projectile>>;
  readonly zones: ReadonlyMap<number, Readonly<Zone>>;
  championDef(championId: string): ChampionDef | null;
  orderMove(unitId: number, x: number, z: number): void;
  orderAttack(unitId: number, targetId: number): void;
  castAbility(unitId: number, key: AbilityKey, aim: Vec2): boolean;
}
