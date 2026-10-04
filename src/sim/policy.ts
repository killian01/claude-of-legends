// The single abstraction behind every bot, scripted or trained (ADR 0002).
// A Policy is deterministic, does zero I/O, and sees only what its team sees
// (the observation is built from team vision; see observe.ts). Contract
// version 0, FROZEN at phase 7: the headless Gym env will expose exactly
// this observation and action space, and changing it breaks every
// community-trained bot, so it is versioned and evolved deliberately.
// The static map (src/sim/content/map.ts) is a known constant of the
// contract; policies may read it directly.

import type { CoachOrder } from './coach';
import type { CampKind } from './content/camps';
import type { ChampionRole } from './content/champions';
import type { AspectId } from './content/rings';
import type { Rng } from './rng';
import type {
  CacheKind,
  DuskState,
  GraftGrade,
  MarkKind,
  RisingKind,
  RoyaleStage,
  RoyaleVariant,
} from './royale/types';
import type { AbilityKey, TeamId } from './types';
import type { UnitKind } from './unit';

export const POLICY_CONTRACT_VERSION = 0;

// A visible status on a champion, the on-screen state ring made observable
// (additive v0 block). Curated to what a human viewer reads off the screen;
// internal bookkeeping statuses (marks, empowers, buff stats) stay hidden.
export interface ObsStatus {
  kind: 'stun' | 'root' | 'airborne' | 'slow' | 'shield';
  until: number;
}

export interface ObsUnit {
  id: number;
  kind: UnitKind;
  friendly: boolean;
  x: number;
  z: number;
  // On the planet's sphere (ADR 0029), the third coordinate (additive v0
  // field, absent on the plane): a point is {x, y, z} on the sphere.
  y?: number;
  hpFrac: number;
  radius: number;
  // Health in points and its cap (additive v0 fields, plan-bots phase 16):
  // the bar every viewer reads, in numbers, so a last hit can be timed.
  hp?: number;
  maxHp?: number;
  // Structures only: true while layer protection makes it immune (additive
  // v0 field; without it a policy cannot know a target is untouchable).
  invulnerable?: boolean;
  // Champions only: a cast mid-windup, the telegraph made observable
  // (additive v0 field). x/z is the LANDING center (the caster itself for
  // bursts and cones), resolveAt the sim time it lands. Fairness mirror of
  // the on-screen telegraph: whoever sees the caster sees the charge.
  windup?: { key: AbilityKey; x: number; z: number; y?: number; resolveAt: number };
  // World-frame velocity in units per second, the motion a viewer sees
  // (additive v0 fields): the dash in flight, else the step toward the next
  // waypoint at effective speed, else zero. Predictive aim reads this.
  vx?: number;
  vz?: number;
  // On the sphere, the velocity's third component (additive v0 field).
  vy?: number;
  // Champions only: visible statuses, absent when there are none (additive
  // v0 field). A policy that ignores them keeps its old behavior.
  statuses?: readonly ObsStatus[];
  // Champions only: which champion this is (additive v0 field, ADR 0014):
  // the face every viewer reads off the screen, so a policy may pick its
  // target by role.
  championId?: string;
  // Champions only: the items in its bag (additive v0 field, plan-bots
  // phase 12): what a viewer reads by clicking a visible champion.
  items?: readonly string[];
  // Champions only: the level on its health bar (additive v0 field,
  // plan-bots phase 16), what the fight's odds weigh a champion by.
  level?: number;
  // Champions only, in the battle royale: the Heartwood Graft it carries
  // (additive v0 field, CONTEXT.md: Graft), shown on it for everyone;
  // absent when none.
  heartwood?: string;
}

// A projectile the team can see (additive v0 block: dodging is impossible
// without it). dir is normalized; homing bolts (auto-attacks) cannot be
// dodged and are flagged so policies skip them.
export interface ObsProjectile {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  // On the sphere (additive v0 fields): the position's and the heading's
  // third components, the heading a tangent at the bolt.
  y?: number;
  dirY?: number;
  speed: number;
  radius: number;
  friendly: boolean;
  homing: boolean;
}

