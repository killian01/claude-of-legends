// Where the browser goes when someone signs in on the landing page.
//
// A fresh sign-in reloads the page instead of swapping the home screen in
// over the landing. A page opened without an account is a visitor's page
// all the way down: the landing's backdrop is running, and everything
// built before the session existed was built for nobody. Coming back
// through boot with the session cookie in place is one line here instead
// of a list that grows every time the home screen learns something new,
// and boot is the path a returning player already takes.
//
// The trip costs the two things boot reads out of the address bar and
// then wipes from it, so they go back in before it: the invite code from
// a friend's link, and what a confirmation link came back with. Pure
// string work, so it can be tested without a browser; src/main.ts is what
// navigates.

import type { ConfirmResult } from '../ui/email_status';

// What boot had in hand when the visitor signed in, and would otherwise
// lose. Both are null on an ordinary visit.
export interface PendingEntry {
  joinCode: string | null;
  confirmed: ConfirmResult | null;
}

export function signedInUrl(href: string, pending: PendingEntry): string {
  const url = new URL(href);
  // Whatever brought this page load here has been consumed already, so
  // the query starts empty and only what is still pending goes back on.
  url.search = '';
  url.hash = '';
  if (pending.joinCode !== null) url.searchParams.set('join', pending.joinCode);
  // The shape ui/email_status.ts reads back: '1' is the confirmation that
  // worked, anything else is the one that did not.
  if (pending.confirmed !== null) {
    url.searchParams.set('confirmed', pending.confirmed === 'ok' ? '1' : '0');
  }
  return url.toString();
}

// Starts the page over as the account that just signed in. Navigating to
// the same address is a reload; a different one only differs by what had
// to be carried across, and either way the next boot finds the session.
export function reenterAsAccount(pending: PendingEntry, loc: Location = window.location): void {
  const back = signedInUrl(loc.href, pending);
  if (back === loc.href) loc.reload();
  else loc.assign(back);
}
