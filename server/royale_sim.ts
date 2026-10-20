// What the server needs of a battle royale's sim (ADR 0031), declared by
// shape so the service stands on its own and its tests run on a fake: the
// world the snapshots read, the mode's state, the orders a person gives,
// the drop, and the seats changing hands between a person and a bot. The
// real one is built by buildRoyaleSim in src/net/replay.ts, the one place
// a match's sim is built (tests/architecture.test.ts).

import type { ReplayPick, RoyaleRecord } from '../src/net/replay';
import type { RoyaleVariant } from '../src/net/royale_wire';
import type { BoutSeedfalls, GoalPrimitive } from '../src/sim/content/bouts/types';
import type { Vec3 } from '../src/sim/geo';
import type { Projectile } from '../src/sim/projectiles';
import type { BoutResult, PendingPrize } from '../src/sim/royale/bouts/ledger';
import type { RegionId } from '../src/sim/royale/layout';
import type { RoyaleCrew, RoyaleEvent, RoyaleState } from '../src/sim/royale/types';
import type { SimEvent } from '../src/sim/sim';
import type { AbilityKey, ScoreRow, Vec2 } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import type { Wall } from '../src/sim/walls';
import type { Zone } from '../src/sim/zones';

// What a tick of the mode answers: the sim's events and the mode's own.
export type RoyaleSimEvent = SimEvent | RoyaleEvent;

export interface RoyaleSim {
  readonly time: number;
  readonly tickCount: number;
  // One team per crew (ADR 0030, ADR 0034): as many teams as seats in Solo.
  readonly teamCount: number;
  readonly units: ReadonlyMap<number, Unit>;
  readonly projectiles: ReadonlyMap<number, Projectile>;
  readonly zones: ReadonlyMap<number, Zone>;
  readonly walls: ReadonlyMap<number, Wall>;
  readonly royale: RoyaleState;
  tick(): readonly RoyaleSimEvent[];
  // A crew is a team (ADR 0030, ADR 0034): a seat sees what its crew's
  // sight shows, its own champion's alone in Solo.
  isVisible(team: number, unitId: number): boolean;
  isPointVisible(team: number, x: number, z: number, y?: number): boolean;
  // Whether a seat sees a zone: its own, an enemy pod only under the seat's
  // own reveal zone, any other while its center is in sight (Sim.zoneSeen).
  zoneSeen(team: number, z: Zone): boolean;
  scoreboard(): readonly ScoreRow[];
  // The landing point a seat picked during the drop.
  pickDrop(unitId: number, p: Vec3): void;
  // From when an order ends the seat's Grace (a Respawn Arrival's floor,
  // Sim.graceFloor); null for none. Optional: a fake has no Grace.
  graceFloor?(unitId: number): number | null;
  // A card of the seat's open Graft offer; false when nothing was taken.
  pickGraft(unitId: number, pick: number): boolean;
  // A Respawn drop-in's Arrival over the globe (Sim.beginArrival).
  beginArrival(unitId: number): void;
  orderMove(unitId: number, x: number, z: number, y?: number): void;
  orderAttack(unitId: number, targetId: number): void;
  orderAttackMove(unitId: number, x: number, z: number, y?: number): void;
  orderStop(unitId: number): void;
  castAbility(unitId: number, key: AbilityKey, aim: Vec2): boolean;
  castSigil(unitId: number, slot: number, aim: Vec2): boolean;
  // A person takes the seat from its bot.
  detachPolicy(unitId: number): void;
  // The sigils and skin that person chose (Sim.setLoadout).
  setLoadout(unitId: number, sigils: readonly string[], skin: number): void;
}

// One seat as the builder takes it, in seat order, on its crew's team.
export interface RoyaleSeatPick {
  name: string;
  team: number;
  championId: string;
  sigils: [string, string];
  skin: number;
  // A bot's seat from the start, and whether the match's people are
  // Guests only, which softens the bots (docs/plan-royale.md); the builder
  // deals each bot its skill from the seed.
  bot?: { softened: boolean };
  // A person who never banked a battle royale award (server/royale_seats.ts
  // RoyalePerson.newcomer): the builder records the seat (RoyaleRecord
  // newcomers) and the mode deals their escorts. Absent for everyone else.
  newcomer?: boolean;
}

// A Thornfray's bout as the factory builds it (ADR 0035; the ledger's
// NextBout, src/sim/royale/bouts/ledger.ts): the match's seed (every bout
// deals the seats' skills from it), the bout's index, kind and Thornyard,
// the seat offered fresh prize cards (the last bout's winner) and the
// prizes carried unpicked, the Grafts each seat carries in, and whether the
// match's people were Guests only (decided once, when its seats were
// dealt, so every bout's bots play alike).
export interface RoyaleBoutArgs {
  matchSeed: number;
  index: number;
  kind: string;
  region: RegionId;
  prize: number | null;
  pendingPrize: readonly PendingPrize[];
  grafts: readonly (readonly string[])[];
  guestsOnly: boolean;
}

// What the server reads of a bout beside its sim, by seat index (the order
// the builder seated them in): the seats best first as the bout stands
// (its ranking once over), the kind's goal primitives as they stand, the
// bout as it ended for the ledger, and the kind's Seedfalls (null when it
// calls none).
export interface BoutHost {
  ranking(): number[];
  primitives(): readonly GoalPrimitive[];
  result(): BoutResult;
  readonly seedfalls: BoutSeedfalls | null;
}

export interface RoyaleBuild {
  sim: RoyaleSim;
  // The unit each pick became, in pick order.
  unitIds: number[];
  // What rebuilds this sim for a replay (src/net/replay.ts): the picks as
  // the builder took them, and the mode's own part of the record.
  replay: {
    picks: readonly ReplayPick[];
    royale: RoyaleRecord;
  };
  // Hands a seat to the battle royale's bot: a person left it.
  standIn(unitId: number): void;
  // A Thornfray's bout: what the server reads of it. Absent in a battle
  // royale.
  bout?: BoutHost;
}

export type RoyaleSimFactory = (
  seed: number,
  variant: RoyaleVariant,
  picks: readonly RoyaleSeatPick[],
  // The crew size (ADR 0034); Solo when absent.
  crew?: RoyaleCrew,
  // A Thornfray's bout (ADR 0035), built by buildBoutSim; a battle royale
  // when absent. A bout runs its kind's death rule, whatever the variant.
  bout?: RoyaleBoutArgs,
) => RoyaleBuild;
