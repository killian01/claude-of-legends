// Guests (server/guests.ts, ADR 0024): who they are, how long they last,
// and the one rule they bend, that a match with a Guest in it is unrated.

import { describe, expect, it } from 'vitest';
import { validateName } from '../server/account_name';
import { GuestStore, guestName, guestRefused, isGuestId, ratedWithGuests } from '../server/guests';

describe('guests', () => {
  it('are negative ids no account can hold, under names no account can take', () => {
    let t = 0;
    const store = new GuestStore(
      1000,
      10,
      () => `t${t++}`,
      () => 42,
    );
    const a = store.issue(0).guest;
    const b = store.issue(0).guest;
    expect(a.id).toBeLessThan(0);
    expect(b.id).not.toBe(a.id);
    expect(isGuestId(a.id)).toBe(true);
    expect(isGuestId(1)).toBe(false);
    expect(a.name).toBe('Wanderer 0042');
    expect(validateName(guestName(1234))).not.toBeNull();
  });

  it('come back on their cookie, and are forgotten after a day unused', () => {
    const store = new GuestStore(
      1000,
      10,
      () => 'tok',
      () => 7,
    );
    const { token, guest } = store.issue(0);
    expect(store.resolve(token, 900)?.id).toBe(guest.id);
    // Each use rolls the window forward.
    expect(store.resolve(token, 1800)?.id).toBe(guest.id);
    expect(store.resolve(token, 2801)).toBeUndefined();
    expect(store.resolve('nope', 0)).toBeUndefined();
  });

  it('are bounded: the oldest goes when the store is full', () => {
    let t = 0;
    const store = new GuestStore(
      1000,
      3,
      () => `t${t++}`,
      () => 1,
    );
    for (let i = 0; i < 5; i++) store.issue(i);
    expect(store.size).toBe(3);
    expect(store.resolve('t0', 5)).toBeUndefined();
    expect(store.resolve('t4', 5)).toBeDefined();
  });

  it('make the match they sit in unrated, for everyone', () => {
    expect(ratedWithGuests(true, [3, 8])).toBe(true);
    expect(ratedWithGuests(true, [3, -1])).toBe(false);
    expect(ratedWithGuests(false, [3, 8])).toBe(false);
    expect(ratedWithGuests(true, [])).toBe(true);
  });

  it('have the public queue and the match, and no other door', () => {
    for (const t of ['hello', 'queue', 'start_now', 'pick', 'leave', 'chat', 'ping']) {
      expect(guestRefused({ t })).toBe(false);
    }
    expect(guestRefused({ t: 'queue', forge: true })).toBe(true);
    for (const t of [
      'create_lobby',
      'join_lobby',
      'lobby_team',
      'queue_party',
      'start_lobby',
      'spectate',
    ]) {
      expect(guestRefused({ t })).toBe(true);
    }
  });
});
