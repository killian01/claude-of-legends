// Guests (ADR 0024, amended by ADR 0027; CONTEXT.md): a visitor in the
// public queue with no account. A Guest is a negative id, a name, and the
// points it has banked on the ladder. The cookie carries an opaque token,
// like the account session's, so a Guest who reloads mid-match comes back
// to the same seat, and one who comes back next week finds their line.
//
// Two lives. A Guest with nothing worth keeping (no points, no chosen
// name) lives in memory for a day, as ADR 0024 had it, and a restart
// forgets it. Once it scores or names itself it is kept: written to disk
// under the SHA-256 of its token, never the token itself, so the file
// opens nobody's line, and it lives a year after it was last seen.
//
// The write discipline is the sessions' (server/sessions.ts). Naming and
// retiring a Guest are rare and written through; points and the last seen
// moment are not rare, so they only move numbers in memory, and the flush
// that follows is on a timer and at shutdown.

import { createHash, randomBytes } from 'node:crypto';
import type { TeamId } from '../src/sim/types';
import { foldName, type NameError, nameErrorMessage, validateName } from './account_name';
import type { GuestClaim } from './accounts';
import type { MatchPick } from './match';
import { loadJson, saveJsonAtomic } from './store';
import { findBlockedWord } from './word_filter';

export interface Guest {
  // Negative, so it can never be an account's id (those count up from 1)
  // and every account lookup made with it finds nothing.
  id: number;
  name: string;
  // The Guest chose its name (POST /api/ladder/name); until then it wears
  // the one handed out.
  named: boolean;
  // Banked on the ladder (server/points.ts), never spent.
  points: number;
  createdAt: number;
  seenAt: number;
}

export const GUEST_COOKIE = 'loc_guest';
// The cookie lasts a year, refreshed each time the landing asks for it.
export const GUEST_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;
// A Guest with nothing worth keeping, from its last use.
export const GUEST_TTL_MS = 24 * 60 * 60_000;
// A kept Guest (points or a chosen name), from its last use.
export const GUEST_KEPT_TTL_MS = 365 * 24 * 60 * 60_000;
// Far above any real day on this server; what it bounds is a script
// asking for Guests in a loop. The oldest Guest with nothing kept goes
// first, and a kept one never goes this way.
export const GUEST_MAX = 5000;
// How much a last-seen moment must move before it is worth writing on the
// next flush, as a session's is.
export const GUEST_TOUCH_FLUSH_MS = 60 * 60_000;

// The space is the point: an account name is letters, digits, _ and -
// only (server/account_name.ts), so no account can ever wear this name.
export function guestName(n: number): string {
  return `Wanderer ${String(n).padStart(4, '0')}`;
}

export function isGuestId(id: number): boolean {
  return id < 0;
}

// Worth a line on disk: it has points, or a name it chose.
export function keptGuest(g: Guest): boolean {
  return g.points > 0 || g.named;
}

// What the file holds in place of the cookie's token.
export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// What an account made in this Guest's browser takes from it (ADR 0027):
// the points, and the chosen name when there is one. The Guest is retired
// once the account exists, so one browser's line becomes one account.
export function guestClaim(guest: Guest | undefined): GuestClaim | undefined {
  if (!guest) return undefined;
  return { fold: guest.named ? foldName(guest.name) : null, points: guest.points };
}

// Whether a match may be rated: the queue's rule, and no Guest seated by
// hand in it (ADR 0024). Bot seats and house bots do not count here.
export function ratedWithGuests(fromQueue: boolean, humanIds: readonly number[]): boolean {
  return fromQueue && !humanIds.some(isGuestId);
}

// The teams whose house lane seats play the Gentle player (CONTEXT.md:
// House style): in a public queue match whose people are all Guests, the
// teams no Guest sits on, which is to say the newcomers' enemies. A match
// with an account in it keeps the drawn styles, and so does one with a
// Guest on each team, where every house seat is someone's ally. Read off
// the picks, which say whose each seat is from the select's start
// (server/matchmaker.ts), never off the sockets still open: an account
// whose socket closed during the select still holds its seat. A person's
// pick that does not say whose it is counts as an account's.
export function gentleTeams(
  publicQueue: boolean,
  picks: readonly Pick<MatchPick, 'team' | 'accountId' | 'bot' | 'ownerId'>[],
): TeamId[] {
  // A house bot or a ranked bot the fill seated has nobody behind it.
  const people = picks.filter((p) => p.bot === undefined && p.ownerId === undefined);
  const guest = (p: (typeof people)[number]): boolean =>
    p.accountId !== undefined && isGuestId(p.accountId);
  if (!publicQueue || people.length === 0 || !people.every(guest)) return [];
  return ([0, 1] as const).filter((team) => !people.some((p) => p.team === team));
}

