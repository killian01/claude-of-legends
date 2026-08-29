// The login slowdown. The load-bearing property is the one it does NOT
// have: no failure count ever locks an account, because a lockout would
// let anyone bench the top of the ladder by failing logins at their name.

import { describe, expect, it } from 'vitest';
import {
  accountKey,
  addressKey,
  BASE_DELAY_MS,
  FREE_ATTEMPTS,
  LoginThrottle,
  MAX_DELAY_MS,
} from '../server/login_throttle';

describe('login throttle', () => {
  it('costs nothing for the first few mistakes', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < FREE_ATTEMPTS; i++) expect(t.recordFailure('a:bob', 0)).toBe(0);
    expect(t.retryAfterMs('a:bob', 0)).toBe(0);
  });

  it('doubles the wait past the free attempts, up to the cap', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < FREE_ATTEMPTS; i++) t.recordFailure('a:bob', 0);
    expect(t.recordFailure('a:bob', 0)).toBe(BASE_DELAY_MS);
    expect(t.recordFailure('a:bob', 0)).toBe(BASE_DELAY_MS * 2);
    expect(t.recordFailure('a:bob', 0)).toBe(BASE_DELAY_MS * 4);
    for (let i = 0; i < 30; i++) t.recordFailure('a:bob', 0);
    expect(t.recordFailure('a:bob', 0)).toBe(MAX_DELAY_MS);
  });

  it('never locks: the wait always runs out on its own', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 100; i++) t.recordFailure('a:bob', 0);
    // However hard an attacker hammers the name, bob himself gets in by
    // waiting out one capped delay. There is no state that stays shut.
    expect(t.retryAfterMs('a:bob', MAX_DELAY_MS)).toBe(0);
  });

  it('clears the key on a correct password', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 10; i++) t.recordFailure('a:bob', 0);
    expect(t.retryAfterMs('a:bob', 0)).toBeGreaterThan(0);
    t.recordSuccess('a:bob');
    expect(t.retryAfterMs('a:bob', 0)).toBe(0);
  });

  it('counts the account and the address apart, and takes the worse', () => {
    const t = new LoginThrottle();
    const acct = accountKey('bob');
    const addr = addressKey('203.0.113.7');
    for (let i = 0; i < FREE_ATTEMPTS + 3; i++) t.recordFailure(addr, 0);
    // bob's own name is clean; the machine sweeping names is not.
    expect(t.retryAfterMs(acct, 0)).toBe(0);
    expect(t.retryAfterMs(addr, 0)).toBeGreaterThan(0);
    expect(t.retryAfterAny([acct, addr], 0)).toBe(t.retryAfterMs(addr, 0));
  });

  it('forgets a key nobody has failed on in a while', () => {
    const t = new LoginThrottle();
    t.recordFailure('a:bob', 0);
    expect(t.trackedKeys).toBe(1);
    expect(t.purge(1000, 60_000)).toBe(0);
    expect(t.purge(60_000, 60_000)).toBe(1);
    expect(t.trackedKeys).toBe(0);
  });

  it('keeps a key that is still serving a delay, however old', () => {
    const t = new LoginThrottle();
    for (let i = 0; i < FREE_ATTEMPTS + 5; i++) t.recordFailure('a:bob', 0);
    // Old enough to forget, but the wait it owes has not run out yet.
    expect(t.purge(BASE_DELAY_MS, 0)).toBe(0);
    expect(t.trackedKeys).toBe(1);
  });
});
