// The wire protocol, shared verbatim by the server and the client. JSON over
// one WebSocket. Snapshots are team-scoped: the server only sends what the
// client's team can see (the fog of war is enforced server-side), with
// full identity fields sent once per unit per client ("full" vs "lite"
// records, the world-of-claudecraft pattern).

import type { CoachOrder, CoachOrderKind } from '../sim/coach';
import type { CampKind } from '../sim/content/camps';
import type { LaneId } from '../sim/content/map';
import type { AspectId, CreatureId, RingId } from '../sim/content/rings';
import type { FavorStacks } from '../sim/favors';
import type { ForgedDisplay } from '../sim/forge/display';
import type { ForgedChampionDef } from '../sim/forge/forged_def';
import type { LanePreference } from '../sim/playbook/types';
import type { AbilityKey, ScoreRow, TeamId } from '../sim/types';
import type { StructureMeta, UnitKind } from '../sim/unit';

// The sealed asset pointers a match carries per forged champion, so every
// client in it can load the generated model: the model path is relative to
// the asset route, family picks the default weapon prop, display is the
// workshop's saved tuning.
export interface ForgedMatchAssets {
  model: string | null;
  family: string | null;
  // The champion's own generated weapon GLB (relative asset path), if built.
  weapon: string | null;
  // The exact baked clip name per renderer role (idle, run, attack, cast,
  // death), as the creator picked them; null on models sealed before the
  // pick existed (the renderer then falls back to name matching).
  clips: Record<string, string> | null;
  // Per-role animation-only GLBs riding beside a rigged model (relative
  // asset paths): the per-clip bake architecture. Null when the model is
  // a single self-contained file (pre-split bakes, and the mock).
  clipFiles: Record<string, string> | null;
  display: ForgedDisplay | null;
  // The creator's chosen spell icon per slot (Q W E R), relative asset
  // paths, so the champion's HUD wears its own art; empty when none was
  // chosen (the procedural painting stands in). Absent on blocks saved
  // before icons traveled: the client then keeps the painting.
  icons?: Record<string, string>;
}

export type ClientMsg =
  // Carries no identity: the session cookie settled that on the upgrade
  // (ADR 0006). It only asks whether a live match is still holding this
  // account's seat, so a dropped connection can claim it back.
  | { t: 'hello' }
  // forge: enter the Forge queue instead (plan-forge phase 6), where
  // select also offers the account's finalized forged champions.
  | { t: 'queue'; forge?: boolean }
  | { t: 'start_now' }
  | { t: 'leave' }
  | { t: 'create_lobby' }
  | { t: 'join_lobby'; code: string }
  // Pick your side in a private lobby (duo vs bots needs a team choice;
  // seats used to alternate by join order with no way to play together).
  | { t: 'lobby_team'; team: TeamId }
  | { t: 'start_lobby' }
  // Host only: the whole lobby enters the public queue as one party,
  // landing on the same side of whatever match forms.
  | { t: 'queue_party' }
  // Watch a live match from one team's point of view (fog included): the
  // server answers with match_start carrying selfUnitId 0, then streams
  // that team's snapshots with self null.
  | { t: 'spectate'; matchId: number; team: TeamId }
  // bot: lock the account's own bot into this seat (ADR 0013); the bot's
  // champion, sigils and skin replace the three fields, which still ride
  // for the fallback when the resolver says no. lane: the seat's lane
  // preference (ADR 0026), claimed with the lock when it was not before;
  // a full lane keeps the seat's earlier claim.
  | {
      t: 'pick';
      championId: string;
      sigils: [string, string];
      skin?: number;
      bot?: string;
      lane?: LanePreference;
    }
  // A lane claim at champion select, before Lock in (ADR 0026): first come,
  // first served inside the team, answered with a select_update either
  // way, so a refused claim reverts. Meaningless once the match runs.
  | { t: 'lane'; lane: LanePreference }
  // The match is on screen at last (src/main.ts, once its models are in):
  // what the seat report's load time reads (server/seat_report.ts). Never
  // a match command.
  | { t: 'loaded' }
  // The echo of the server's round-trip probe, sent back at once.
  | { t: 'probe'; n: number }
  // A first step done in this match, or 'off' when the player hid the
  // guide (src/ui/first_steps.ts): what the seat report says of how far
  // a newcomer was led (server/seat_report.ts). Never a match command.
  | { t: 'step'; id: string }
  // A coach order for the account's own bot seat (ADR 0013): one at a
  // time, free releases it. Refused on any other seat.
  | { t: 'order'; kind: CoachOrderKind; x?: number; z?: number; targetId?: number }
  // n: the order's number in this connection's sequence, for the own
  // champion's prediction (src/net/self_predict.ts): the server tells which
  // it has applied (SelfSnap ack), so the client knows which of its orders
  // the newest state already holds. Never recorded in a replay.
  | { t: 'move'; x: number; z: number; n?: number }
  | { t: 'attack'; targetId: number; n?: number }
  | { t: 'attack_move'; x: number; z: number; n?: number }
  | { t: 'stop'; n?: number }
  | { t: 'recall'; n?: number }
  | { t: 'cast'; key: AbilityKey; x: number; z: number; n?: number }
  | { t: 'sigil'; slot: number; x: number; z: number }
  | { t: 'buy'; itemId: string }
  | { t: 'sell'; slot: number }
  | { t: 'skill'; key: AbilityKey }
  | { t: 'chat'; text: string }
  | { t: 'ping'; x: number; z: number };

