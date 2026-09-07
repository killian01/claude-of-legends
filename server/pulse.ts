// What a launch day actually did, in a handful of numbers a day and
// nothing else.
//
// The bottom of the funnel was always recoverable: accounts carry a
// createdAt and finished matches land in the record log. The top was not.
// Nothing anywhere counted the people who arrived, looked, and left, which
// is the number that separates "the announcement did not reach anyone" from
// "it reached them and the front door lost them". Those two have opposite
// cures, so guessing between them is the expensive mistake.
//
// What this deliberately is not: no third party, no cookie, no identifier
// of any kind, no per-person row, no path, no URL. A visit contributes one
// increment to each of a handful of counters for one UTC day and leaves no
// trace that it was this visitor rather than another. That is a design
// choice and not an oversight, and it is why PRIVACY.md can describe the
// whole of it in a paragraph and be checked against this file.
//
// Where a visitor came from is the one thing here that started life as a
// URL, and it never arrives as one: the browser reduces its own referrer
// to a word off a fixed list before saying anything (src/net/pulse_source.ts),
// so what is stored is "reddit" or "other" and never a link, a host or a
// page. A bucket that nine visitors share is not a trail.
//
// Distinct visitors are counted by the browser, not by the address it
// arrives from. The first load of a UTC day pings /api/pulse/hit and the
// browser writes that date into its own storage, so it pings once and only
// once that day (src/net/pulse_ping.ts). The address was the obvious key
// and it is the wrong one: a phone renews its IPv6 address between
// reloads, a relay or a carrier hands out a different exit per connection,
// a deploy empties whatever the process remembered, and every crawler in
// the world is its own arrival. All four inflate, none of them cancel, and
// together they turned one person reloading into twenty visitors.
//
// So an address is no longer part of the count at all. It survives in
// server/visit_guard.ts as the bound on how many times one network may add
// to the day, because a number the client sends is a number the client can
// forge, and nowhere else.

import { createHash, timingSafeEqual } from 'node:crypto';
import { VISIT_SOURCES, type VisitSource } from '../src/net/pulse_source';
import { loadJson, saveJsonAtomic } from './store';

// One UTC day. The counters, in funnel order, each one a subset of the
// line above it.
export interface PulseDay {
  // YYYY-MM-DD, UTC.
  day: string;
  // The app shell served. A reload is a load, and so is a crawler, so this
  // is always the largest number and the least meaningful one.
  loads: number;
  // Of those loads, the ones served for a path this site does not have
  // (server/arrival.ts). Nobody browses to /wp-login.php by accident, so
  // this is the scanner traffic, named rather than left inside loads where
  // it drowned everything: loads minus strays is what a reader wanted from
  // loads in the first place.
  strays: number;
  // Distinct browsers that opened the game that day, one per browser per
  // day. A visitor who blocks the ping or runs without JavaScript is not
  // counted and neither is a crawler, so this is a floor rather than a
  // count; it is a floor made of people, which the old one was not.
  visitors: number;
  // Of those visitors, the ones whose browser had never said hello before.
  // The rest had been here on an earlier day, which is the difference
  // between three strangers arriving and one contributor reloading all
  // week. A browser that cleared its storage looks new again, so this
  // leans towards over-counting newcomers and never the reverse.
  newcomers: number;
  // Where those visitors came from, one word off a fixed list
  // (src/net/pulse_source.ts). The buckets add up to visitors, and the
  // only one that is ever a URL is none of them: the browser picks the
  // word and sends the word. This is the dimension that says whether an
  // announcement reached anybody, which is the question the rest of the
  // row cannot answer however long it is read.
  sources: Record<VisitSource, number>;
  // Accounts created (ADR 0006: an account is the door to everything).
  accounts: number;
  // Matches that started, human and bot-filled alike.
  matches: number;
  // Matches that reached an end rather than being abandoned or reaped.
  finished: number;
  // How many times the server started during the day. It no longer distorts
  // anything, now that the browser and not this process remembers who has
  // been counted, but a dip in the afternoon usually has a deploy under it
  // and this is where the reader sees that.
  restarts: number;
}