// What a Guest may not ask for on the socket: lobbies, the Forge queue,
// spectating. Everything else is the public queue, the select, and the
// match itself.
export function guestRefused(msg: { t: string; forge?: unknown }): boolean {
  switch (msg.t) {
    case 'queue':
      return msg.forge === true;
    case 'create_lobby':
    case 'join_lobby':
    case 'lobby_team':
    case 'queue_party':
    case 'start_lobby':
    case 'spectate':
      return true;
    default:
      return false;
  }
}

// Why a Guest may not take a name for the ladder: the account name rules
// (server/account_name.ts), the word filter, or somebody holding it.
export type GuestNameError = NameError | 'blocked' | 'taken' | 'unknown_guest';

// The name's own faults, before anyone else is asked about it. The word
// filter reads the name's parts as words, since a handle has no spaces:
// separators and a capital after a small letter split it.
export function guestNameRefusal(name: string): NameError | 'blocked' | null {
  const shape = validateName(name);
  if (shape) return shape;
  const words = name.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  if (findBlockedWord([words]) !== null) return 'blocked';
  return null;
}

// What the name box says when it refuses, in plain words.
export function guestNameMessage(err: GuestNameError): string {
  switch (err) {
    case 'blocked':
      return 'That name is not allowed on the ladder. Pick another one.';
    case 'taken':
      return 'Somebody already plays under that name. Pick another one.';
    case 'unknown_guest':
      return 'This browser has no Guest to name yet: play a match first.';
    default:
      return nameErrorMessage(err);
  }
}

function randomToken(): string {
  return randomBytes(24).toString('hex');
}

export type GuestResult<T> = { ok: true; value: T } | { ok: false; error: GuestNameError };

export interface GuestStoreOptions {
  // Where the kept Guests live; null keeps every Guest in memory.
  file?: string | null;
  ttlMs?: number;
  keptTtlMs?: number;
  max?: number;
  tokenGen?: () => string;
  // Picks the four digits of a name; the id keeps Guests apart, so two
  // Wanderers sharing digits are two Guests all the same.
  digits?: () => number;
}

interface StoredGuest {
  id: number;
  // The SHA-256 of the cookie's token (tokenDigest), hex.
  digest: string;
  name: string;
  named: boolean;
  points: number;
  createdAt: number;
  seenAt: number;
}

interface StoredGuests {
  // The next id to hand out, so a retired or forgotten Guest's id is never
  // handed to somebody else.
  nextId: number;
  guests: StoredGuest[];
}

export class GuestStore {
  // Token digest -> Guest, in the order they were issued.
  private readonly byDigest = new Map<string, Guest>();
  private readonly digestOf = new Map<number, string>();
  // Folded chosen name -> the Guest holding it (server/account_name.ts:
  // the same reading account names are judged on).
  private readonly nameOwner = new Map<string, number>();
  private nextId = -1;
  // Set when points or a last-seen moment moved that disk does not know.
  private dirty = false;
  private readonly file: string | null;
  private readonly ttlMs: number;
  private readonly keptTtlMs: number;
  private readonly max: number;
  private readonly tokenGen: () => string;
  private readonly digits: () => number;

  constructor(opts: GuestStoreOptions = {}) {
    this.file = opts.file ?? null;
    this.ttlMs = opts.ttlMs ?? GUEST_TTL_MS;
    this.keptTtlMs = opts.keptTtlMs ?? GUEST_KEPT_TTL_MS;
    this.max = opts.max ?? GUEST_MAX;
    this.tokenGen = opts.tokenGen ?? randomToken;
    this.digits = opts.digits ?? (() => Math.floor(Math.random() * 10_000));
    if (this.file === null) return;
    const state = loadJson<Partial<StoredGuests>>(this.file, {});
    for (const s of Array.isArray(state.guests) ? state.guests : []) {
      if (!Number.isInteger(s?.id) || s.id >= 0 || typeof s.digest !== 'string') continue;
      if (typeof s.name !== 'string' || this.digestOf.has(s.id)) continue;
      this.add(s.digest, {
        id: s.id,
        name: s.name,
        named: s.named === true,
        points: Number.isFinite(s.points) ? Math.max(0, Math.round(s.points)) : 0,
        createdAt: Number.isFinite(s.createdAt) ? s.createdAt : 0,
        seenAt: Number.isFinite(s.seenAt) ? s.seenAt : 0,
      });
      this.nextId = Math.min(this.nextId, s.id - 1);
    }
    if (Number.isInteger(state.nextId) && (state.nextId as number) < this.nextId) {
      this.nextId = state.nextId as number;
    }
  }

  private add(digest: string, guest: Guest): void {
    this.byDigest.set(digest, guest);
    this.digestOf.set(guest.id, digest);
    if (guest.named) this.nameOwner.set(foldName(guest.name), guest.id);
  }

  private remove(id: number): Guest | undefined {
    const digest = this.digestOf.get(id);
    if (digest === undefined) return undefined;
    const guest = this.byDigest.get(digest);
    this.byDigest.delete(digest);
    this.digestOf.delete(id);
    if (guest?.named) {
      const fold = foldName(guest.name);
      if (this.nameOwner.get(fold) === id) this.nameOwner.delete(fold);
    }
    return guest;
  }

