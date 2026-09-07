// Whether anybody came back, read off what the server already keeps.
//
// The pulse counts a launch day from the top (server/pulse.ts): who
// arrived, how far they got, how many signed up. It says nothing about the
// day after, and the day after is the whole question: a hundred sign-ups
// that never return is a worse result than ten that do, and the two look
// identical in a daily row.
//
// Nothing new is collected for this. An account already carries the day it
// was made and the day it was last seen (server/accounts.ts), and every
// finished match already lands in the record log with the accounts that
// played it (server/records.ts). This reads those two files and does the
// arithmetic nobody had done.
//
// Usage, on the machine that holds the data:
//   node scripts/retention.mjs /var/lib/docker/volumes/claude-of-legends_game_data/_data
// or inside a checkout with its own data dir:
//   node scripts/retention.mjs data
//
// Read-only, and it never prints a name or an address: a cohort is a
// count, and a count of one is still reported as a count.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dayKey } from '../server/pulse';

export interface AccountRow {
  id: number;
  createdAt: number;
  seenAt: number;
  ratedGames: number;
}

// One finished match, reduced to what retention needs: when, and which
// accounts were in it. Bot seats carry no account and are dropped here.
export interface MatchRow {
  at: number;
  accountIds: readonly number[];
}

export interface Cohort {
  day: string;
  size: number;
  // Played at least one match, ever. The pulse's own funnel stops at the
  // browser, so this is the first number that says an account did the
  // thing the account exists for.
  played: number;
  // Played on a later UTC day than the one they signed up on. This is the
  // column to believe: the record log is append-only and a match in it
  // happened.
  playedAgain: number;
  // Seen on a later UTC day than the one they signed up on, according to
  // the account's own seenAt. A floor and not a count: seenAt moves in
  // memory on every connection and only reaches disk when something else
  // persists (server/accounts.ts touch), so an account can have played
  // yesterday and still read as never seen since. Which is exactly why it
  // sits beside the column above rather than instead of it.
  cameBack: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Days between two instants, counted in UTC days rather than in elapsed
// hours: somebody who signs up at 23:50 and plays at 00:10 came back the
// next day, and rounding the hours would call it the same one.
export function daysBetween(from: number, to: number): number {
  const a = Date.parse(`${dayKey(from)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(to)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

export function cohorts(accounts: readonly AccountRow[], matches: readonly MatchRow[]): Cohort[] {
  // When each account played, as the set of UTC days it appears in the
  // record log on. Built once: the log is every match ever and the
  // alternative is walking it per account.
  const playedOn = new Map<number, Set<string>>();
  for (const match of matches) {
    const day = dayKey(match.at);
    for (const id of match.accountIds) {
      const days = playedOn.get(id) ?? new Set<string>();
      days.add(day);
      playedOn.set(id, days);
    }
  }
  const byDay = new Map<string, AccountRow[]>();
  for (const account of accounts) {
    const day = dayKey(account.createdAt);
    byDay.set(day, [...(byDay.get(day) ?? []), account]);
  }
  const rows: Cohort[] = [];
  for (const [day, members] of [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const row: Cohort = { day, size: members.length, played: 0, playedAgain: 0, cameBack: 0 };
    for (const account of members) {
      const days = playedOn.get(account.id) ?? new Set<string>();
      if (days.size > 0) row.played += 1;
      if ([...days].some((d) => d > day)) row.playedAgain += 1;
      if (dayKey(account.seenAt) > day) row.cameBack += 1;
    }
    rows.push(row);
  }
  return rows;
}

// Of every account, how many played a match this many days after signing
// up. Day 0 is the day they signed up, which is nearly always the largest
// and is the one to read the rest against.
export function curve(
  accounts: readonly AccountRow[],
  matches: readonly MatchRow[],
  span = 7,
): number[] {
  const counts = new Array<number>(span + 1).fill(0);
  const signup = new Map<number, number>();
  for (const account of accounts) signup.set(account.id, account.createdAt);
  const seen = new Set<string>();
  for (const match of matches) {
    for (const id of match.accountIds) {
      const made = signup.get(id);
      if (made === undefined) continue;
      const offset = daysBetween(made, match.at);
      if (offset < 0 || offset > span) continue;
      // One account counts once per day, not once per match: this is a
      // count of people, not of games.
      const key = `${id}:${offset}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[offset] = (counts[offset] ?? 0) + 1;
    }
  }
  return counts;
}

