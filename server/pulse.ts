// What a launch day actually did, in five numbers a day and nothing else.
//
// The bottom of the funnel was always recoverable: accounts carry a
// createdAt and finished matches land in the record log. The top was not.
// Nothing anywhere counted the people who arrived, looked, and left, which
// is the number that separates "the announcement did not reach anyone" from
// "it reached them and the front door lost them". Those two have opposite
// cures, so guessing between them is the expensive mistake.
//
// What this deliberately is not: no third party, no cookie, no identifier
// that outlives the day, no per-person row, no path or referrer. A visit
// contributes one increment to one counter for one UTC day and leaves no
// trace that it was this visitor rather than another. That is a design
// choice and not an oversight, and it is why PRIVACY.md can describe the
// whole of it in a paragraph and be checked against this file.
//
// Counting distinct arrivals still needs to recognise the same person
// twice, so the address is hashed with a salt that is random per day, held
// only in memory, and never written anywhere. When the day rolls over the
// salt is thrown away with the set, which makes yesterday's hashes
// unreproducible even to this process: the counts survive, the ability to
// ask "was this visitor here before" does not.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadJson, saveJsonAtomic } from './store';

// One UTC day. Five counters, in funnel order.
export interface PulseDay {
  // YYYY-MM-DD, UTC.
  day: string;
  // The app shell served. A reload is a load, so this is always the
  // largest number and the least meaningful one.
  loads: number;
  // Distinct arrivals, best effort: see the salt note above, and `restarts`
  // for the one thing that inflates it.
  visitors: number;
  // Accounts created (ADR 0006: an account is the door to everything).
  accounts: number;
  // Matches that started, human and bot-filled alike.
  matches: number;
  // Matches that reached an end rather than being abandoned or reaped.
  finished: number;
  // How many times the server started during the day. Each restart empties
  // the in-memory set of seen visitors, so a returning visitor is counted
  // again: this number is how much to distrust `visitors` for that day.
  restarts: number;
}

export function emptyDay(day: string): PulseDay {
  return { day, loads: 0, visitors: 0, accounts: 0, matches: 0, finished: 0, restarts: 0 };
}

// The UTC day an instant falls in. UTC and not local time so that the
// boundary is the same wherever the server and the maintainer are, and so
// that a day never happens twice.
export function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

// Beyond this many distinct addresses in one day, `visitors` stops rising
// and the day is served with `capped: true`. It bounds the set's memory at
// something like 20MB in the worst case, and a day that reaches it has
// bigger news to report than its exact visitor count.
export const VISITOR_CAP = 250_000;

export interface PulseOptions {
  // Where the counts live between restarts. Absent means memory only,
  // which is what the tests want and what a dev server needs.
  file?: string;
  // Days to start from, oldest first. Overrides the file; for the tests.
  history?: readonly PulseDay[];
  // How many days to keep. Older ones fall off the front.
  keep?: number;
  // Injectable for the tests; production uses crypto-random.
  salt?: () => string;
  // Injectable for the tests; production uses VISITOR_CAP.
  cap?: number;
}

export class Pulse {
  private readonly log: PulseDay[];
  private readonly keep: number;
  private readonly newSalt: () => string;
  private readonly cap: number;
  private readonly file: string | undefined;
  private seen = new Set<string>();
  private salt: string;
  private capped = false;
  // Set by every counter, cleared by a write. A page load must not reach
  // the disk: server/store.ts rewrites whole files on the thread that
  // steps matches at 20 Hz, so the counters stay in memory and flush()
  // decides when they are worth a write.
  private dirty = false;

  constructor(now: number, opts: PulseOptions = {}) {
    this.keep = opts.keep ?? 400;
    this.newSalt = opts.salt ?? (() => randomBytes(16).toString('hex'));
    this.cap = opts.cap ?? VISITOR_CAP;
    this.file = opts.file;
    this.salt = this.newSalt();
    const stored = opts.history ?? (this.file ? fromFile(loadJson(this.file, null)) : []);
    this.log = [...stored].slice(-this.keep);
    this.today(now).restarts += 1;
    // A restart is worth the write on its own: it is the number that says
    // how much to trust the day's visitor count.
    this.dirty = true;
    this.flush();
  }