// Lite fields ride every snapshot; the optional identity block only on the
// first snapshot after the unit (re)enters this client's vision.
export interface SnapUnit {
  i: number;
  x: number;
  z: number;
  h: number;
  m: number;
  l?: number;
  // Dead flag (champions linger while dead for their own team).
  d?: 1;
  // Active display-relevant statuses (crowd control), with an optional value.
  st?: { k: string; v?: number }[];
  k?: UnitKind;
  t?: TeamId;
  c?: string | null;
  // Cosmetic skin index (champions), identity block only.
  sk?: number;
  r?: number;
  rg?: number;
  s?: StructureMeta;
  // Pending windup cast: ability key, aim point, and resolve time. Rides
  // every snapshot while the champion charges, so BOTH teams see the
  // telegraph (the counterplay window is only fair if it is visible).
  w?: { k: AbilityKey; x: number; z: number; u: number };
  // The active play of an ALLIED bot (ADR 0013), for the overlay. Never
  // sent for the other team: a bot's decisions are its own team's business.
  p?: string;
  // The coach order an ALLIED bot stands under (ADR 0013), for the coach
  // bar to answer with what the sim holds rather than what was clicked.
  // Team-scoped like the play.
  co?: CoachOrder;
  // A ring creature's identity and the aspect it carries (ADR 0022),
  // identity block only: both are fixed for the creature's life.
  cr?: CreatureId;
  a?: AspectId;
  // 1 on an Ascendant (CONTEXT.md): the bigger body, the Wrath on its death.
  asc?: 1;
  // A camp body's kind (content/camps.ts), in the identity block.
  ck?: CampKind;
}

// A ring's clock on the wire (ADR 0022): the ring, the live creature's id
// or null, when the next rises or null, and the aspect in play. The
// creature and the ring's place are the map's (ClientWorld.map.rings).
export interface SnapRing {
  r: RingId;
  u: number | null;
  at: number | null;
  // The aspect in play, null when the rise is the Ascendant's.
  a: AspectId | null;
  // 1 when the live creature, or the next to rise, is the Ascendant.
  asc?: 1;
  // When the live creature rose; absent between rises.
  ro?: number;
}

export interface SnapMobile {
  i: number;
  x: number;
  z: number;
  r: number;
  t: TeamId;
  // Cosmetic ability tag ('championId_KEY' or 'sigil_id'); absent for auto
  // attacks. Clients pick per-ability visuals from it.
  v?: string;
  // Shooter's unit id (projectiles only), so renderers can spawn the bolt
  // at the weapon's muzzle. Cosmetic: hit tests stay on the sim positions.
  s?: number;
  // The unit a homing bolt flies at (projectiles only), when that unit is in
  // the recipient's sight: what lets the renderer tell a tower's shot and
  // draw its authored missile rather than a plain bolt. Cosmetic.
  h?: number;
}

// An ability wall (kits-v2): terrain both teams always see, so it never
// fog-scopes. Endpoints plus expiry; the client draws and drops it.
export interface SnapWall {
  i: number;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  t: TeamId;
  u: number;
}

