// What counts as an address, what makes two of them the same one, and how
// long a claim on one stands. Pure rules, so they are pinned here rather
// than discovered through the registry.

import { describe, expect, it } from 'vitest';
import { EMAIL_MAX, emailErrorMessage, foldEmail, validateEmail } from '../server/email_address';
import { CLAIM_TTL_MS, claimExpiresInMs, claimHolds } from '../server/email_claim';
import {
  confirmMail,
  confirmUrl,
  publicOrigin,
  resetMail,
  resetUrl,
} from '../server/mail_messages';

describe('validateEmail', () => {
  it('accepts what can actually be delivered', () => {
    for (const good of [
      'bob@example.com',
      'BOB@EXAMPLE.COM',
      'bob+tag@example.co.uk',
      'b.o.b@mail.example.com',
      "o'hara@example.org",
      '  spaced@example.com  ',
    ]) {
      expect(validateEmail(good)).toBeNull();
    }
  });

  it('refuses what cannot', () => {
    expect(validateEmail('')).toBe('missing');
    expect(validateEmail('   ')).toBe('missing');
    // No @, no domain dot, two @, whitespace inside: what typos look like.
    for (const bad of ['nope', 'bob@example', 'a@b@c.com', 'bob @example.com', '@example.com']) {
      expect(validateEmail(bad)).toBe('shape');
    }
    expect(validateEmail(`${'x'.repeat(EMAIL_MAX)}@example.com`)).toBe('too_long');
  });

  it('measures length after trimming, so surrounding space never costs a signup', () => {
    const exact = `${'x'.repeat(EMAIL_MAX - '@example.com'.length)}@example.com`;
    expect(exact.length).toBe(EMAIL_MAX);
    expect(validateEmail(`  ${exact}  `)).toBeNull();
  });

  it('has a message for every failure', () => {
    for (const code of ['missing', 'too_long', 'shape'] as const) {
      expect(emailErrorMessage(code).length).toBeGreaterThan(0);
    }
  });
});

describe('foldEmail', () => {
  it('folds case and surrounding space, and nothing else', () => {
    expect(foldEmail('  Bob@Example.COM ')).toBe('bob@example.com');
    // Deliberately NOT folded: dots and +tags are a Gmail rule, not an
    // email rule, and applying them everywhere would merge two genuinely
    // different mailboxes at a provider that keeps them apart.
    expect(foldEmail('b.o.b@example.com')).not.toBe(foldEmail('bob@example.com'));
    expect(foldEmail('bob+x@example.com')).not.toBe(foldEmail('bob@example.com'));
  });
});

describe('claimHolds', () => {
  it('holds an unconfirmed claim for exactly a week', () => {
    const claim = { claimedAt: 1000, confirmed: false };
    expect(claimHolds(claim, 1000)).toBe(true);
    expect(claimHolds(claim, 1000 + CLAIM_TTL_MS - 1)).toBe(true);
    // The week is up: a squat on somebody else's address ends here.
    expect(claimHolds(claim, 1000 + CLAIM_TTL_MS)).toBe(false);
  });

  it('holds a confirmed claim forever', () => {
    const claim = { claimedAt: 0, confirmed: true };
    expect(claimHolds(claim, CLAIM_TTL_MS * 1000)).toBe(true);
    expect(claimExpiresInMs(claim, CLAIM_TTL_MS * 1000)).toBe(0);
  });

  it('counts down honestly, and never below zero', () => {
    const claim = { claimedAt: 0, confirmed: false };
    expect(claimExpiresInMs(claim, 0)).toBe(CLAIM_TTL_MS);
    expect(claimExpiresInMs(claim, CLAIM_TTL_MS / 2)).toBe(CLAIM_TTL_MS / 2);
    expect(claimExpiresInMs(claim, CLAIM_TTL_MS * 9)).toBe(0);
  });
});

describe('the links and what they say', () => {
  it('takes the origin from PUBLIC_URL, then the edge, then localhost', () => {
    expect(publicOrigin({ PUBLIC_URL: 'https://a.example/' }, ['https://b.example'], 8787)).toBe(
      'https://a.example',
    );
    expect(publicOrigin({}, ['https://b.example', 'https://c.example'], 8787)).toBe(
      'https://b.example',
    );
    // '*' is the edge's escape hatch, not a URL: it must not become one.
    expect(publicOrigin({}, ['*'], 8787)).toBe('http://localhost:8787');
    expect(publicOrigin({}, [], 8787)).toBe('http://localhost:8787');
  });

  it('escapes the token into the query rather than pasting it in', () => {
    const url = confirmUrl('https://a.example', 'tok en/+&');
    expect(url.startsWith('https://a.example/api/email/confirm?token=')).toBe(true);
    expect(new URL(url).searchParams.get('token')).toBe('tok en/+&');
    expect(new URL(resetUrl('https://a.example', 'abc')).pathname).toBe('/reset');
  });

  it('writes a mail a stranger can act on, which means doing nothing', () => {
    const mail = confirmMail('bob@example.com', 'Torvald', 'https://a.example/x', CLAIM_TTL_MS);
    expect(mail.to).toBe('bob@example.com');
    expect(mail.text).toContain('Torvald');
    expect(mail.text).toContain('https://a.example/x');
    // The one thing a wrongly addressed recipient needs to be told.
    expect(mail.text).toContain('ignore this mail');
    expect(mail.text).toContain('7 days');
  });

  it('says how long a reset link lives, in minutes', () => {
    const mail = resetMail('bob@example.com', 'Torvald', 'https://a.example/y', 60 * 60_000);
    expect(mail.text).toContain('60 minutes');
    expect(mail.text).toContain('ignore this mail');
    expect(mail.subject.toLowerCase()).toContain('password');
  });
});