// A ground zone the team can see (additive v0 block). detonateAt is the
// sim time a delayed zone explodes, null for persistent fields.
export interface ObsZone {
  x: number;
  z: number;
  // On the sphere (additive v0 field).
  y?: number;
  radius: number;
  friendly: boolean;
  detonateAt: number | null;
}

// A temporary ability wall (additive v0 block). Walls are terrain: both
// teams see every wall, exactly like the pathing they change.
export interface ObsWall {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  friendly: boolean;
  until: number;
}

// The team's fading memory of an enemy champion that broke line of sight
// (additive v0 block): where it was last seen, when, and how hurt it was.
// The honest mirror of a human remembering who ran into which brush.
// Entries exist only while the champion is alive, OUT of sight, and the
// sighting is fresh; a visible champion appears in `units` instead.
export interface ObsLastSeen {
  id: number;
  x: number;
  z: number;
  // On the sphere (additive v0 field).
  y?: number;
  at: number;
  hpFrac: number;
}

// One of the match's ten seats (additive v0 block, plan-bots phase 12):
// both teams' champions and roles are public from champion select, like
// the scoreboard a viewer opens. `lane` is the seat's assigned lane, given
// for the own team only (the enemy's plan is not on screen); `dead` is the
// death timer every viewer sees.
export interface ObsSeat {
  id: number;
  team: TeamId;
  championId: string;
  role: ChampionRole;
  lane?: 'top' | 'mid' | 'bot' | null;
  dead: boolean;
}

export interface ObsSelf {
  id: number;
  team: TeamId;
  x: number;
  z: number;
  // On the sphere (additive v0 field).
  y?: number;
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
  // Own attack range in units (additive v0 field, ADR 0014): what a kite
  // holds. Absent on observations older than the field.
  attackRange?: number;
  // The auto-attack clock (additive v0 fields, ADR 0014): when the next
  // strike may start, and until when the current swing lands (null when
  // none is in the air). A move order during a swing wastes it; a move
  // between swings costs nothing. This is what orb walking reads.
  attackReadyAt?: number;
  attackSwingUntil?: number | null;
  // Own attack damage in points (additive v0 field, plan-bots phase 16):
  // what one strike takes off an unarmored minion, so a last hit can be
  // timed.
  attackDamage?: number;
  // True while holding still on a stop order (additive v0 field, plan-bots
  // phase 16): idle defense keeps its hands off until the next order.
  holding?: boolean;
  // The ability key whose recast window is armed right now, null otherwise
  // (ADR 0005; additive v0 field). While armed, that key reads ready and
  // the press resolves the follow-up instead of a fresh cast.
  recastArmed?: AbilityKey | null;
  // The lane this participant was assigned (CONTEXT.md: Assigned lane),
  // null for a seat in the forest. Additive v0 field; bots use it to hold
  // a lane instead of flocking.
  lane: 'top' | 'mid' | 'bot' | null;
  // True while the recall channel runs (additive v0 field). A policy that
  // keeps issuing orders would reset its own channel forever without it.
  recalling?: boolean;
  // When an enemy champion last damaged this champion, in sim seconds;
  // null before the first such hit (additive v0 field). Its own health bar
  // tells a person the same: what a trade back answers.
  struckAt?: number | null;
  // The owner's live coach order (ADR 0013; additive v0 field): what the
  // person coaching this seat asked for, null or absent when nothing is.
  coachOrder?: CoachOrder | null;
  // Where the current walk ends, null when standing (additive v0 field):
  // the marker a person sees under their own last click.
  dest?: { x: number; z: number; y?: number } | null;
  // Speed right now, slows and haste included (additive v0 field): what a
  // person reads off their own champion's stride.
  moveSpeed?: number;
}

// A cache as everyone's minimap shows it (the battle royale, ADR 0031):
// still standing, where, golden or not.
export interface ObsCache {
  id: number;
  x: number;
  y: number;
  z: number;
  golden: boolean;
  // What kind of cache it is (additive v0 field): a Seedfall's opens slower
  // and pays more. Absent reads as golden or plain by `golden`.
  kind?: CacheKind;
}

