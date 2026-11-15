// The private lobby's guards against a script (ADR 0036), one budget per
// internet connection: wrong lobby codes asked, lobbies opened, and Guest
// names changed. A code is six letters out of 23, so a lookup that costs
// nothing would let a script walk the live lobbies; the budget is wide
// enough for people who share one connection and mistype, follow a dead
// link, or reload it. Pure and clock-free: the caller passes the time.
// Keys are addresses and are never written anywhere.

// How long a wrong code counts against its connection, and how many
// distinct wrong codes it may ask in that time.
export const WRONG_CODE_WINDOW_MS = 10 * 60_000;
export const WRONG_CODES_ALLOWED = 20;
// How long a code this process issued answers closed instead of unknown,
// and how many such codes it keeps at most.
export const TOMBSTONE_MS = 24 * 3_600_000;
export const MAX_TOMBSTONES = 20_000;
// Lobbies opened per connection over the window, and lobbies open at
// once from one connection with their opener still in them.
export const CREATE_WINDOW_MS = 10 * 60_000;
export const CREATES_ALLOWED = 10;
export const MAX_OPEN_LOBBIES_PER_KEY = 5;
// Successful Guest renames per connection over the window.
export const NAME_WINDOW_MS = 3_600_000;
export const NAMES_ALLOWED = 5;
// Connections tracked at once; past it the one touched longest ago goes.
export const MAX_TRACKED_KEYS = 50_000;

// The words each refusal answers with.
export const LIMITED_MESSAGE =
  'Too many wrong lobby codes from this connection. Try again in a few minutes.';
export const CREATE_LIMIT_MESSAGE =
  'Too many private lobbies opened from this connection. Try again in a bit.';
export const NAME_LIMIT_MESSAGE = 'Too many name changes from this connection. Try again later.';

const CODE_SHAPE = /^[A-Za-z]{5,6}$/;

// A lobby code as asked (5 or 6 letters, any case), uppercased; null for
// anything else, which the caller charges as one malformed miss.
export function lobbyCode(raw: unknown): string | null {
  return typeof raw === 'string' && CODE_SHAPE.test(raw) ? raw.toUpperCase() : null;
}

// The budget key of a client address as server/edge.ts reads it: an IPv4
// address whole, an IPv6 address folded to its /64 (one connection holds
// a whole /64), a mapped IPv4 address as the IPv4 address. Anything else
// is its own bucket.
export function budgetKey(address: string): string {
  let s = address.trim().toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (s.startsWith('::ffff:') && /^\d{1,3}(\.\d{1,3}){3}$/.test(s.slice(7))) return s.slice(7);
  if (!s.includes(':')) return s;
  const groups = expandIpv6(s);
  if (!groups) return address;
  return `${groups.slice(0, 4).join(':')}::/64`;
}

// The eight groups of an IPv6 address, each without leading zeros, or null.
function expandIpv6(s: string): string[] | null {
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (h: string): string[] => (h === '' ? [] : h.split(':'));
  const head = part(halves[0]!);
  const tail = halves.length === 2 ? part(halves[1]!) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => Number.parseInt(g, 16).toString(16));
}

interface KeyState {
  // Distinct wrong codes, by when each was first charged.
  wrong: Map<string, number>;
  // When each malformed ask came: the string itself is never kept.
  malformed: number[];
  creates: number[];
  names: number[];
}

export interface CodeGuardOptions {
  maxKeys?: number;
  maxTombstones?: number;
}

// One process's budgets; main.ts holds one and calls purge() from its
// housekeeping sweep.
export class CodeGuard {
  private readonly keys = new Map<string, KeyState>();
  // Issued codes by when they were issued, oldest first.
  private readonly tombstones = new Map<string, number>();
  private readonly maxKeys: number;
  private readonly maxTombstones: number;

  constructor(opts: CodeGuardOptions = {}) {
    this.maxKeys = opts.maxKeys ?? MAX_TRACKED_KEYS;
    this.maxTombstones = opts.maxTombstones ?? MAX_TOMBSTONES;
  }

  // Connections tracked right now.
  get trackedKeys(): number {
    return this.keys.size;
  }

  // Whether a lookup from this connection is refused before it is made:
  // over its wrong-code budget, unless the asker is a remembered member
  // going back to their own lobby (member: the caller decides, by
  // account), who is never refused.
  limited(key: string, now: number, member: boolean): boolean {
    if (member) return false;
    return this.misses(key, now) >= WRONG_CODES_ALLOWED;
  }