  private expired(g: Guest, now: number): boolean {
    return now - g.seenAt > (keptGuest(g) ? this.keptTtlMs : this.ttlMs);
  }

  private persist(): void {
    this.dirty = false;
    if (this.file === null) return;
    // A broken disk must not break the game: Guests keep playing from
    // memory and the failure is loud in the log.
    try {
      const guests: StoredGuest[] = [];
      for (const [digest, g] of this.byDigest) {
        if (keptGuest(g)) guests.push({ ...g, digest });
      }
      saveJsonAtomic(this.file, { nextId: this.nextId, guests } satisfies StoredGuests);
    } catch (err) {
      console.error('guest store persist failed', err);
    }
  }

  issue(now: number): { token: string; guest: Guest } {
    this.sweep(now);
    let spare = 0;
    for (const g of this.byDigest.values()) if (!keptGuest(g)) spare += 1;
    for (const g of [...this.byDigest.values()]) {
      if (spare < this.max) break;
      if (keptGuest(g)) continue;
      this.remove(g.id);
      spare -= 1;
    }
    const guest: Guest = {
      id: this.nextId--,
      name: guestName(this.digits()),
      named: false,
      points: 0,
      createdAt: now,
      seenAt: now,
    };
    const token = this.tokenGen();
    this.add(tokenDigest(token), guest);
    return { token, guest };
  }

  // The Guest behind a cookie, rolled forward; undefined once it has sat
  // unused for its window.
  resolve(token: string, now: number): Guest | undefined {
    const guest = this.byDigest.get(tokenDigest(token));
    if (!guest) return undefined;
    if (this.expired(guest, now)) {
      if (keptGuest(guest)) this.dirty = true;
      this.remove(guest.id);
      return undefined;
    }
    if (keptGuest(guest) && now - guest.seenAt >= GUEST_TOUCH_FLUSH_MS) this.dirty = true;
    guest.seenAt = now;
    return guest;
  }

  findById(id: number): Guest | undefined {
    const digest = this.digestOf.get(id);
    return digest === undefined ? undefined : this.byDigest.get(digest);
  }

  // Points landed on this Guest's line (server/points.ts). Memory only; the
  // flush writes it. Null when the Guest is gone.
  addPoints(id: number, delta: number, now: number): number | null {
    const guest = this.findById(id);
    if (!guest) return null;
    guest.points += delta;
    guest.seenAt = now;
    this.dirty = true;
    return guest.points;
  }

  // The Guest holding this folded name, if one chose it.
  holderOf(fold: string): number | undefined {
    return this.nameOwner.get(fold);
  }

  // The name this Guest wants on the ladder. `heldByAccount` answers whether
  // an account holds or once held the folded name: the name has to be
  // free among the accounts and among the other Guests alike. Written
  // through: it is rare, and it is a claim on a name.
  setName(
    id: number,
    name: string,
    now: number,
    heldByAccount: (fold: string) => boolean,
  ): GuestResult<Guest> {
    const guest = this.findById(id);
    if (!guest) return { ok: false, error: 'unknown_guest' };
    const refusal = guestNameRefusal(name);
    if (refusal) return { ok: false, error: refusal };
    const fold = foldName(name);
    const holder = this.nameOwner.get(fold);
    if ((holder !== undefined && holder !== id) || heldByAccount(fold)) {
      return { ok: false, error: 'taken' };
    }
    // A Guest holds one name at a time: the one it leaves goes back.
    if (guest.named) {
      const old = foldName(guest.name);
      if (this.nameOwner.get(old) === id) this.nameOwner.delete(old);
    }
    guest.name = name;
    guest.named = true;
    guest.seenAt = now;
    this.nameOwner.set(fold, id);
    this.persist();
    return { ok: true, value: guest };
  }

  // The Guest became an account (ADR 0027): its points moved there, and
  // the Guest is gone for good, name and all. Written through, so a
  // restart cannot bring the points back on both lines.
  retire(id: number): Guest | undefined {
    const guest = this.remove(id);
    if (guest && keptGuest(guest)) this.persist();
    return guest;
  }

  all(): Guest[] {
    return [...this.byDigest.values()];
  }

  // Writes what only moved in memory. Cheap when nothing did.
  flush(): void {
    if (this.dirty) this.persist();
  }

  get size(): number {
    return this.byDigest.size;
  }

  // Drops the Guests past their window, so a line a year unseen leaves the
  // ladder without waiting for the next Guest to be issued. Returns how
  // many, for the log; what was kept leaves disk on the next flush.
  purgeExpired(now: number): number {
    return this.sweep(now);
  }

  private sweep(now: number): number {
    let dropped = 0;
    for (const g of [...this.byDigest.values()]) {
      if (!this.expired(g, now)) continue;
      if (keptGuest(g)) this.dirty = true;
      this.remove(g.id);
      dropped += 1;
    }
    return dropped;
  }
}
