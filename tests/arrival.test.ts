// Which of the shells served was a page somebody asked for
// (server/arrival.ts). The counter this feeds exists because 356 loads
// against 3 visitors said nothing at all: a scanner walking a list of
// admin panels and an announcement landing were the same number.

import { describe, expect, it } from 'vitest';
import { CLIENT_ROUTES, isStray } from '../server/arrival';
import { RESET_PATH } from '../server/mail_messages';

describe('a path this site has', () => {
  it('is the game itself', () => {
    expect(isStray('/')).toBe(false);
  });

  it('is where a password reset mail lands', () => {
    // The link the server mails out has to be a page, or every reset in
    // the log would read as somebody probing the site.
    expect(isStray(RESET_PATH)).toBe(false);
    expect(CLIENT_ROUTES).toContain(RESET_PATH);
  });

  it('is the same door with a slash on the end', () => {
    // What a mail client that tidies URLs sends, and what a person types.
    expect(isStray('/reset/')).toBe(false);
    expect(isStray('//')).toBe(false);
  });
});

describe('a path it does not', () => {
  it('is what the scanners spend their day on', () => {
    for (const path of [
      '/wp-login.php',
      '/wp-admin/setup-config.php',
      '/.env',
      '/admin',
      '/phpmyadmin/index.php',
      '/.git/config',
    ]) {
      expect(`${path}: ${isStray(path)}`).toBe(`${path}: true`);
    }
  });

  it('includes a route this file has not been told about', () => {
    // Wrong in the safe direction on purpose: a client route added
    // without being added here understates arrivals rather than
    // inventing them.
    expect(isStray('/tomorrows-page')).toBe(true);
  });

  it('is a path and not a spelling of one', () => {
    // Case matters to a URL, and a scanner that shouts is still a
    // scanner.
    expect(isStray('/RESET')).toBe(true);
  });
});
