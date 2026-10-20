// The bout contract (CONTEXT.md: Bout; ADR 0035; docs/design/thornfray.md,
// The bout contract): everything one kind of bout declares, as data with
// references. A kind is one file beside this one, registered in one line
// of index.ts; what it brings of its own (a scorer, a goal) is a reference
// on it, never a case in a shared switch. The engine that reads every
// field lives under src/sim/royale/ (the seams) and src/sim/royale/bouts/
// (the plan, the ledger, the arc, the counts, the goals, the end, the
// observation). Planet rules: out of the content fingerprint, like
// content/royale_tuning.ts; a kind's own data is fingerprinted on its own
// (index.ts boutFingerprint).

import type { Vec3 } from '../../geo';
import type { Rng } from '../../rng';
import type { RegionId } from '../../royale/layout';
import type { CacheKind, RoyaleVariant } from '../../royale/types';
import type { SimEvent } from '../../sim';

// A kind's id: the record's and the wire's ('lastwick').
export type BoutKindId = string;

// One closing of a bout's Dusk inside its Thornyard, seconds from landing:
// the chord radius it closes to, when it closes and holds, and the share
// of maximum health burned each second outside the light meanwhile.
export interface BoutClosing {
  radius: number;
  closeFrom: number;
  closeTo: number;
  holdTo: number;
  burn: number;
}

// A bout's Dusk (ADR 0035, The Dusk's phase numbers keep their meaning):
// its closings in order, one to five, numbered from the end (the last is
// always phase 5, the dark always 6); how fast its edge may move; the burn
// outside the Thornyard from the first second until the first closing;
// when the last light goes out.
export interface BoutDusk {
  closings: readonly BoutClosing[];
  edgeSpeed: number;
  burnBefore: number;
  lightOutS: number;
}

// The planet's systems a bout runs, each off unless named; the caches run
// when the kind stands any (BoutCaches.count) and the Seedfalls when it
// declares them (BoutKind.seedfalls). The Risings rise at their own times,
// seconds from landing, and only those named; a camp, a ring or the Warden
// a bout leaves out never stands on its map (src/net/replay.ts
// buildBoutSim).
export interface BoutSystems {
  pads?: boolean;
  burr?: boolean;
  lastLight?: boolean;
  marks?: boolean;
  clamors?: boolean;
  upstart?: boolean;
  camps?: boolean;
  risings?: { pyrefang?: number; voidmaul?: number; warden?: number };
}

// The systems a bout may switch on by name.
export type BoutSystem = Exclude<keyof BoutSystems, 'risings'>;

// How many caches stand at landing inside the Thornyard (its golden spots
// first), never more than its spots allow less two per Seedfall seed, and
// when an opened one comes back: never (null) or after these seconds.
export interface BoutCaches {
  count: number;
  backS: number | null;
}

// A bout's Seedfalls: when each burst lands (seconds from landing), how
// many seeds at once, how far ahead each is called, how far past the
// impact the light is read for placing them, how far every seed of a burst
// stands from every other, and how deep inside that light.
export interface BoutSeedfalls {
  at: readonly number[];
  seeds: number;
  warnS: number;
  forecastS: number;
  apartM: number;
  depthM: number;
}

// The closed set of goal primitives (ADR 0035): observed
// (ObsRoyale.bout.goals), wired and drawn by the engine for every kind.
export type GoalShape = 'circle' | 'carrier' | 'target';

export interface GoalPrimitive {
  shape: GoalShape;
  at: Vec3;
  radius: number;
  // The seat that holds it (a seat index), null when nobody does.
  holder: number | null;
}

// A goal's state on the bout: the primitives it stands and the numbers it
// keeps, plain data the mode snapshots and restores with the rest.
export interface GoalSlot {
  prims: GoalPrimitive[];
  nums: number[];
}

// A seat as a scorer and a goal read it.
export interface BoutSeatView {
  seat: number;
  unitId: number;
  pos: Vec3 | null;
  hp: number;
  maxHp: number;
  dead: boolean;
}

