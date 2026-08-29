// What counts as an email address here, and what two addresses being the
// same address means. Pure, so the rule is one testable place rather than
// a regex copied into a route.
//
// The shape check is deliberately loose. RFC 5321 permits things nobody
// types into a game signup (quoted local parts, address literals), and a
// strict parser that rejects a real address is a worse failure than a
// loose one that accepts a fake: the address has to be confirmed by a
// click before it means anything (ADR 0007), and that click is the real
// validation. So this only rejects what cannot possibly be delivered.

export const EMAIL_MAX = 254;

// One @, something either side, and a dotted domain. No whitespace and no
// second @ anywhere, which is what most typos actually look like.
const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export type EmailError = 'missing' | 'too_long' | 'shape';

export function validateEmail(raw: string): EmailError | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 'missing';
  // Length is checked on the trimmed form: 254 is the RFC 5321 ceiling on
  // a path, and nothing longer can be delivered anywhere.
  if (trimmed.length > EMAIL_MAX) return 'too_long';
  if (!SHAPE.test(trimmed)) return 'shape';
  return null;
}

// The reading uniqueness is judged on. Case only, plus surrounding space.
//
// Deliberately NOT done: stripping dots and +tags. That is a Gmail rule,
// not an email rule, and applying it everywhere would merge two genuinely
// different mailboxes at a provider that treats them as different, locking
// a real person out of registering. The cost of leaving it out is that
// +tags let one mailbox hold several accounts, which is the smurfing that
// ADR 0006 already declines to chase.
export function foldEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function emailErrorMessage(code: EmailError): string {
  if (code === 'missing') return 'An email address is required.';
  if (code === 'too_long') return `An email address is at most ${EMAIL_MAX} characters.`;
  return 'That does not look like an email address.';
}
