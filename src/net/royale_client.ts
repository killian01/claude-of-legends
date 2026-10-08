// The client's side of the battle royale on the wire (ADR 0031): entering
// a match over the session's socket, and reading back what the server
// sends for the mode: the result at the end, the mode's events and the
// names a death carries on a snapshot. The landing point picked during the
// drop goes through the world (IWorld.pickDrop). The message shapes are
// net/royale_wire.ts; the reading is tolerant, since a field the server
// does not send yet must cost nothing but the line that would show it.

import type {
  LastLightStep,
  MarkKind,
  RisingKind,
  RoyaleClientMsg,
  RoyaleResult,
  RoyaleVariant,
  WirePoint,
} from './royale_wire';

export interface RoyaleEntry {
  championId: string;
  sigils: [string, string];
  skin: number;
}

// Enter a battle royale: a running match that takes people, else a new
// one at once (ADR 0025's drop in). The server answers with match_start
// like any match, then snapshots carrying the mode.
export function royaleEnterMsg(
  variant: RoyaleVariant,
  pick: RoyaleEntry,
): Extract<RoyaleClientMsg, { t: 'royale' }> {
  return {
    t: 'royale',
    v: variant,
    championId: pick.championId,
    sigils: [pick.sigils[0], pick.sigils[1]],
    skin: pick.skin,
  };
}

export function startRoyale(
  send: (msg: RoyaleClientMsg) => void,
  variant: RoyaleVariant,
  pick: RoyaleEntry,
): void {
  send(royaleEnterMsg(variant, pick));
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// A server message that is the battle royale's result for this person.
export function isRoyaleResult(msg: unknown): msg is RoyaleResult {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Partial<Record<keyof RoyaleResult, unknown>>;
  return (
    m.t === 'royale_result' &&
    (m.v === 'respawn' || m.v === 'one_life') &&
    num(m.place) &&
    num(m.of) &&
    num(m.score) &&
    (m.winner === null || typeof m.winner === 'string') &&
    Array.isArray(m.top) &&
    m.top.every(
      (t: unknown) =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as { name?: unknown }).name === 'string' &&
        typeof (t as { championId?: unknown }).championId === 'string' &&
        num((t as { score?: unknown }).score),
    )
  );
}

// The mode's events as the HUD reads them (src/sim/royale/types.ts
// RoyaleEvent), forwarded on a snapshot's events with the tag in `e` like
// every snapshot event, or in `type` as the sim names it.
export type RoyaleNote =
  | { kind: 'land'; unitId: number }
  | {
      kind: 'loot';
      unitId: number;
      itemId: string;
      source: 'cache' | 'camp' | 'takedown';
    }
  | { kind: 'cache'; unitId: number; cacheId: number }
  | { kind: 'pad'; unitId: number; padId: number }
  | { kind: 'dusk'; phase: number }
  | { kind: 'out'; unitId: number; killerId: number; place: number }
  | { kind: 'leader'; unitId: number }
  | { kind: 'end'; winnerId: number | null }
  | { kind: 'seedfall'; id: number; at: WirePoint; landsAt: number }
  | { kind: 'seedfall_land'; id: number; at: WirePoint }
  | { kind: 'rising'; rising: RisingKind; at: WirePoint; risesAt: number }
  // The names the server sends beside the hunted's notes (the champion
  // marked, the Wrath's new holder, the snuffed and their killer), when it
  // sends them.
  | { kind: 'wrath_passed'; from: number; to: number | null; name?: string }
  | { kind: 'mark'; unitId: number; mark: MarkKind; name?: string }
  | {
      kind: 'snuffed';
      unitId: number;
      killerId: number;
      streak: number;
      name?: string;
      killerName?: string;
    }
  | { kind: 'reprieve'; unitId: number; backAt: number }
  | { kind: 'hastens'; by: number; alive: number }
  | { kind: 'last_light'; step: LastLightStep }
  | { kind: 'pad_slam'; unitId: number; at: WirePoint; hit: number[] };