// The bout as its scorer and goals see it (src/sim/royale/bouts/goals.ts
// builds it): the clocks, the seats, the counts a scorer writes, and the
// goals' slots.
export interface BoutView {
  readonly time: number;
  readonly tick: number;
  readonly landAt: number;
  // The bout's index in the match, 0 for the first, 5 for the Final.
  readonly index: number;
  readonly thornyard: { center: Vec3; radius: number };
  // The bout's stream (the bout's Sim is seeded with the bout's seed).
  readonly rng: Rng;
  // How many seats, and each seat's count, by seat index.
  readonly seatCount: number;
  readonly counts: number[];
  seatOf(unitId: number): number | null;
  seat(seat: number): BoutSeatView | null;
  // A seat's health on the tick before this one (One life's placing).
  hpBefore(seat: number): number;
  cacheKind(cacheId: number): CacheKind | null;
  goal(id: string): GoalSlot;
  // Every goal's primitives as they stand, in the kind's order.
  primitives(): readonly GoalPrimitive[];
}

// A kind's goal: starts and steps its primitives on the bout's stream.
export interface BoutGoal {
  id: string;
  start(bout: BoutView, rng: Rng): void;
  step(bout: BoutView, events: readonly SimEvent[]): void;
  primitives(bout: BoutView): readonly GoalPrimitive[];
}

// A kind's count: set at landing, then fed every tick's events by the mode,
// the damage events included, writing the bout's counts only.
export interface BoutScorer {
  id: string;
  start?(bout: BoutView): void;
  onEvents(events: readonly SimEvent[], bout: BoutView): void;
}

// The tie-breaks after the count, in order (src/sim/royale/bouts/end.ts):
// more Seedfall caches opened, fewer falls, the earlier tick the count was
// reached, more health (before the fall for a fallen seat, now for one
// standing), the lower seat. Every list ends on 'seat'.
export type BoutTie = 'seedfalls' | 'falls' | 'reached' | 'health' | 'seat';

// What a kind's bots read in place of the fifty seat tunings (its numbers
// in src/sim/content/bots/bout_skills.ts, read by the brain's bout branch
// under src/sim/royale/bot/): the errand asked after the fight block, an
// entry of BOUT_CALLS (src/sim/royale/bot/bout_calls.ts), or null for
// none; the errand's health floor and reach (meters); the Dusk margin as a
// share of the skill's; the cornered light (meters: under it a bot stops
// fleeing); the nerve One life's calm adds (phase 0, unless struck; 0 for
// none); the pace (null for none, or the champions still in at each minute
// from the landing, as royale_skills.ts ONE_LIFE_PACE counts fifty).
export interface BoutBots {
  errand: string | null;
  floor: number;
  reach: number;
  duskMargin: number;
  cornered: number;
  calm: number;
  pace: readonly number[] | null;
}

// The count's word on the top line ('gleaned', 'left'), and whether the
// count reads as a place rather than a number.
export interface BoutHud {
  word: string;
  place: boolean;
}

export interface BoutKind {
  id: BoutKindId;
  name: string;
  // The rule in one line, under 40 characters: the Lull's head, the win line.
  rule: string;
  // Two or three short lines for the bout's card at the landing.
  card: readonly string[];
  // The version of the kind's own modules (its scorer, its goals).
  version: number;
  // In the pool or not; a kind in progress stays out.
  released: boolean;
  // The death rule: out for the bout, or back in five seconds.
  base: RoyaleVariant;
  // Seconds from landing to the bout's clock end, 90 to 120.
  playS: number;
  // Its chord radius and the regions it may stand in (all six when absent).
  thornyard: { radius: number; regions?: readonly RegionId[] };
  dusk: BoutDusk;
  systems: BoutSystems;
  caches: BoutCaches;
  seedfalls?: BoutSeedfalls;
  goals?: readonly BoutGoal[];
  count: BoutScorer;
  ties: readonly BoutTie[];
  bots: BoutBots;
  hud: BoutHud;
}