export interface SelfSnap {
  mana: number;
  maxMana: number;
  // Current attack damage, for the client's last-hit indicator.
  ad: number;
  gold: number;
  level: number;
  xp: number;
  dead: boolean;
  respawnAt: number;
  cooldowns: Partial<Record<AbilityKey, number>>;
  // Effective ability ranks and unspent skill points, for the HUD pips.
  abilityRanks: Record<AbilityKey, number>;
  skillPoints: number;
  sigilCooldowns: number[];
  items: string[];
  sigils: string[];
  // The client's own full status list, for the HUD chips.
  statuses: { k: string; until: number; v?: number }[];
  // The seat's assigned lane (CONTEXT.md; ADR 0026), null for a seat in
  // the forest. Every snapshot, so setup, a rejoin, a drop-in and a seat
  // changing hands all tell it with no message of their own. Never on
  // anything the other team receives.
  lane: LaneId | null;
  // The viewer team's Warden's Boon, absent when inactive.
  boonUntil?: number;
  boonStacks?: number;
  // The ENEMY team's Boon, absent when inactive. A team-wide +8 percent per
  // stack is exactly the kind of fact a player must SEE to respect; no
  // vision question applies, the claim is announced to both teams anyway.
  enemyBoonUntil?: number;
  enemyBoonStacks?: number;
  // Both teams' Wraths (CONTEXT.md), when each ends; absent when none.
  wrathUntil?: number;
  enemyWrathUntil?: number;
  // The favors each team holds (ADR 0022), absent while a team holds
  // none. The enemy's too, like the Boon: a permanent +5 percent armor is
  // a fact a player must see to respect.
  favors?: FavorStacks;
  enemyFavors?: FavorStacks;
  // What the own champion's prediction walks on (src/net/self_predict.ts,
  // ADR 0028): the speed the champion walks at once no root holds it, its
  // attack range, the path it still has to walk as x, z pairs (absent
  // when none), the unit it is set on attacking (absent when none), and
  // whether a dash carries it. ack is the number of the last order of
  // this connection the server applied (0 before any) and ackAt the match
  // time it applied it.
  ms: number;
  rg: number;
  path?: number[];
  tgt?: number;
  dash?: 1;
  ack: number;
  ackAt: number;
}

export type SnapEvent =
  | { e: 'death'; unitId: number; killerId: number }
  | { e: 'gold'; amount: number }
  // The ability key rides along so clients can pick per-spell cast visuals
  // and sounds; sigil casts relay without one.
  | { e: 'cast'; unitId: number; k?: AbilityKey }
  // Personal: damage THIS client dealt to another unit, for its own
  // floating combat numbers only.
  | { e: 'dmg'; targetId: number; amount: number }
  // A visible unit fired an auto-attack; drives swing animations.
  | { e: 'atk'; unitId: number; targetId: number }
  | { e: 'victory'; team: TeamId };

export interface SelectPlayer {
  name: string;
  team: TeamId;
}

// One seat of the recipient's own team at champion select (ADR 0026): its
// index in select_start's players (names are not unique: two Guests can
// share one), the lane it claimed, and whether it locked in.
export interface SelectClaim {
  seat: number;
  lane: LanePreference | null;
  locked: boolean;
}

export interface LobbyPlayer {
  name: string;
  team: TeamId;
}

// Why a seat earned points (server/points.ts, ADR 0027): a minion or camp
// last hit, a champion kill or an assist, a tower the team took, a ring
// creature or the Warden, an Ascendant, the win, or a loss played through.
export type PointsReason =
  | 'last_hit'
  | 'kill'
  | 'assist'
  | 'tower'
  | 'creature'
  | 'ascendant'
  | 'victory'
  | 'finish';

