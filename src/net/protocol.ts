// The wire protocol, shared verbatim by the server and the client. JSON over
// one WebSocket. Snapshots are team-scoped: the server only sends what the
// client's team can see (the fog of war is enforced server-side), with
// full identity fields sent once per unit per client ("full" vs "lite"
// records, the world-of-claudecraft pattern).

import type { CoachOrder, CoachOrderKind } from '../sim/coach';
import type { AspectId, CreatureId, RingId } from '../sim/content/rings';
import type { FavorStacks } from '../sim/favors';
import type { ForgedDisplay } from '../sim/forge/display';
import type { ForgedChampionDef } from '../sim/forge/forged_def';
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
  // for the fallback when the resolver says no.
  | { t: 'pick'; championId: string; sigils: [string, string]; skin?: number; bot?: string }
  // A coach order for the account's own bot seat (ADR 0013): one at a
  // time, free releases it. Refused on any other seat.
  | { t: 'order'; kind: CoachOrderKind; x?: number; z?: number; targetId?: number }
  | { t: 'move'; x: number; z: number }
  | { t: 'attack'; targetId: number }
  | { t: 'attack_move'; x: number; z: number }
  | { t: 'stop' }
  | { t: 'recall' }
  | { t: 'cast'; key: AbilityKey; x: number; z: number }
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
}

// A ring's clock on the wire (ADR 0022): the ring, the live creature's id
// or null, when the next rises or null, and the aspect in play. The
// creature and the ring's place are the map's (ClientWorld.map.rings).
export interface SnapRing {
  r: RingId;
  u: number | null;
  at: number | null;
  a: AspectId;
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
  // The viewer team's Warden's Boon, absent when inactive.
  boonUntil?: number;
  boonStacks?: number;
  // The ENEMY team's Boon, absent when inactive. A team-wide +8 percent per
  // stack is exactly the kind of fact a player must SEE to respect; no
  // vision question applies, the claim is announced to both teams anyway.
  enemyBoonUntil?: number;
  enemyBoonStacks?: number;
  // The favors each team holds (ADR 0022), absent while a team holds
  // none. The enemy's too, like the Boon: a permanent +5 percent armor is
  // a fact a player must see to respect.
  favors?: FavorStacks;
  enemyFavors?: FavorStacks;
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

export interface LobbyPlayer {
  name: string;
  team: TeamId;
}

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
  // account's own finalized forged champions.
  | { t: 'select_start'; team: TeamId; players: SelectPlayer[]; deadline: number; forge?: boolean }
  | { t: 'select_update'; locked: number; total: number; taken: string[] }
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
  | { t: 'match_end' }
  | { t: 'error'; message: string };

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

export function isFiniteVec(x: unknown, z: unknown): boolean {
  return typeof x === 'number' && Number.isFinite(x) && typeof z === 'number' && Number.isFinite(z);
}
