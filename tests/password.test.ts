// The only secret an account has. Round-trip, rejection, salt freshness,
// and a broken stored record failing closed instead of throwing.

import { describe, expect, it } from 'vitest';
import { hashPassword, PASSWORD_MIN, validatePassword, verifyPassword } from '../server/password';

describe('passwords', () => {
  it('verifies the password it hashed', () => {
    const stored = hashPassword('correct horse');
    expect(verifyPassword('correct horse', stored)).toBe(true);
  });

  it('refuses the wrong password, including a near miss', () => {
    const stored = hashPassword('correct horse');
    expect(verifyPassword('correct hors', stored)).toBe(false);
    expect(verifyPassword('Correct horse', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('salts every hash, so the same password stores differently twice', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    // Both still verify: the difference is the salt, not the password.
    expect(verifyPassword('same password', a)).toBe(true);
    expect(verifyPassword('same password', b)).toBe(true);
  });

  it('holds the length bounds', () => {
    expect(validatePassword('a'.repeat(PASSWORD_MIN))).toBeNull();
    expect(validatePassword('a'.repeat(PASSWORD_MIN - 1))).toBe('too_short');
    expect(validatePassword('a'.repeat(1000))).toBe('too_long');
  });

  it('fails closed on a stored record that is not a hash', () => {
    expect(verifyPassword('anything', { salt: 'aa', hash: 'not hex' })).toBe(false);
    expect(verifyPassword('anything', { salt: 'aa', hash: '' })).toBe(false);
    expect(verifyPassword('anything', { salt: 'aa', hash: 'ab12' })).toBe(false);
  });
});
