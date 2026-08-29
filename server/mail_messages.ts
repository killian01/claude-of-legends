// What the two mails actually say, and where their links point. Pure, so
// the wording and the URL shape are testable without a relay and without
// a running server.
//
// Plain text, short, and it names the game and the account: a mail that
// could be about anything is a mail a spam filter throws away, and a mail
// a stranger receives (a mistyped address at signup) has to explain
// itself in one line and offer the only correct action, which is to do
// nothing at all.

import type { Mail } from './mailer';

export const CONFIRM_PATH = '/api/email/confirm';
export const RESET_PATH = '/reset';

// The origin links are built from. PUBLIC_URL when set; otherwise the
// first origin the edge already allows, which on a real deployment is the
// site itself; otherwise localhost, which is what a developer wants.
export function publicOrigin(
  env: Record<string, string | undefined>,
  allowedOrigins: readonly string[],
  port: number,
): string {
  const explicit = env.PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const allowed = allowedOrigins.find((o) => o.startsWith('http'));
  if (allowed) return allowed.replace(/\/+$/, '');
  return `http://localhost:${port}`;
}

export function confirmUrl(origin: string, token: string): string {
  return `${origin}${CONFIRM_PATH}?token=${encodeURIComponent(token)}`;
}

export function resetUrl(origin: string, token: string): string {
  return `${origin}${RESET_PATH}?token=${encodeURIComponent(token)}`;
}

// Days, for a sentence rather than a millisecond count.
function days(ms: number): number {
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export function confirmMail(to: string, name: string, url: string, ttlMs: number): Mail {
  return {
    to,
    subject: 'Confirm your Claude of Legends account',
    text: [
      `Someone registered the Claude of Legends account "${name}" with this address.`,
      '',
      'If that was you, confirm it here:',
      url,
      '',
      `The link is good for ${days(ttlMs)} days. Confirming is what makes a forgotten`,
      'password recoverable, and it is what keeps this address reserved for you.',
      '',
      'If it was not you, ignore this mail. The address goes back into',
      `circulation on its own after ${days(ttlMs)} days and the account never touches it.`,
    ].join('\n'),
  };
}

export function resetMail(to: string, name: string, url: string, ttlMs: number): Mail {
  return {
    to,
    subject: 'Reset your Claude of Legends password',
    text: [
      `A password reset was requested for the Claude of Legends account "${name}".`,
      '',
      'Set a new password here:',
      url,
      '',
      `The link is good for ${Math.round(ttlMs / 60000)} minutes and works once.`,
      '',
      'If you did not ask for this, ignore this mail. Your password has not',
      'changed and nobody can use this link without reading it here.',
    ].join('\n'),
  };
}