// A Seedfall as everyone sees it (additive v0 block): announced from
// landsAt - 20 s, where it falls, and whether it landed; listed until its
// cache is opened.
export interface ObsSeedfall {
  id: number;
  x: number;
  y: number;
  z: number;
  landsAt: number;
  landed: boolean;
  // The champion opening its cache and since when (additive v0 field):
  // present only while the seat's team sees that champion (sim.isVisible)
  // or the seat opens it itself, absent otherwise, so it stays fog-honest.
  // What a bot waiting on a Seedfall strikes on.
  opener?: { id: number; since: number };
}

// A Rising as everyone sees it (additive v0 block): called ahead, then the
// body's health while it stands.
export interface ObsRising {
  kind: RisingKind;
  x: number;
  y: number;
  z: number;
  risesAt: number;
  up: boolean;
  hpFrac: number;
}

// A champion shown to everyone (additive v0 block): why, its level, and the
// last point shown with when; `at` holds still while the mark is hidden.
export interface ObsMark {
  id: number;
  kind: MarkKind;
  streak?: number;
  level: number;
  at: { x: number; y: number; z: number };
  shownAt: number;
}

// A takedown ringing out (additive v0 block, CONTEXT.md: Clamor): where and
// when, for CLAMOR_S.
export interface ObsClamor {
  x: number;
  y: number;
  z: number;
  at: number;
}

// The seat's own open Graft offer (additive v0 block): the grade, the three
// cards, and when card 0 is taken for it.
export interface ObsGraftOffer {
  grade: GraftGrade;
  cards: readonly [string, string, string];
  until: number;
}

// The battle royale as any player knows it (additive v0 block, present only
// in a battle royale): the stage and its clocks, the Dusk (drawn on the
// ground and the globe for everyone), the caches still standing, the
// pads, and the seat's own share: its landing pick, the cache it is
// opening, its flight, its score, and the leader while shown. Fog-honest:
// nothing here is about another champion's whereabouts except the leader
// at the moments the globe shows them to all.
export interface ObsRoyale {
  variant: RoyaleVariant;
  stage: RoyaleStage;
  dropEndsAt: number;
  endsAt: number;
  dusk: DuskState;
  caches: readonly ObsCache[];
  pads: readonly {
    id: number;
    at: { x: number; y: number; z: number };
    to: { x: number; y: number; z: number };
  }[];
  // The seat's own landing pick during the drop, null before it picks.
  drop: { x: number; y: number; z: number } | null;
  // The cache this seat is opening and since when, null when none.
  opening: { cacheId: number; since: number } | null;
  // True while a launch pad's flight carries this seat.
  flying: boolean;
  score: number;
  // Champions still in (One life) or in the match (Respawn).
  alive: number;
  // Respawn: the score leader, and where they stand while shown.
  leader: { id: number; score: number; at?: { x: number; y: number; z: number } } | null;
  // Additive v0 fields, absent until their rules ship: the seat's open
  // Graft offer and the Grafts it holds; the Seedfalls, the Risings, the
  // marks and the Clamors everyone sees; whether this seat is in its Grace
  // (royale/grace.ts: a drop-in's Arrival or a Respawn return, absent when
  // not), the champions in sight in theirs with when it runs out (no attack
  // or spell touches them; absent when none), and when its Reprieve brings
  // it back (One life), null when none is pending.
  offer?: ObsGraftOffer | null;
  grafts?: readonly string[];
  seedfalls?: readonly ObsSeedfall[];
  risings?: readonly ObsRising[];
  marks?: readonly ObsMark[];
  clamors?: readonly ObsClamor[];
  arriving?: boolean;
  graced?: readonly { id: number; until: number }[];
  reprieveAt?: number | null;
}

// A ring's clock as the team reads it (additive v0 block, ADR 0022): the
// creature alive on it, or when the next rises, and the aspect in play.
// Public to both teams like the Warden's clock and the creature itself.
export interface ObsCreature {
  ring: 'bot' | 'top';
  creature: 'pyrefang' | 'voidmaul';
  x: number;
  z: number;
  // The live creature's unit id, null between rises.
  unitId: number | null;
  // When the next rises, null while one is alive.
  riseAt: number | null;
  // When the live one rose, null between rises (additive v0 field): what
  // a rally counts its windows from.
  roseAt: number | null;
  // The aspect the live creature carries, or the next one will; null
  // when that rise is the Ascendant's (CONTEXT.md).
  aspect: AspectId | null;
  // Whether the live creature, or the next to rise, is the Ascendant.
  ascendant: boolean;
}

