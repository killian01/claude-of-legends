// Guests (ADR 0024, CONTEXT.md): a visitor in the public queue with no
// account. A Guest is a negative id and a handed-out name, held here in
// memory for a day and never written anywhere: a restart forgets them all,
// which costs a Guest nothing they were promised. The cookie carries an
// opaque id, like the account session's, so a Guest who reloads mid-match
// comes back to the same seat.

import { randomBytes } from 'node:crypto';
import type { TeamId } from '../src/sim/types';
import type { MatchPick } from './match';

export interface Guest {
  // Negative, so it can never be an account's id (those count up from 1)
  // and every account lookup made with it finds nothing.
  id: number;
  name: string;
  seenAt: number;
}

export const GUEST_COOKIE = 'loc_guest';
export const GUEST_TTL_MS = 24 * 60 * 60_000;
// Far above any real day on this server; what it bounds is a script
// asking for Guests in a loop. The oldest goes first.
export const GUEST_MAX = 5000;

// The space is the point: an account name is letters, digits, _ and -
// only (server/account_name.ts), so no account can ever wear this name.
export function guestName(n: number): string {
  return `Wanderer ${String(n).padStart(4, '0')}`;
}

export function isGuestId(id: number): boolean {
  return id < 0;
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

function randomToken(): string {
  return randomBytes(24).toString('hex');
}

export class GuestStore {
  private readonly byToken = new Map<string, Guest>();
  private nextId = -1;

  constructor(
    private readonly ttlMs: number = GUEST_TTL_MS,
    private readonly max: number = GUEST_MAX,
    private readonly tokenGen: () => string = randomToken,
    // Picks the four digits of a name; the id keeps Guests apart, so two
    // Wanderers sharing digits are two Guests all the same.
    private readonly digits: () => number = () => Math.floor(Math.random() * 10_000),
  ) {}

  issue(now: number): { token: string; guest: Guest } {
    this.sweep(now);
    while (this.byToken.size >= this.max) {
      const oldest = this.byToken.keys().next().value;
      if (oldest === undefined) break;
      this.byToken.delete(oldest);
    }
    const guest: Guest = { id: this.nextId--, name: guestName(this.digits()), seenAt: now };
    const token = this.tokenGen();
    this.byToken.set(token, guest);
    return { token, guest };
  }

  // The Guest behind a cookie, rolled forward; undefined once it has sat
  // unused for the window.
  resolve(token: string, now: number): Guest | undefined {
    const guest = this.byToken.get(token);
    if (!guest) return undefined;
    if (now - guest.seenAt > this.ttlMs) {
      this.byToken.delete(token);
      return undefined;
    }
    guest.seenAt = now;
    return guest;
  }

  get size(): number {
    return this.byToken.size;
  }

  private sweep(now: number): void {
    for (const [token, guest] of this.byToken) {
      if (now - guest.seenAt > this.ttlMs) this.byToken.delete(token);
    }
  }
}
