// The client's side of the battle royale on the wire (ADR 0031): entering
// a match over the session's socket, the landing point picked during the
// drop, and reading back what the server sends for the mode: the result at
// the end, and the mode's events riding a snapshot. The message shapes are
// net/royale_wire.ts; the reading is tolerant, since a field the server
// does not send yet must cost nothing but the line that would show it.

import type { RoyaleClientMsg, RoyaleResult, RoyaleVariant } from './royale_wire';

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

// The landing point picked during the drop, a point on the sphere.
export function dropMsg(p: {
  x: number;
  y: number;
  z: number;
}): Extract<RoyaleClientMsg, { t: 'drop' }> {
  return { t: 'drop', x: p.x, y: p.y, z: p.z };
}

export function sendDrop(
  send: (msg: RoyaleClientMsg) => void,
  p: { x: number; y: number; z: number },
): void {
  send(dropMsg(p));
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
  | { kind: 'end'; winnerId: number | null };

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
      default:
        break;
    }
  }
  return notes;
}
