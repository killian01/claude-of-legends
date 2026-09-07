// The three things this client ever says about itself: that this browser
// is opening the game for the first time today, whether it had ever been
// here before, and which of nine buckets the link that brought it falls
// in (src/net/pulse_source.ts).
//
// The server counts arrivals (server/pulse.ts) and used to tell them apart
// by the address they came from, which does not work. A phone renews its
// IPv6 address between two reloads, a relay gives out a new exit per
// connection, and a crawler is an arrival that never was: one person
// reloading came out as twenty visitors. The browser is the only party that
// knows the answer, so the browser gives it.
//
// The second bit is what makes the first one readable. Three visitors in a
// day is the same number whether it is three strangers or one contributor
// opening the site from three machines all week, and those two have
// opposite cures. A browser with nothing stored has never been counted
// before; that is the whole of the test, and it is why nothing per person
// has to be kept to run it.
//
// What that costs, stated plainly because PRIVACY.md has to be checkable:
// one line in this browser's own storage, holding today's date and nothing
// else. It is not an identifier, it never leaves the machine, it is
// overwritten tomorrow, and the ping it gates carries no cookie and no
// body. What the server learns is that some browser arrived, whether it was
// the first time, and the name of a bucket. Never a URL: the browser reads
// its own referrer and sends the word, so "reddit" leaves the machine and
// the link does not.

import { sourceOf, type VisitSource } from './pulse_source';

export const VISIT_KEY = 'col.visit';
export const VISIT_URL = '/api/pulse/hit';
// What the key holds instead of a date when this browser has asked to be
// left out of the count. A word rather than a date, so that reading the
// value is enough to know which of the two it is.
export const OPT_OUT = 'off';
// How that is asked for: open the site with ?pulse=off once. It exists
// because the maintainer's own browser is otherwise indistinguishable from
// a stranger's, and on a day with three visitors that is the difference
// between a launch and a habit. ?pulse=on puts the browser back in.
export const CHOICE_PARAM = 'pulse';

// The UTC day, spelled exactly as server/pulse.ts spells it. UTC on both
// sides or a browser west of Greenwich pings twice at the wrong midnight.
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

// The narrow seam onto storage, so the decisions below are testable without
// a browser and so a page with storage denied has somewhere to fail.
export interface DayStore {
  read(): string | null;
  write(day: string): void;
}

// What the ping says, or null for a load that says nothing at all.
export interface Visit {
  // This browser had nothing stored: never counted here before, or counted
  // and then cleared. Over-counting newcomers is the safe direction, since
  // the number exists to notice strangers arriving.
  newcomer: boolean;
}

// Whether this load is the day's first, and claims it if so. The claim
// comes before the ping and not after: storage is what makes the ping
// happen once, so a browser that cannot write must not ping at all. That
// undercounts a visitor whose storage is denied, which is the direction to
// be wrong in; counting them on every reload is how this started.
export function visitToday(store: DayStore, day: string): Visit | null {
  let seen: string | null;
  try {
    seen = store.read();
  } catch {
    return null;
  }
  if (seen === OPT_OUT) return null;
  if (seen === day) return null;
  const newcomer = seen === null;
  try {
    store.write(day);
  } catch {
    return null;
  }
  return { newcomer };
}

// The opt-out asked for in the address bar, if any. Anything else in the
// query, and any other value, leaves the count alone: a stray ?pulse=maybe
// must not quietly switch a browser off.
export function pulseChoice(search: string): 'off' | 'on' | null {
  const value = new URLSearchParams(search).get(CHOICE_PARAM);
  return value === OPT_OUT ? 'off' : value === 'on' ? 'on' : null;
}

// Applies that choice, and answers whether this load still has anything to
// say. Turning the count back on writes today rather than clearing the
// key: counting resumes tomorrow and this browser is not counted as new,
// because it is not new.
export function applyChoice(store: DayStore, choice: 'off' | 'on' | null, day: string): boolean {
  if (choice === null) return true;
  try {
    store.write(choice === 'off' ? OPT_OUT : day);
  } catch {
    // Nothing to do: a browser that cannot remember the choice cannot be
    // counted either (visitToday returns null for the same reason).
  }
  return false;
}

// The whole request, built where it can be read in a test rather than
// inside the call that fires it. Two flags and no body: this stays the
// smallest thing a browser can send.
export function pingUrl(visit: Visit, source: VisitSource): string {
  const params = new URLSearchParams({ from: source });
  if (visit.newcomer) params.set('new', '1');
  return `${VISIT_URL}?${params.toString()}`;
}

function browserStore(): DayStore {
  return {
    read: () => window.localStorage.getItem(VISIT_KEY),
    write: (day) => {
      window.localStorage.setItem(VISIT_KEY, day);
    },
  };
}

// Fire and forget, once a day, from the client entry. Nothing waits on it
// and nothing reads the answer: a counter must never be able to hold up a
// page, and this one cannot fail loudly enough to matter.
export function markVisit(now = Date.now(), search = window.location.search): void {
  const day = utcDay(now);
  const store = browserStore();
  if (!applyChoice(store, pulseChoice(search), day)) return;
  const visit = visitToday(store, day);
  if (visit === null) return;
  // The referrer is read here and reduced here; nothing downstream ever
  // sees it. No credentials either: the session cookie has no business on
  // the one request that exists to be anonymous.
  const source = sourceOf(document.referrer, window.location.origin);
  void fetch(pingUrl(visit, source), {
    method: 'POST',
    credentials: 'omit',
    keepalive: true,
  }).catch(() => {});
}
