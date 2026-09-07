// Whether a page served was a page somebody asked for, or a door being tried.
//
// The shell answers for every path that is not a file on disk, because the
// client routes in the browser and a shared deep link has to reach it
// (server/main.ts). That fallback is also what makes the load counter
// unreadable on its own: a scanner walking /wp-login.php, /.env and
// /admin.php collects one load each, and 350 loads against 3 visitors then
// says nothing about whether anybody came.
//
// So the count is split where the split is a fact rather than a guess. The
// client understands two paths and no others; anything that fell back from
// a third was never a page on this site, whoever asked for it. This is not
// a bot detector and must not grow into one: no user agent, no address, no
// rate. A path this site has, or a path it does not.

import { RESET_PATH } from './mail_messages';

// Every path the client routes. The game itself, and where a password
// reset mail lands (src/ui/password_reset.ts). RESET_PATH is imported
// rather than spelled again: the path the server mails out and the path
// the shell answers for are the same fact, and two copies of it would
// drift the day one moves.
export const CLIENT_ROUTES: readonly string[] = ['/', RESET_PATH];

// A trailing slash is the same door: /reset/ is what a mail client that
// tidies URLs sends, and a query string is already gone by here.
function normalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

// True when the shell was served for a path this site does not have.
// Wrong in the safe direction by construction: a client route added
// without being added here reads as a stray, which understates arrivals
// rather than inventing them.
export function isStray(pathname: string): boolean {
  return !CLIENT_ROUTES.includes(normalize(pathname));
}