// A camp spot as the team knows it (additive v0 block, ADR 0023): where
// it is and what kind of bodies it holds (content/camps.ts), and the
// team's own memory of it: when the spot was last in the team's sight,
// whether bodies stood there then, and since when the team has seen it
// empty; null before the first look. A jungler walks to the spot it
// believes up: never looked at, seen up, or seen empty for the kind's
// respawn clock. Fog-honest: what the team saw, never the sim's truth.
export interface ObsCamp {
  x: number;
  z: number;
  // On the sphere (additive v0 field).
  y?: number;
  kind: CampKind;
  seenAt: number | null;
  up: boolean | null;
  downSince: number | null;
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
  // When the live Warden rose, null between spawns (additive v0 field).
  wardenRoseAt?: number | null;
  // Where the live Warden stands (additive v0 field, ADR 0023); absent
  // while none does: the next pit is drawn at the death and told to
  // nobody until the rise, a bot guesses like a human.
  wardenPit?: { x: number; z: number };
  // The rings' clocks (additive v0 field, ADR 0022), empty on a map
  // without rings.
  creatures?: readonly ObsCreature[];
  // The forests' camps as the team knows them (additive v0 field, ADR
  // 0023; see ObsCamp).
  camps?: readonly ObsCamp[];
  // Threats in flight and on the ground, filtered by team vision (additive
  // v0 fields; a policy that ignores them keeps its old behavior).
  projectiles?: readonly ObsProjectile[];
  zones?: readonly ObsZone[];
  // Ability walls, visible to both teams like the terrain they are
  // (additive v0 field).
  walls?: readonly ObsWall[];
  // Fresh memories of enemy champions currently out of sight (additive v0
  // field; see ObsLastSeen).
  lastSeen?: readonly ObsLastSeen[];
  // The match's seats, both teams (additive v0 field; see ObsSeat).
  seats?: readonly ObsSeat[];
  // The team's lane opponents (CONTEXT.md; additive v0 field): per lane,
  // the id of the enemy champion the team has seen there the most over
  // the last three minutes, null where nobody was seen.
  laneOpponents?: Readonly<Record<'top' | 'mid' | 'bot', number | null>>;
  // Seconds enemy champions were seen in each lane over the last minute
  // (additive v0 field): how busy each lane is, for a split push.
  laneActivity?: Readonly<Record<'top' | 'mid' | 'bot', number>>;
  // The battle royale (additive v0 block; see ObsRoyale), absent elsewhere.
  royale?: ObsRoyale;
}

export type Action =
  | { kind: 'noop' }
  // On the sphere a point carries y as well (additive v0 field).
  | { kind: 'move'; x: number; z: number; y?: number }
  | { kind: 'attack'; targetId: number }
  | { kind: 'cast'; key: AbilityKey; x: number; z: number; y?: number }
  | { kind: 'sigil'; slot: number; x: number; z: number; y?: number }
  | { kind: 'buy'; itemId: string }
  // Spends one skill point (free action, outside the decision budget).
  | { kind: 'level'; key: AbilityKey }
  // Starts the recall channel (additive v0 action): the same B humans
  // press, with the same rules (standing still, damage cancels).
  | { kind: 'recall' }
  // Sells the item in a bag slot (additive v0 action, ADR 0014): the same
  // rule humans get, at the fountain, for seventy percent of its price.
  | { kind: 'sell'; slot: number }
  // Stops and holds (additive v0 action, plan-bots phase 16): the same S
  // humans press, opting out of idle defense until the next order. What a
  // wave freeze stands on. An intention like move, outside the budget.
  | { kind: 'stop' }
  // The battle royale's landing pick during the drop (additive v0 action):
  // the same pick a person makes on the globe (Sim.pickDrop).
  | { kind: 'drop'; x: number; y: number; z: number }
  // The battle royale's Graft pick (additive v0 action): one of the open
  // offer's three cards, the same pick a person makes. Free like 'level'
  // and 'drop' (no decision token), accepted while dead, flying or in the
  // drop.
  | { kind: 'graft'; pick: 0 | 1 | 2 };

export type Policy = (obs: Observation, rng: Rng) => Action;