// A point on the wire, or on the sim's event ({x, y, z}).
function pointOf(v: unknown): WirePoint | null {
  if (Array.isArray(v) && v.length === 3) {
    const [x, y, z] = v as unknown[];
    if (num(x) && num(y) && num(z)) return [x, y, z];
  }
  if (typeof v === 'object' && v !== null) {
    const p = v as { x?: unknown; y?: unknown; z?: unknown };
    if (num(p.x) && num(p.y) && num(p.z)) return [p.x, p.y, p.z];
  }
  return null;
}

// A name the server sent, as an optional field of a note.
function nameOf<K extends string>(v: unknown, key: K): Partial<Record<K, string>> {
  return typeof v === 'string' && v.length > 0 ? ({ [key]: v } as Record<K, string>) : {};
}

const RISINGS: readonly string[] = ['pyrefang', 'voidmaul', 'warden'];
const MARKS: readonly string[] = ['lodestar', 'ablaze', 'wrath', 'slayer'];
const LAST_LIGHT: readonly string[] = ['heads_up', 'double', 'final'];

export function royaleNotes(events: readonly unknown[] | undefined): RoyaleNote[] {
  const notes: RoyaleNote[] = [];
  for (const raw of events ?? []) {
    if (typeof raw !== 'object' || raw === null) continue;
    const ev = raw as Record<string, unknown>;
    const tag = typeof ev.e === 'string' ? ev.e : typeof ev.type === 'string' ? ev.type : '';
    const unitId = ev.unitId;
    switch (tag) {
      case 'royale_land':
        if (num(unitId)) notes.push({ kind: 'land', unitId });
        break;
      case 'royale_loot': {
        const source = ev.source;
        if (num(unitId) && typeof ev.itemId === 'string') {
          notes.push({
            kind: 'loot',
            unitId,
            itemId: ev.itemId,
            source: source === 'camp' || source === 'takedown' ? source : 'cache',
          });
        }
        break;
      }
      case 'royale_cache':
        if (num(unitId) && num(ev.cacheId))
          notes.push({ kind: 'cache', unitId, cacheId: ev.cacheId });
        break;
      case 'royale_pad':
        if (num(unitId) && num(ev.padId)) notes.push({ kind: 'pad', unitId, padId: ev.padId });
        break;
      case 'royale_dusk':
        if (num(ev.phase)) notes.push({ kind: 'dusk', phase: ev.phase });
        break;
      case 'royale_out':
        if (num(unitId) && num(ev.killerId) && num(ev.place)) {
          notes.push({ kind: 'out', unitId, killerId: ev.killerId, place: ev.place });
        }
        break;
      case 'royale_leader':
        if (num(unitId)) notes.push({ kind: 'leader', unitId });
        break;
      case 'royale_end':
        notes.push({ kind: 'end', winnerId: num(ev.winnerId) ? ev.winnerId : null });
        break;
      case 'royale_seedfall': {
        const id = num(ev.id) ? ev.id : ev.seedfallId;
        const at = pointOf(ev.at);
        if (num(id) && at && num(ev.landsAt)) {
          notes.push({ kind: 'seedfall', id, at, landsAt: ev.landsAt });
        }
        break;
      }
      case 'royale_seedfall_land': {
        const id = num(ev.id) ? ev.id : ev.seedfallId;
        const at = pointOf(ev.at);
        if (num(id) && at) notes.push({ kind: 'seedfall_land', id, at });
        break;
      }
      case 'royale_rising': {
        const at = pointOf(ev.at);
        if (typeof ev.kind === 'string' && RISINGS.includes(ev.kind) && at && num(ev.risesAt)) {
          notes.push({ kind: 'rising', rising: ev.kind as RisingKind, at, risesAt: ev.risesAt });
        }
        break;
      }
      case 'royale_wrath_passed':
        if (num(ev.from)) {
          notes.push({
            kind: 'wrath_passed',
            from: ev.from,
            to: num(ev.to) ? ev.to : null,
            ...nameOf(ev.n, 'name'),
          });
        }
        break;
      case 'royale_mark':
        if (num(unitId) && typeof ev.kind === 'string' && MARKS.includes(ev.kind)) {
          notes.push({ kind: 'mark', unitId, mark: ev.kind as MarkKind, ...nameOf(ev.n, 'name') });
        }
        break;
      case 'royale_snuffed':
        if (num(unitId) && num(ev.killerId) && num(ev.streak)) {
          notes.push({
            kind: 'snuffed',
            unitId,
            killerId: ev.killerId,
            streak: ev.streak,
            ...nameOf(ev.n, 'name'),
            ...nameOf(ev.kn, 'killerName'),
          });
        }
        break;
      case 'royale_reprieve':
        if (num(unitId) && num(ev.backAt))
          notes.push({ kind: 'reprieve', unitId, backAt: ev.backAt });
        break;
      case 'royale_dusk_hastens':
        if (num(ev.by) && num(ev.alive))
          notes.push({ kind: 'hastens', by: ev.by, alive: ev.alive });
        break;
      case 'royale_last_light':
        if (typeof ev.step === 'string' && LAST_LIGHT.includes(ev.step)) {
          notes.push({ kind: 'last_light', step: ev.step as LastLightStep });
        }
        break;
      case 'royale_pad_slam': {
        const at = pointOf(ev.at);
        if (num(unitId) && at) {
          const hit = Array.isArray(ev.hit) ? ev.hit.filter(num) : [];
          notes.push({ kind: 'pad_slam', unitId, at, hit });
        }
        break;
      }
      default:
        break;
    }
  }
  return notes;
}

