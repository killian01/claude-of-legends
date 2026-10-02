// The one seam between simulation and presentation. src/render/ and src/ui/
// talk only to IWorld, never to Sim (or, later, ClientWorld) concretely. The
// offline Sim satisfies it structurally; the online mirror world will
// implement it in phase 6, pinned by a parity test.

import type { RoyaleView, SeatLabel } from './net/royale_wire';
import type { ChampionDef } from './sim/content/champions';
import type { GameMap, WardenPit } from './sim/content/map';
import type { FavorStacks } from './sim/favors';
import type { Vec3 } from './sim/geo';
import type { Projectile } from './sim/projectiles';
import type { RingClock } from './sim/rings';
import type { AbilityKey, ScoreRow, TeamId, Vec2 } from './sim/types';
import type { Unit } from './sim/unit';
import type { Wall } from './sim/walls';
import type { Zone } from './sim/zones';

export interface IWorld {
  readonly map: GameMap;
  readonly time: number;
  readonly winner: TeamId | null;
  readonly units: ReadonlyMap<number, Readonly<Unit>>;
  readonly projectiles: ReadonlyMap<number, Readonly<Projectile>>;
  readonly zones: ReadonlyMap<number, Readonly<Zone>>;
  // Ability walls (kits-v2): terrain both teams always see.
  readonly walls: ReadonlyMap<number, Readonly<Wall>>;
  championDef(championId: string): ChampionDef | null;
  scoreboard(): readonly ScoreRow[];
  isVisible(team: TeamId, unitId: number): boolean;
  // The Warden's Boon state for a team, null when inactive.
  teamBuff(team: TeamId): { until: number; stacks: number } | null;
  // When the next Warden rises; null while one is alive.
  objectiveSpawnAt(): number | null;
  // The live Warden's pit, null while none stands: the next pit is drawn
  // at the death and told to nobody until the rise (ADR 0023).
  wardenPit(): Readonly<WardenPit> | null;
  // The rings' clocks (ADR 0022): the live creature or the next rise and
  // the aspect in play, per ring; empty on a map without rings.
  ringClocks(): readonly RingClock[];
  // The favors a team holds (ADR 0022), every aspect at zero for none.
  teamFavors(team: TeamId): FavorStacks;
  // When a team's Wrath ends (ADR 0022, round two), null when it holds none.
  teamWrath(team: TeamId): number | null;
  // Where to draw a unit this frame when it is not where the world's
  // newest state put it: online, the own champion ahead by the orders on
  // their way (src/net/self_predict.ts, ADR 0028), with the way it walks
  // (null while it stands). Null, or absent offline, draws the world's
  // own position.
  predictedPos?(unitId: number, now: number): { x: number; z: number; heading: Vec2 | null } | null;
  // The battle royale (ADR 0031), online: the mode as the last snapshot
  // told it, with the last caches list and, during the drop, everyone
  // else's picks (src/net/royale_wire.ts RoyaleView); null outside one.
  // Absent offline.
  royale?(): RoyaleView | null;
  // The drop: the landing point picked on the globe, a point on the
  // planet's sphere.
  pickDrop?(p: Vec3): void;
  // Who holds a champion's seat in a battle royale, the name and the bot
  // mark, for a champion the mirror has been told of; null otherwise.
  seat?(unitId: number): SeatLabel | null;
  // y: a point on the planet's sphere carries it (ADR 0029), a point on
  // the plane never does; an aim (Vec2) carries its own.
  orderMove(unitId: number, x: number, z: number, y?: number): void;
  orderAttack(unitId: number, targetId: number): void;
  orderAttackMove(unitId: number, x: number, z: number, y?: number): void;
  orderStop(unitId: number): void;
  startRecall(unitId: number): void;
  castAbility(unitId: number, key: AbilityKey, aim: Vec2): boolean;
  castSigil(unitId: number, slot: number, aim: Vec2): boolean;
  buyItem(unitId: number, itemId: string): boolean;
  sellItem(unitId: number, slot: number): boolean;
  levelAbility(unitId: number, key: AbilityKey): boolean;
}