// --- reading what the server wrote ------------------------------------

export function readAccounts(dir: string): AccountRow[] {
  const raw: unknown = JSON.parse(readFileSync(path.join(dir, 'accounts.json'), 'utf8'));
  const holder = (raw as { accounts?: unknown }).accounts ?? raw;
  const list = Array.isArray(holder) ? holder : Object.values(holder as object);
  const rows: AccountRow[] = [];
  for (const entry of list) {
    const a = entry as Partial<AccountRow>;
    if (typeof a.id !== 'number' || typeof a.createdAt !== 'number') continue;
    rows.push({
      id: a.id,
      createdAt: a.createdAt,
      seenAt: typeof a.seenAt === 'number' ? a.seenAt : a.createdAt,
      ratedGames: typeof a.ratedGames === 'number' ? a.ratedGames : 0,
    });
  }
  return rows;
}

export function readMatches(dir: string): MatchRow[] {
  let text: string;
  try {
    text = readFileSync(path.join(dir, 'matches.jsonl'), 'utf8');
  } catch {
    // A deployment that has never finished a match has no log, and that is
    // a fact about the deployment rather than an error.
    return [];
  }
  const rows: MatchRow[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let entry: { at?: unknown; players?: unknown };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry.at !== 'number' || !Array.isArray(entry.players)) continue;
    const ids: number[] = [];
    for (const p of entry.players) {
      const id = (p as { accountId?: unknown }).accountId;
      if (typeof id === 'number') ids.push(id);
    }
    rows.push({ at: entry.at, accountIds: ids });
  }
  return rows;
}

function pad(s: string | number, width: number): string {
  return String(s).padStart(width);
}

export function render(rows: readonly Cohort[], days: readonly number[]): string {
  const all = rows.reduce(
    (t, r) => ({
      day: 'All',
      size: t.size + r.size,
      played: t.played + r.played,
      playedAgain: t.playedAgain + r.playedAgain,
      cameBack: t.cameBack + r.cameBack,
    }),
    { day: 'All', size: 0, played: 0, playedAgain: 0, cameBack: 0 },
  );
  const head = `${'Cohort'.padEnd(12)}${pad('Size', 5)}${pad('Played', 8)}${pad('Played again', 14)}${pad('Seen again', 12)}`;
  const line = (r: Cohort): string =>
    `${r.day.padEnd(12)}${pad(r.size, 5)}${pad(r.played, 8)}${pad(r.playedAgain, 14)}${pad(r.cameBack, 12)}`;
  const curveLine = days.map((n, i) => `D${i} ${pad(n, 3)}`).join('   ');
  return [
    head,
    ...rows.map(line),
    '',
    line(all),
    '',
    'Accounts that played a match, by days after signing up:',
    `  ${curveLine}`,
    '',
    'Played       appeared in at least one finished match, ever',
    'Played again a match on a later UTC day than the day the account was made',
    'Seen again   the account seenAt landed on a later day. A floor, not a count:',
    '             it moves in memory on every connection and only reaches disk',
    '             when something else persists, so it can read lower than the',
    '             column beside it, which comes off the append-only match log.',
  ].join('\n');
}

function main(): void {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error('usage: node scripts/retention.mjs <data dir>');
    process.exit(2);
    return;
  }
  const accounts = readAccounts(dir);
  const matches = readMatches(dir);
  console.log(`Retention: ${accounts.length} accounts, ${matches.length} matches, from ${dir}\n`);
  console.log(render(cohorts(accounts, matches), curve(accounts, matches)));
}

// Imported by the tests, run by scripts/retention.mjs, which bundles this
// file under its own name. Nothing happens on import, so the arithmetic
// above is exercised without a data dir and without a running server.
if (process.argv[1]?.endsWith('retention_report.cjs')) main();
