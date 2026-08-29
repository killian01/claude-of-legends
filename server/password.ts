// Password hashing, the one secret an account has. scrypt from
// node:crypto, so this costs no dependency and no external service
// (ADR 0006): the deployment stays the isolated single process
// docs/deploy.md describes.
//
// There is no password recovery anywhere in the game, so the only thing
// standing between a rating and a stranger is this file and the login
// slowdown next to it (server/login_throttle.ts).

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Node's defaults (N=16384, r=8, p=1) land around 100ms per hash on a
// small box: slow enough that guessing at scale is hopeless, fast enough
// that a login does not stall the tick loop for a human-noticeable beat.
const KEY_LEN = 64;
const SALT_LEN = 16;

// Short enough that nobody is locked out of their own game, long enough
// that the slowdown has something to protect. Stated in the UI, because
// a forgotten password here is a lost account.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export interface PasswordHash {
  salt: string;
  hash: string;
}

export type PasswordError = 'too_short' | 'too_long';

export function validatePassword(plain: string): PasswordError | null {
  if (plain.length < PASSWORD_MIN) return 'too_short';
  if (plain.length > PASSWORD_MAX) return 'too_long';
  return null;
}

export function passwordErrorMessage(err: PasswordError): string {
  return err === 'too_short'
    ? `A password needs at least ${PASSWORD_MIN} characters.`
    : `A password is at most ${PASSWORD_MAX} characters.`;
}

// A fresh salt every time, so the same password twice gives two different
// hashes and the store never reveals that two accounts share one.
export function hashPassword(plain: string): PasswordHash {
  const salt = randomBytes(SALT_LEN).toString('hex');
  return { salt, hash: scryptSync(plain, salt, KEY_LEN).toString('hex') };
}

// Constant-time in the comparison, so a wrong password cannot be walked
// byte by byte off the response time. A malformed stored hash (a
// hand-edited file) decodes short rather than throwing, and the length
// check below turns that into a refusal: a broken record must not take
// the server down, and must never verify.
export function verifyPassword(plain: string, stored: PasswordHash): boolean {
  const expected = Buffer.from(stored.hash, 'hex');
  if (expected.length !== KEY_LEN) return false;
  const actual = scryptSync(plain, stored.salt, KEY_LEN);
  return timingSafeEqual(actual, expected);
}