export type ServerMsg =
  // The account this socket belongs to, so the client can show who it is
  // logged in as without a second round trip.
  | { t: 'welcome'; clientId: number; name: string }
  | {
      t: 'queue_status';
      count: number;
      needed: number;
      // Seconds until the opt-in bot-filled match starts, null when nobody
      // has opted in; `ready` is whether THIS client opted in.
      startsIn: number | null;
      ready: boolean;
    }
  // team is the recipient's own side; players carry everyone's.
  | { t: 'lobby'; code: string; host: boolean; team: TeamId; players: LobbyPlayer[] }
  // forge marks a Forge-queue select, so the client also offers the
  // account's own finalized forged champions. self is the recipient's own
  // index in players.
  | {
      t: 'select_start';
      team: TeamId;
      players: SelectPlayer[];
      self: number;
      deadline: number;
      forge?: boolean;
    }
  // taken and claims are the recipient's own team only, never the other
  // side's: its locked champions, and every seat's lane claim (ADR 0026).
  | { t: 'select_update'; locked: number; total: number; taken: string[]; claims: SelectClaim[] }
  // forged: the match's forged champion definitions, embedded whole
  // (ADR 0010), so every client and spectator can resolve them before the
  // first snapshot names one. Absent for roster-only matches. forgedAssets
  // rides beside it, keyed by forged id: the sealed model path (relative,
  // for the asset route), the weapon family, and the workshop's display
  // tuning, so every client renders the generated model, not the figure.
  | {
      t: 'match_start';
      selfUnitId: number;
      team: TeamId;
      // This seat is the account's own bot: the client coaches it and the
      // hands-on verbs are refused (ADR 0013).
      coach?: true;
      // A bot's seat taken in a match already under way (ADR 0025).
      dropIn?: true;
      forged?: ForgedChampionDef[];
      forgedAssets?: Record<string, ForgedMatchAssets>;
    }
  | {
      t: 'snap';
      time: number;
      units: SnapUnit[];
      gone: number[];
      projectiles: SnapMobile[];
      zones: SnapMobile[];
      // Ability walls; optional so pre-wall replays still parse.
      walls?: SnapWall[];
      self: SelfSnap | null;
      events: SnapEvent[];
      winner: TeamId | null;
      // When the next Warden rises; null while one is alive.
      objAt?: number | null;
      // The live Warden's pit, an index into the map's pits (ADR 0023);
      // absent while none stands, since the next pit is told at the rise.
      objPit?: number;
      // The rings' clocks (ADR 0022); absent on a map without rings.
      rings?: SnapRing[];
    }
  | { t: 'score'; rows: ScoreRow[] }
  | { t: 'chat'; from: string; team: TeamId; text: string }
  | { t: 'ping'; from: string; team: TeamId; x: number; z: number }
  // A teammate's connection dropped; a bot policy took the seat over.
  | { t: 'player_left'; name: string; team: TeamId }
  // A dropped teammate reconnected and took their champion back.
  | { t: 'player_back'; name: string; team: TeamId }
  // The round-trip probe (server/seat_report.ts): the client echoes it at
  // once, and the time to the echo is the round trip the player lives.
  | { t: 'probe'; n: number }
  // Someone took a bot's seat mid-match (ADR 0025); sent to everyone.
  | { t: 'player_joined'; name: string; team: TeamId }
  // Sent once to each human player when the finished match is recorded:
  // this player's rating movement (zero and rated:false when unrated).
  // queue 'forge' means the numbers are the Forge queue's own rating
  // (ADR 0011), not the classic ladder's.
  // way 'bot' means the numbers are the account's bot rating, live.
  | {
      t: 'match_result';
      rated: boolean;
      delta: number;
      rating: number;
      queue?: 'forge';
      way?: 'bot';
    }
  // Points this player's seat just banked on the ladder (ADR 0027), sent
  // to that player alone: what landed, the ladder total it makes, and why.
  | { t: 'points'; delta: number; total: number; reason: PointsReason }
  | { t: 'match_end' }
  | { t: 'error'; message: string };

// The first steps a newcomer is led through, in the order they are tried
// (src/ui/first_steps.ts, CONTEXT.md: First steps). Here because the
// server reads them off the wire for the seat report.
export const STEP_IDS = [
  'learn',
  'low_health',
  'spell',
  'last_hit',
  'recall',
  'tower',
  'level_up',
  'go_shop',
  'gold',
  'goal',
] as const;
export type StepId = (typeof STEP_IDS)[number];

// A step's id off the wire: a known step, or 'off' for the guide hidden;
// anything else is nothing.
export function stepOnWire(id: unknown): StepId | 'off' | null {
  if (id === 'off') return 'off';
  return typeof id === 'string' && (STEP_IDS as readonly string[]).includes(id)
    ? (id as StepId)
    : null;
}

// Loose structural parse; each handler validates its own fields before use.
export function parseClientMsg(raw: string): ClientMsg | null {
  try {
    const m: unknown = JSON.parse(raw);
    if (typeof m === 'object' && m !== null && typeof (m as { t?: unknown }).t === 'string') {
      return m as ClientMsg;
    }
  } catch {
    // fall through
  }
  return null;
}

// The select's own messages: they mean something before the match only,
// so one that arrives late (a click racing match_start) is never a match
// command, neither recorded on the replay nor counted as play.
export function isSelectMsg(msg: { t: string }): boolean {
  return msg.t === 'pick' || msg.t === 'lane';
}

export function isFiniteVec(x: unknown, z: unknown): boolean {
  return typeof x === 'number' && Number.isFinite(x) && typeof z === 'number' && Number.isFinite(z);
}