export function emptySources(): Record<VisitSource, number> {
  const sources = {} as Record<VisitSource, number>;
  for (const source of VISIT_SOURCES) sources[source] = 0;
  return sources;
}

export function emptyDay(day: string): PulseDay {
  return {
    day,
    loads: 0,
    strays: 0,
    visitors: 0,
    newcomers: 0,
    sources: emptySources(),
    accounts: 0,
    matches: 0,
    finished: 0,
    restarts: 0,
  };
}

// The UTC day an instant falls in. UTC and not local time so that the
// boundary is the same wherever the server and the maintainer are, and so
// that a day never happens twice. The client picks its day the same way
// (src/net/pulse_ping.ts), which is what keeps one browser to one ping.
export function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export interface PulseOptions {
  // Where the counts live between restarts. Absent means memory only,
  // which is what the tests want and what a dev server needs.
  file?: string;
  // Days to start from, oldest first. Overrides the file; for the tests.
  history?: readonly PulseDay[];
  // How many days to keep. Older ones fall off the front.
  keep?: number;
}

export class Pulse {
  private readonly log: PulseDay[];
  private readonly keep: number;
  private readonly file: string | undefined;
  // Set by every counter, cleared by a write. A page load must not reach
  // the disk: server/store.ts rewrites whole files on the thread that
  // steps matches at 20 Hz, so the counters stay in memory and flush()
  // decides when they are worth a write.
  private dirty = false;

  constructor(now: number, opts: PulseOptions = {}) {
    this.keep = opts.keep ?? 400;
    this.file = opts.file;
    const stored = opts.history ?? (this.file ? fromFile(loadJson(this.file, null)) : []);
    this.log = [...stored].slice(-this.keep);
    this.today(now).restarts += 1;
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
    this.dirty = true;
    return fresh;
  }

  // One app shell served, whoever asked and however often. A stray is one
  // served for a path this site does not have (server/arrival.ts); it
  // still counts as a load, because it was one, and is counted again on
  // its own so the reader can take it back out.
  load(at: number, stray = false): void {
    const day = this.today(at);
    day.loads += 1;
    if (stray) day.strays += 1;
    this.dirty = true;
  }

  // One browser, opening the game for the first time today. Called for a
  // ping that server/visit_guard.ts has already allowed. A newcomer is a
  // browser that had nothing stored at all; the source is the bucket its
  // referrer fell in, already checked against the list by the caller.
  // Those two and the arrival itself are everything the ping ever says.
  visit(at: number, newcomer = false, source: VisitSource = 'direct'): void {
    const day = this.today(at);
    day.visitors += 1;
    if (newcomer) day.newcomers += 1;
    day.sources[source] += 1;
    this.dirty = true;
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
}

// What the file on disk holds. Versioned because the counters are the kind
// of thing that grows another member, and a reader that meets a shape it
// does not know should start clean rather than guess.
//
// Growing one does not bump the version, and must not: an absent counter
// reads back as zero, which is exactly true of a day that was counted
// before it existed, while a version bump would throw the launch away to
// gain nothing. The bump is for the day a counter changes meaning.
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
      strays: count(d.strays),
      visitors: count(d.visitors),
      newcomers: count(d.newcomers),
      sources: sources(d.sources),
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

// The buckets, read back one known key at a time. A bucket the list has
// since dropped is left on the floor rather than carried as a name nothing
// can render, and a day written before the buckets existed reads as zeros,
// which is what it was.
function sources(raw: unknown): Record<VisitSource, number> {
  const out = emptySources();
  if (typeof raw !== 'object' || raw === null) return out;
  const given = raw as Record<string, unknown>;
  for (const key of VISIT_SOURCES) out[key] = count(given[key]);
  return out;
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
