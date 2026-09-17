// The audience counter (PRIVACY.md): Umami, run beside the game on the
// same machine and reached through the game's own origin. The server puts
// its tag on the entry document when the deployment names a site to
// report to (server/stats_tag.ts); this is everything the client adds to
// what the tracker counts on its own, and what happens to a record before
// it leaves the browser.
//
// Nothing here waits on the tracker, and nothing here needs it. In
// development, on a self-hosted instance without stats, and in a browser
// that blocks it, window.umami is absent and every call below is a no-op.

// The paces past arriving, each sent once per page as a named event, so
// the dashboard can divide them by the visitors they are read against.
// 'stayed' is the line between a visitor and a click that bounced before
// the art had drawn; 'played' a match started in this browser, practice,
// test drive or live game alike and never a replay, which is watching
// rather than playing; 'finished' a match that ended with the player still
// in front of it, the line between trying and playing through; 'offer' the
// account offer at the end of a visitor's practice match taken
// (ui/account_offer.ts); 'form' the register tab opened, by hand or by the
// offer; 'account' an account created here, by form or by Discord. Read
// each against the one before it and the funnel says where people leave.
export const STATS_STEPS = ['stayed', 'played', 'finished', 'offer', 'form', 'account'] as const;
export type StatsStep = (typeof STATS_STEPS)[number];

// How long a visitor has to still be here to count as having stayed. Long
// enough that a page closed on sight does not qualify, short enough that
// it happens while the game is still loading its art on a slow line,
// because leaving during the load is exactly what it measures.
export const STAYED_MS = 30_000;

// The opt-out, asked for in the address bar: open the site with ?stats=off
// once and the tracker stays silent in this browser for good; ?stats=on
// puts it back. The key is the tracker's own, read before it sends
// anything, so the choice holds without a line of this code running. It
// exists because the maintainer's browser is otherwise indistinguishable
// from a stranger's, and on a quiet day that is most of the count.
export const CHOICE_PARAM = 'stats';
export const DISABLED_KEY = 'umami.disabled';
// The key the previous counter kept its line under: a date and at most two
// words, or 'off'. Removed on sight, and a browser that had asked out
// under the old name stays out.
export const OLD_VISIT_KEY = 'col.visit';
export const OLD_OPT_OUT = 'off';

// The name the tracker calls before every send (data-before-send on the
// tag, server/stats_tag.ts). A global rather than an import because the
// tracker is not a module: it looks the name up on window.
export const BEFORE_SEND_NAME = 'colStatsBeforeSend';

// The narrow seam onto storage, so the decisions below are testable
// without a browser and so a page with storage denied has somewhere to
// fail quietly.
export interface StatsStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

// The choice in the query, if any. Any other value leaves the counter
// alone: a stray ?stats=maybe must not quietly switch a browser off.
export function statsChoice(search: string): 'off' | 'on' | null {
  const value = new URLSearchParams(search).get(CHOICE_PARAM);
  return value === 'off' ? 'off' : value === 'on' ? 'on' : null;
}

export function applyChoice(store: StatsStore, choice: 'off' | 'on' | null): void {
  if (choice === null) return;
  try {
    if (choice === 'off') store.write(DISABLED_KEY, '1');
    else store.remove(DISABLED_KEY);
  } catch {
    // A browser that cannot remember the choice cannot be counted either:
    // the tracker reads the same storage.
  }
}

// Drops the previous counter's line, carrying its opt-out across.
export function forgetOldLine(store: StatsStore): void {
  try {
    const old = store.read(OLD_VISIT_KEY);
    if (old === null) return;
    if (old === OLD_OPT_OUT) store.write(DISABLED_KEY, '1');
    store.remove(OLD_VISIT_KEY);
  } catch {
    // Nothing to carry.
  }
}

// The only query words a record may carry: the ones an announcement's link
// puts there so that an app sending no referrer still says where it was
// posted (docs/deploy.md). Everything else in an address is stripped
// before it leaves: an invite code (?join=), a confirmation flag, whatever
// a future link carries.
export const KEPT_PARAM = /^utm_/;

// An address with its query reduced to the kept words. Absolute in,
// absolute out; a path in, a path out; something that is neither comes
// back untouched rather than invented.
export function scrubUrl(url: string): string {
  let parsed: URL;
  const relative = url.startsWith('/');
  try {
    parsed = relative ? new URL(url, 'http://relative.invalid') : new URL(url);
  } catch {
    return url;
  }
  const kept = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    if (KEPT_PARAM.test(key)) kept.append(key, value);
  }
  parsed.search = kept.toString();
  return relative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
}

// What the tracker is about to send: the page's address and the referrer,
// plus a name and data for an event. Only the two addresses are touched.
export interface StatsPayload {
  url?: unknown;
  referrer?: unknown;
  [key: string]: unknown;
}

export function beforeSend<T extends StatsPayload>(_type: string, payload: T): T {
  const out = { ...payload };
  if (typeof out.url === 'string') out.url = scrubUrl(out.url);
  if (typeof out.referrer === 'string') out.referrer = scrubUrl(out.referrer);
  return out;
}

export interface Tracker {
  track(name: string, data?: Record<string, unknown>): unknown;
}

export interface StatsWindow {
  umami?: Tracker;
  [BEFORE_SEND_NAME]?: typeof beforeSend;
}

// One pace past arriving. Fire and forget, like everything the tracker
// does: a counter must never be able to hold up the thing it is counting.
export function trackStep(step: StatsStep, win: StatsWindow = window as StatsWindow): void {
  try {
    win.umami?.track(step);
  } catch {
    // The tracker's problem, not the page's.
  }
}

function browserStore(): StatsStore {
  return {
    read: (key) => window.localStorage.getItem(key),
    write: (key, value) => {
      window.localStorage.setItem(key, value);
    },
    remove: (key) => {
      window.localStorage.removeItem(key);
    },
  };
}

// Run from the client entry before the tracker sends anything, which the
// document's script order guarantees: the entry bundle is a module, the
// tag a deferred script after it, and both run in document order once
// parsing ends.
export function installStats(
  win: StatsWindow = window as StatsWindow,
  search: string = window.location.search,
  store: StatsStore = browserStore(),
): void {
  forgetOldLine(store);
  applyChoice(store, statsChoice(search));
  win[BEFORE_SEND_NAME] = beforeSend;
}
