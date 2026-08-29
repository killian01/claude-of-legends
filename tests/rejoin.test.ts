// Seat holds and queue lockouts. Both used to be keyed on the browser's
// session token; keying them on the account is the behaviour change, and
// the two tests that name it are the ones worth reading.

import { describe, expect, it } from 'vitest';
import { RejoinRegistry } from '../server/rejoin';

const seat = (matchId: number, unitId = 1) => ({
  matchId,
  name: 'bob',
  team: 0 as const,
  unitId,
});

describe('seat holds', () => {
  it('hands a dropped seat back to its account, from any browser', () => {
    const r = new RejoinRegistry();
    r.reserve(7, seat(42));
    // The laptop died; this is the phone, a different session entirely.
    // Under the old token key there was nothing to find here.
    expect(r.claim(7)).toMatchObject({ matchId: 42, unitId: 1 });
  });

  it('hands a seat back once and once only', () => {
    const r = new RejoinRegistry();
    r.reserve(7, seat(42));
    expect(r.claim(7)).toBeDefined();
    // A second socket must not be given a champion the first is playing.
    expect(r.claim(7)).toBeUndefined();
  });

  it('holds nothing for an account that walked out on purpose', () => {
    const r = new RejoinRegistry();
    r.reserve(7, seat(42));
    r.drop(7);
    expect(r.claim(7)).toBeUndefined();
  });

  it('drops every hold a closed match had, and no others', () => {
    const r = new RejoinRegistry();
    r.reserve(7, seat(42));
    r.reserve(8, seat(42, 2));
    r.reserve(9, seat(43));
    expect(r.pruneMatch(42)).toBe(2);
    expect(r.claim(7)).toBeUndefined();
    expect(r.claim(9)).toMatchObject({ matchId: 43 });
  });
});

describe('queue lockouts', () => {
  it('counts down and then lets the account queue again', () => {
    const r = new RejoinRegistry();
    r.lockQueue(7, 60_000);
    expect(r.queueLockRemaining(7, 0)).toBe(60_000);
    expect(r.queueLockRemaining(7, 59_000)).toBe(1000);
    expect(r.queueLockRemaining(7, 60_000)).toBe(0);
  });

  it('cannot be escaped by starting a fresh browser session', () => {
    const r = new RejoinRegistry();
    r.lockQueue(7, 60_000);
    // The old lockout was keyed on the browser's session token, so
    // clearing localStorage produced a new key and the penalty vanished.
    // The account is the same account whatever the browser has stored.
    expect(r.queueLockRemaining(7, 1000)).toBe(59_000);
    // And it lands on that account only.
    expect(r.queueLockRemaining(8, 1000)).toBe(0);
  });

  it('forgets a lockout that has run out, rather than keeping it forever', () => {
    const r = new RejoinRegistry();
    r.lockQueue(7, 60_000);
    expect(r.lockedAccounts).toBe(1);
    r.queueLockRemaining(7, 60_000);
    expect(r.lockedAccounts).toBe(0);
  });

  it('leaves an account nobody penalised alone', () => {
    expect(new RejoinRegistry().queueLockRemaining(7, 0)).toBe(0);
  });
});