// A death on a battle royale's snapshot, with the names and bot marks the
// server sends beside it (n and vb the victim's, kn and kb the killer's),
// when it sends them.
export function royaleKill(e: { unitId: number; killerId: number }): {
  unitId: number;
  killerId: number;
  n?: string;
  kn?: string;
  vb?: boolean;
  kb?: boolean;
} {
  const d = e as { n?: unknown; kn?: unknown; vb?: unknown; kb?: unknown };
  return {
    unitId: e.unitId,
    killerId: e.killerId,
    ...(typeof d.n === 'string' ? { n: d.n } : {}),
    ...(typeof d.kn === 'string' ? { kn: d.kn } : {}),
    ...(d.vb === 1 || d.vb === true ? { vb: true } : {}),
    ...(d.kb === 1 || d.kb === true ? { kb: true } : {}),
  };
}

// A champion in its Grace as the client reads the snapshot's ar block
// (src/sim/royale/grace.ts): who, until when, where it stood, and for a
// Grace that waits on the seat's first order (a Respawn Arrival's) from
// when an order ends it.
export interface GraceNote {
  unitId: number;
  until: number;
  at: WirePoint;
  from?: number;
}

// The Graces on a royale block, tolerant of a malformed entry; empty when
// the block is absent (no champion in sight is graced).
export function gracesOf(view: { ar?: unknown } | null | undefined): GraceNote[] {
  const out: GraceNote[] = [];
  const list = view?.ar;
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    if (!Array.isArray(raw) || raw.length < 5) continue;
    const [id, until, x, y, z, from] = raw as unknown[];
    if (num(id) && num(until) && num(x) && num(y) && num(z)) {
      out.push({ unitId: id, until, at: [x, y, z], ...(num(from) ? { from } : {}) });
    }
  }
  return out;
}

// From when an order ends the own champion's Grace (a Respawn Arrival's
// floor), null when it is not graced or its Grace waits on no order.
export function ownGraceFloor(
  view: { ar?: unknown } | null | undefined,
  selfId: number,
): number | null {
  for (const g of gracesOf(view)) if (g.unitId === selfId) return g.from ?? null;
  return null;
}

// When the own champion's Grace runs out, null when it is not graced.
export function ownGraceUntil(
  view: { ar?: unknown } | null | undefined,
  selfId: number,
): number | null {
  for (const g of gracesOf(view)) if (g.unitId === selfId) return g.until;
  return null;
}
