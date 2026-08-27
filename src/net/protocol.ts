// The wire protocol, shared verbatim by the server and the client. JSON over
// one WebSocket. Snapshots are team-scoped: the server only sends what the
// client's team can see (the fog of war is enforced server-side), with
// full identity fields sent once per unit per client ("full" vs "lite"
// records, the world-of-claudecraft pattern).

import type { AbilityKey, ScoreRow, TeamId } from '../sim/types';
import type { StructureMeta, UnitKind } from '../sim/unit';

export type ClientMsg =
  // token: the session token from a previous welcome; presenting it lets
  // the server hand back a seat abandoned by a dropped connection.
  | { t: 'hello'; name: string; token?: string }
  | { t: 'queue' }
  | { t: 'start_now' }
  | { t: 'leave' }
  | { t: 'create_lobby' }
  | { t: 'join_lobby'; code: string }
  // Pick your side in a private lobby (duo vs bots needs a team choice;
  // seats used to alternate by join order with no way to play together).
  | { t: 'lobby_team'; team: TeamId }
  | { t: 'start_lobby' }
  | { t: 'pick'; championId: string; sigils: [string, string]; skin?: number }
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
  // token identifies this browser across connections, for match rejoin.
  | { t: 'welcome'; clientId: number; token: string }
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
  | { t: 'select_start'; team: TeamId; players: SelectPlayer[]; deadline: number }
  | { t: 'select_update'; locked: number; total: number; taken: string[] }
  | { t: 'match_start'; selfUnitId: number; team: TeamId }
  | {
      t: 'snap';
      time: number;
      units: SnapUnit[];
      gone: number[];
      projectiles: SnapMobile[];
      zones: SnapMobile[];
      self: SelfSnap | null;
      events: SnapEvent[];
      winner: TeamId | null;
      // When the next Warden rises; null while one is alive.
      objAt?: number | null;
    }
  | { t: 'score'; rows: ScoreRow[] }
  | { t: 'chat'; from: string; team: TeamId; text: string }
  | { t: 'ping'; from: string; team: TeamId; x: number; z: number }
  // A teammate's connection dropped; a bot policy took the seat over.
  | { t: 'player_left'; name: string; team: TeamId }
  // A dropped teammate reconnected and took their champion back.
  | { t: 'player_back'; name: string; team: TeamId }
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
