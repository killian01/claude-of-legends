// The one thing this client ever says about itself: that this browser is
// opening the game for the first time today.
//
// The server counts arrivals (server/pulse.ts) and used to tell them apart
// by the address they came from, which does not work. A phone renews its
// IPv6 address between two reloads, a relay gives out a new exit per
// connection, and a crawler is an arrival that never was: one person
// reloading came out as twenty visitors. The browser is the only party that
// knows the answer, so the browser gives it.
//
// What that costs, stated plainly because PRIVACY.md has to be checkable:
// one line in this browser's own storage, holding today's date and nothing
// else. It is not an identifier, it never leaves the machine, it is
// overwritten tomorrow, and the ping it gates carries no cookie, no body
// and no query. What the server learns is that some browser arrived, which
// is the whole of what is being asked.

export const VISIT_KEY = 'col.visit';
export const VISIT_URL = '/api/pulse/hit';

// The UTC day, spelled exactly as server/pulse.ts spells it. UTC on both
// sides or a browser west of Greenwich pings twice at the wrong midnight.
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

// The narrow seam onto storage, so the decision below is testable without
// a browser and so a page with storage denied has somewhere to fail.
export interface DayStore {
  read(): string | null;
  write(day: string): void;
}

// Whether this load is the day's first, and claims it if so. The claim
// comes before the ping and not after: storage is what makes the ping
// happen once, so a browser that cannot write must not ping at all. That
// undercounts a visitor whose storage is denied, which is the direction to
// be wrong in; counting them on every reload is how this started.
export function firstLoadToday(store: DayStore, day: string): boolean {
  let seen: string | null;
  try {
    seen = store.read();
  } catch {
    return false;
  }
  if (seen === day) return false;
  try {
    store.write(day);
  } catch {
    return false;
  }
  return true;
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
export function markVisit(now = Date.now()): void {
  if (!firstLoadToday(browserStore(), utcDay(now))) return;
  // No credentials: the session cookie has no business on the one request
  // that exists to be anonymous.
  void fetch(VISIT_URL, { method: 'POST', credentials: 'omit', keepalive: true }).catch(() => {});
}
