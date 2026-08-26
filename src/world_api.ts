// The one seam between simulation and presentation. src/render/ and src/ui/
// talk only to IWorld, never to Sim (or, later, ClientWorld) concretely. The
// offline Sim satisfies it structurally; the online mirror world will
// implement it in phase 6, pinned by a parity test.

import type { GameMap } from './sim/content/map';
import type { Unit } from './sim/unit';

export interface IWorld {
  readonly map: GameMap;
  readonly time: number;
  readonly units: ReadonlyMap<number, Readonly<Unit>>;
  orderMove(unitId: number, x: number, z: number): void;
}
