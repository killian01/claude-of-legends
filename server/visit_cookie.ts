// The visit cookie (PRIVACY.md): one random id per browser, set by this
// server on the entry document, so the counter can tell a returning
// browser from a new one.
//
// Why the server sets it rather than the page. The counter's own visitor
// id is a hash of the address and the browser under a salt that changes
// every month (Umami's design), so nobody can be recognised past the
// first of the month and the question "did anybody come back" has no
// answer past four weeks. And a cookie written by a script is capped to
// seven days on Safari, which is most of the phones that reach this game.
// A first-party cookie set in the response has neither limit.
//
// What it is allowed to be, and the bargain that keeps it out of a consent
// banner: first party, this site only, audience measurement and nothing
// else, no sharing with anybody, an opt-out that works, and a life of
// thirteen months (the CNIL's ceiling for an exempt audience measure). It
// carries a random id, never a name, never an account.
//
// The same cookie carries the opt-out: `off` instead of an id. That is
// better than the browser key it replaces, which Safari clears after a
// week, taking the choice with it.

export const VISIT_COOKIE = 'col_visit';
// Thirteen months, the ceiling an audience measure may keep an identifier
// for and still be exempt from asking.
export const VISIT_MAX_AGE_S = 13 * 30 * 24 * 3600;
export const VISIT_OFF = 'off';
// A random id: 32 hex characters, no meaning of its own.
const ID = /^[0-9a-f]{32}$/;

export type VisitChoice = 'off' | 'on' | null;

// What the browser should end up holding, given what it sent and what the
// address asked for. 'keep' writes no header at all, which is the common
// case: a browser that already has its id is left alone.
export type VisitAction =
  | { kind: 'keep'; value: string }
  | { kind: 'set'; value: string }
  | { kind: 'clear' };

export function isVisitId(value: string | undefined): value is string {
  return typeof value === 'string' && ID.test(value);
}

// The opt-out asked for in the address, the same words the counter reads
// (src/net/stats.ts): ?stats=off silences this browser, ?stats=on undoes
// it. Anything else leaves the choice alone.
export function visitChoice(search: string): VisitChoice {
  const value = new URLSearchParams(search).get('stats');
  return value === 'off' ? 'off' : value === 'on' ? 'on' : null;
}

// Pure: the cookie's next state. `mint` makes a fresh id and is only
// called when one is needed, so a test can hand in a fixed one.
export function nextVisit(
  current: string | undefined,
  choice: VisitChoice,
  mint: () => string,
): VisitAction {
  if (choice === 'off') return { kind: 'set', value: VISIT_OFF };
  // Coming back in: the id has to be new, since the old one was given up
  // when they asked out.
  if (choice === 'on') return { kind: 'set', value: mint() };
  if (current === VISIT_OFF) return { kind: 'keep', value: VISIT_OFF };
  if (isVisitId(current)) return { kind: 'keep', value: current };
  // No cookie, or something that is not one of ours.
  return { kind: 'set', value: mint() };
}

// What the page should tell the counter: the id when there is one, null
// when this browser asked out or holds nothing yet.
export function visitIdOf(action: VisitAction): string | null {
  if (action.kind === 'clear') return null;
  return isVisitId(action.value) ? action.value : null;
}

// The id reaches the page as a meta element rather than a readable
// cookie, so the cookie itself stays HttpOnly and no other script on the
// page can reach the value (src/net/stats.ts reads it).
export const VISIT_META = 'visit';

export function visitTag(id: string): string {
  return `<meta name="${VISIT_META}" content="${id}">`;
}

export function withVisitTag(html: string, id: string | null): string {
  if (id === null || !isVisitId(id)) return html;
  const at = html.search(/<\/head>/i);
  if (at < 0) return html;
  return `${html.slice(0, at)}    ${visitTag(id)}\n  ${html.slice(at)}`;
}
