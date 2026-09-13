// What the News section decides without the DOM (CONTEXT.md: News): the
// order, which entry the landing shows, whether the bar's entry wears a
// dot, and what an event's countdown says. Pure over the table and the
// clock, so every rule here is pinned by tests/news.test.ts.

import { NEWS, type NewsEntry } from './news_entries';

export const DAY_MS = 86_400_000;
// The bar's dot: the newest entry is this recent, or an event is ahead.
// No state stored, so nothing to add to PRIVACY.md; a player who has read
// it sees the dot for a week, which is the cost of storing nothing.
export const FRESH_DAYS = 7;

// The instant an entry was published: the start of its UTC day.
export function publishedAt(e: NewsEntry): number {
  return Date.parse(`${e.day}T00:00:00Z`);
}

// An event still ahead of the clock.
export function isPinned(e: NewsEntry, now: number): boolean {
  return e.at !== undefined && Date.parse(e.at) > now;
}

// Pinned events first, the nearest first; then everything by day, newest
// first, the table's own order breaking ties.
export function orderNews(entries: readonly NewsEntry[], now: number): NewsEntry[] {
  const pinned = entries.filter((e) => isPinned(e, now));
  pinned.sort((a, b) => Date.parse(a.at ?? '') - Date.parse(b.at ?? ''));
  const rest = entries.filter((e) => !isPinned(e, now));
  rest.sort((a, b) => publishedAt(b) - publishedAt(a));
  return [...pinned, ...rest];
}

// The one the landing's line shows: what the section would show first.
export function newestOf(entries: readonly NewsEntry[], now: number): NewsEntry | null {
  return orderNews(entries, now)[0] ?? null;
}

export function isFresh(entries: readonly NewsEntry[], now: number): boolean {
  const first = newestOf(entries, now);
  if (first === null) return false;
  if (isPinned(first, now)) return true;
  return now - publishedAt(first) < FRESH_DAYS * DAY_MS;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// 'September 11, 2026', off the day string itself: no zone, no locale.
export function dayText(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

// How far ahead an event is, in the coarsest unit that is not zero.
export function countdownText(at: string, now: number): string {
  const left = Date.parse(at) - now;
  if (left <= 0) return 'now';
  const minutes = Math.round(left / 60_000);
  if (minutes < 60) return `in ${Math.max(1, minutes)} min`;
  const hours = Math.round(left / 3_600_000);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(left / DAY_MS)} days`;
}

// The table, as the page reads it.
export function allNews(): readonly NewsEntry[] {
  return NEWS;
}
