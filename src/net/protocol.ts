// The wire protocol, shared verbatim by the server and the client. JSON over
// one WebSocket. Snapshots are team-scoped: the server only sends what the
// client's team can see (the fog of war is enforced server-side), with
// full identity fields sent once per unit per client ("full" vs "lite"
// records, the world-of-claudecraft pattern).

import type { AbilityKey, ScoreRow, TeamId } from '../sim/types';
import type { StructureMeta, UnitKind } from '../sim/unit';

export type ClientMsg =
  | { t: 'hello'; name: string }
  | { t: 'queue' }
  | { t: 'start_now' }
  | { t: 'leave' }
  | { t: 'create_lobby' }
  | { t: 'join_lobby'; code: string }
  | { t: 'start_lobby' }
  | { t: 'pick'; championId: string; sigils: [string, string] }
  | { t: 'move'; x: number; z: number }
  | { t: 'attack'; targetId: number }
  | { t: 'attack_move'; x: number; z: number }
  | { t: 'recall' }
  | { t: 'cast'; key: AbilityKey; x: number; z: number }
  | { t: 'sigil'; slot: number; x: number; z: number }
  | { t: 'buy'; itemId: string }
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
  r?: number;
  rg?: number;
  s?: StructureMeta;
}

export interface SnapMobile {
  i: number;
  x: number;
  z: number;
  r: number;
  t: TeamId;
}

export interface SelfSnap {
  mana: number;
  maxMana: number;
  gold: number;
  level: number;
  xp: number;
  dead: boolean;
  respawnAt: number;
  cooldowns: Partial<Record<AbilityKey, number>>;
  sigilCooldowns: number[];
  items: string[];
  sigils: string[];
  // The client's own full status list, for the HUD chips.
  statuses: { k: string; until: number; v?: number }[];
}

export type SnapEvent =
  | { e: 'death'; unitId: number; killerId: number }
  | { e: 'gold'; amount: number }
  | { e: 'cast'; unitId: number }
  | { e: 'victory'; team: TeamId };

export interface SelectPlayer {
  name: string;
  team: TeamId;
}

export type ServerMsg =
  | { t: 'welcome'; clientId: number }
  | {
      t: 'queue_status';
      count: number;
      needed: number;
      // Seconds until the opt-in bot-filled match starts, null when nobody
      // has opted in; `ready` is whether THIS client opted in.
      startsIn: number | null;
      ready: boolean;
    }
  | { t: 'lobby'; code: string; host: boolean; players: string[] }
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
    }
  | { t: 'score'; rows: ScoreRow[] }
  | { t: 'chat'; from: string; team: TeamId; text: string }
  | { t: 'ping'; from: string; team: TeamId; x: number; z: number }
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
