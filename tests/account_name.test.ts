// Account name rules: the charset, the bounds, and above all the folding
// that decides when two names are the same name (CONTEXT.md).

import { describe, expect, it } from 'vitest';
import { foldName, NAME_MAX, validateName } from '../server/account_name';

describe('account names', () => {
  it('accepts a plain name and keeps the case the owner typed', () => {
    expect(validateName('Torvald')).toBeNull();
    expect(validateName('bob')).toBeNull();
    expect(validateName('x_9-Z')).toBeNull();
  });

  it('refuses anything outside letters, digits and the two separators', () => {
    expect(validateName('bob smith')).toBe('charset');
    expect(validateName('bob!')).toBe('charset');
    expect(validateName('bób')).toBe('charset');
    // A Greek omicron reads as an o and is exactly the impersonation the
    // ASCII rule exists to stop.
    expect(validateName('bοb')).toBe('charset');
    expect(validateName('')).toBe('charset');
  });

  it('holds the length bounds', () => {
    expect(validateName('ab')).toBe('too_short');
    expect(validateName('a'.repeat(NAME_MAX))).toBeNull();
    expect(validateName('a'.repeat(NAME_MAX + 1))).toBe('too_long');
  });

  it('refuses a name that is long enough only because of separators', () => {
    expect(validateName('a-b')).toBe('too_short');
    expect(validateName('___')).toBe('too_short');
  });

  it('folds case and separators, so those names are one name', () => {
    const one = foldName('bob');
    expect(foldName('Bob')).toBe(one);
    expect(foldName('BOB')).toBe(one);
    expect(foldName('b_o_b')).toBe(one);
    expect(foldName('b-o-b')).toBe(one);
    expect(foldName('B-o_B')).toBe(one);
  });

  it('keeps genuinely different names apart', () => {
    expect(foldName('bob')).not.toBe(foldName('rob'));
    expect(foldName('bob1')).not.toBe(foldName('bob'));
  });
});