  // Today's record, rolling the day over first if the clock has passed
  // midnight. Every counter goes through here, so a server that runs for a
  // week still files each day separately without anything scheduling it.
  private today(at: number): PulseDay {
    const day = dayKey(at);
    const last = this.log[this.log.length - 1];
    if (last?.day === day) return last;
    // A day with no traffic at all is simply absent: the reader wants the
    // days that happened, not a row of zeros for every night.
    // The day that just closed is final, so it is written now rather than
    // waiting for a flush that a crash at 00:00 would never bring.
    this.flush();
    const fresh = emptyDay(day);
    this.log.push(fresh);
    while (this.log.length > this.keep) this.log.shift();
    this.seen = new Set();
    this.salt = this.newSalt();
    this.capped = false;
    this.dirty = true;
    return fresh;
  }

  // One page load. `address` is the caller's own idea of who asked, from
  // the trusted forwarded chain; it is hashed here and never stored, so no
  // caller can hand it somewhere else by accident.
  load(at: number, address: string): void {
    const day = this.today(at);
    day.loads += 1;
    this.dirty = true;
    if (this.capped) return;
    const key = createHash('sha256').update(`${this.salt}:${address}`).digest('base64');
    if (this.seen.has(key)) return;
    if (this.seen.size >= this.cap) {
      this.capped = true;
      return;
    }
    this.seen.add(key);
    day.visitors += 1;
  }

  account(at: number): void {
    this.today(at).accounts += 1;
    this.dirty = true;
  }

  matchStarted(at: number): void {
    this.today(at).matches += 1;
    this.dirty = true;
  }

  matchFinished(at: number): void {
    this.today(at).finished += 1;
    this.dirty = true;
  }

  // Writes the counts if any moved. Cheap when nothing did, which is most
  // of the time on a quiet night.
  flush(): void {
    if (!this.dirty || this.file === undefined) return;
    try {
      saveJsonAtomic(this.file, toFile(this.log));
      this.dirty = false;
    } catch (err) {
      // A broken disk must not break the game: the counts keep running in
      // memory and the failure is loud in the log.
      console.error('pulse persist failed', err);
    }
  }

  // Oldest first, which is the order a reader scans a launch in.
  days(): readonly PulseDay[] {
    return this.log;
  }

  // True once a day has hit VISITOR_CAP, so the report can say that its
  // visitor count is a floor rather than a count.
  cappedToday(): boolean {
    return this.capped;
  }
}

// What the file on disk holds. Versioned because the counters are the kind
// of thing that grows a sixth member, and a reader that meets a shape it
// does not know should start clean rather than guess.
export interface PulseFile {
  version: 1;
  days: PulseDay[];
}

export function toFile(days: readonly PulseDay[]): PulseFile {
  return { version: 1, days: [...days] };
}

// Reads the parsed file, and returns no history at all rather than a
// partial one when anything about it is unfamiliar. Losing a counter is
// cheap; a half-read history that quietly reports wrong numbers is not.
export function fromFile(raw: unknown): PulseDay[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const file = raw as Partial<PulseFile>;
  if (file.version !== 1 || !Array.isArray(file.days)) return [];
  const days: PulseDay[] = [];
  for (const entry of file.days) {
    const d = entry as Partial<PulseDay>;
    if (typeof d.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.day)) return [];
    days.push({
      day: d.day,
      loads: count(d.loads),
      visitors: count(d.visitors),
      accounts: count(d.accounts),
      matches: count(d.matches),
      finished: count(d.finished),
      restarts: count(d.restarts),
    });
  }
  days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return days;
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

// Whether a presented token is the maintainer's. Both sides are hashed
// first so the comparison is over a fixed length and the check leaks
// neither the secret's bytes nor its length, and an unset secret can
// never be satisfied: the report is off, not open.
export function tokenMatches(given: string, secret: string): boolean {
  if (secret === '') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}
