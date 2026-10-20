// The client's side of a Thornfray on the wire (ADR 0035): entering one over
// the session's socket with the quick pick, the gathering's Start now, and
// reading back what the server sends for it: the gathering's card, each
// bout's start (match_start's royale.tf: which bout, the six kinds, the
// person's seat, the table and the prize's seat), the snapshot's line of
// the bout (its count, place, best count and goal primitives) and the
// result after the Final. The message shapes are net/royale_wire.ts; the
// reading is tolerant, on the pattern of net/royale_client.ts: a message
// that is not one comes back null or false, and a row that cannot be read
// is left out.

import { BOUT_SEATS, BOUTS } from '../sim/content/bouts/match';
import { goalOffWire, type WireGoal } from './goal_wire';
import type {
  BoutStart,
  BoutTableRow,
  SnapBout,
  ThornfrayClientMsg,
  ThornfrayEndRow,
  ThornfrayGather,
  ThornfrayResult,
} from './royale_wire';

export interface ThornfrayEntry {
  championId: string;
  sigils: [string, string];
  skin: number;
}

// Enter a Thornfray: a seat held for the person, the gathering open, a
// late seat at a second Lull, or a new gathering. The server answers with
// the gathering's card, then each bout's match_start.
export function thornfrayEnterMsg(
  pick: ThornfrayEntry,
): Extract<ThornfrayClientMsg, { t: 'thornfray' }> {
  return {
    t: 'thornfray',
    championId: pick.championId,
    sigils: [pick.sigils[0], pick.sigils[1]],
    skin: pick.skin,
  };
}

// The gathering's Start now, its opener's.
export function thornfrayStartMsg(): Extract<ThornfrayClientMsg, { t: 'thornfray_start' }> {
  return { t: 'thornfray_start' };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => num(v) && Number.isInteger(v);
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function isThornfrayGather(msg: unknown): msg is ThornfrayGather {
  if (!obj(msg) || msg.t !== 'thornfray_gather') return false;
  return int(msg.people) && int(msg.of) && num(msg.startsIn) && typeof msg.opener === 'boolean';
}

function tableRow(v: unknown): BoutTableRow | null {
  if (!Array.isArray(v) || v.length !== 8) return null;
  const [seat, unit, name, champion, bot, bushels, last, won] = v as unknown[];
  if (!int(seat) || !int(unit) || typeof name !== 'string' || typeof champion !== 'string') {
    return null;
  }
  if (!num(bushels) || !num(last) || !int(won)) return null;
  return [seat, unit, name, champion, bot === 1 ? 1 : 0, bushels, last, won];
}

// A bout's start as match_start's royale block carries it, or null for a
// battle royale's (no tf) or one that cannot be read.
export function boutStartOf(royale: unknown): BoutStart | null {
  if (!obj(royale) || !obj(royale.tf)) return null;
  const tf = royale.tf;
  if (!int(tf.b) || tf.b < 0 || tf.b >= BOUTS || !int(tf.s)) return null;
  if (!Array.isArray(tf.k) || !tf.k.every((k) => typeof k === 'string')) return null;
  if (tf.k[tf.b] === undefined || !Array.isArray(tf.t)) return null;
  const t: BoutTableRow[] = [];
  for (const raw of tf.t) {
    const row = tableRow(raw);
    if (row) t.push(row);
  }
  if (t.length === 0 || t.length > BOUT_SEATS * 2) return null;
  return {
    b: tf.b,
    k: [...(tf.k as string[])],
    s: tf.s,
    t,
    ...(int(tf.p) ? { p: tf.p } : {}),
  };
}

// The snapshot's line of the bout as the mirror keeps it (the mode
// block's tf), its goals read back; null outside a bout.
export interface BoutLine {
  c: number;
  pl: number;
  bc: number;
  goals: WireGoal[];
}

export function boutLineOf(view: { tf?: unknown } | null | undefined): BoutLine | null {
  const tf = view?.tf as Partial<Record<keyof SnapBout, unknown>> | undefined;
  if (!obj(tf) || !num(tf.c) || !int(tf.pl) || !num(tf.bc)) return null;
  const goals: WireGoal[] = [];
  if (Array.isArray(tf.g)) {
    for (const g of tf.g) {
      const goal = goalOffWire(g);
      if (goal) goals.push(goal);
    }
  }
  return { c: tf.c, pl: tf.pl, bc: tf.bc, goals };
}

function endRow(v: unknown): ThornfrayEndRow | null {
  if (!Array.isArray(v) || v.length !== 6) return null;
  const [seat, name, champion, bot, bushels, won] = v as unknown[];
  if (!int(seat) || typeof name !== 'string' || typeof champion !== 'string') return null;
  if (!num(bushels) || !int(won)) return null;
  return [seat, name, champion, bot === 1 ? 1 : 0, bushels, won];
}

// A server message that is a Thornfray's result for this person, its
// unreadable rows and bouts left out.
export function thornfrayResultOf(msg: unknown): ThornfrayResult | null {
  if (!obj(msg) || msg.t !== 'thornfray_result') return null;
  const { place, of, seat, bushels, won, points } = msg;
  if (!int(place) || !int(of) || !int(seat) || !num(bushels) || !int(won) || !num(points)) {
    return null;
  }
  if (!Array.isArray(msg.table) || !Array.isArray(msg.bouts)) return null;
  const table: ThornfrayEndRow[] = [];
  for (const raw of msg.table) {
    const row = endRow(raw);
    if (row) table.push(row);
  }
  const bouts: ThornfrayResult['bouts'] = [];
  for (const b of msg.bouts) {
    if (obj(b) && typeof b.k === 'string' && int(b.pl) && num(b.paid)) {
      bouts.push({ k: b.k, pl: b.pl, paid: b.paid });
    }
  }
  const replays = Array.isArray(msg.replays) ? msg.replays.filter(int) : [];
  return { t: 'thornfray_result', place, of, seat, bushels, won, points, table, bouts, replays };
}