  // Wrong codes this connection asked within the window.
  misses(key: string, now: number): number {
    const st = this.keys.get(key);
    if (!st) return 0;
    this.trim(st, now);
    return st.wrong.size + st.malformed.length;
  }

  // Charges a lookup that found no lobby: code is the asked code, or null
  // for a malformed ask. The same code is charged once over the window; a
  // code this process issued is never charged. Nothing resets the count.
  miss(key: string, code: string | null, now: number): void {
    if (code !== null && this.tombstoned(code, now)) return;
    const st = this.touch(key);
    this.trim(st, now);
    if (code === null) {
      if (st.malformed.length < WRONG_CODES_ALLOWED) st.malformed.push(now);
      return;
    }
    const upper = code.toUpperCase();
    if (!st.wrong.has(upper) && st.wrong.size < WRONG_CODES_ALLOWED) st.wrong.set(upper, now);
  }

  // A code this process just issued (Matchmaker.createLobby).
  issued(code: string, now: number): void {
    const upper = code.toUpperCase();
    this.tombstones.delete(upper);
    this.tombstones.set(upper, now);
    while (this.tombstones.size > this.maxTombstones) {
      this.tombstones.delete(this.tombstones.keys().next().value as string);
    }
  }

  // Whether this code was issued here within a day: it answers closed.
  tombstoned(code: string, now: number): boolean {
    const at = this.tombstones.get(code.toUpperCase());
    return at !== undefined && now - at <= TOMBSTONE_MS;
  }

  // Whether this connection may open one more lobby, with openFromKey the
  // lobbies it holds open with their opener in them right now; an allowed
  // create is charged here.
  mayCreate(key: string, now: number, openFromKey: number): boolean {
    if (openFromKey >= MAX_OPEN_LOBBIES_PER_KEY) return false;
    const st = this.touch(key);
    this.trim(st, now);
    if (st.creates.length >= CREATES_ALLOWED) return false;
    st.creates.push(now);
    return true;
  }

  // Whether this connection may change a Guest's name once more; an
  // allowed rename is charged here, in the same step as the check, so
  // renames begun together cannot all pass before any is charged. The
  // caller gives the slot back with refundRename when the rename does
  // not happen.
  tryRename(key: string, now: number): boolean {
    const st = this.touch(key);
    this.trim(st, now);
    if (st.names.length >= NAMES_ALLOWED) return false;
    st.names.push(now);
    return true;
  }

  // Gives back the slot tryRename charged at this time, for a rename that
  // was refused or failed.
  refundRename(key: string, at: number): void {
    const st = this.keys.get(key);
    if (!st) return;
    const i = st.names.lastIndexOf(at);
    if (i >= 0) st.names.splice(i, 1);
  }

  // Drops whatever ran out, and every connection left with nothing.
  purge(now: number): void {
    for (const [key, st] of this.keys) {
      this.trim(st, now);
      if (
        st.wrong.size === 0 &&
        st.malformed.length === 0 &&
        st.creates.length === 0 &&
        st.names.length === 0
      ) {
        this.keys.delete(key);
      }
    }
    for (const [code, at] of this.tombstones) {
      if (now - at > TOMBSTONE_MS) this.tombstones.delete(code);
    }
  }

  // The connection's state, made the newest; the oldest goes past the cap.
  private touch(key: string): KeyState {
    let st = this.keys.get(key);
    if (st) this.keys.delete(key);
    else st = { wrong: new Map(), malformed: [], creates: [], names: [] };
    this.keys.set(key, st);
    while (this.keys.size > this.maxKeys) {
      this.keys.delete(this.keys.keys().next().value as string);
    }
    return st;
  }

  private trim(st: KeyState, now: number): void {
    for (const [code, at] of st.wrong) {
      if (now - at > WRONG_CODE_WINDOW_MS) st.wrong.delete(code);
    }
    const keep = (list: number[], window: number): number[] =>
      list.filter((at) => now - at <= window);
    st.malformed = keep(st.malformed, WRONG_CODE_WINDOW_MS);
    st.creates = keep(st.creates, CREATE_WINDOW_MS);
    st.names = keep(st.names, NAME_WINDOW_MS);
  }
}
