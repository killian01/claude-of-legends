// Guests (server/guests.ts, ADR 0024 amended by ADR 0027): who they are,
// how long they last, the one rule they bend, that a match with a Guest in
// it is unrated, and what is kept of one that scores or names itself: its
// line, under a hashed token and an id that survives a restart.

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateName } from '../server/account_name';
import {
  GUEST_KEPT_TTL_MS,
  GUEST_TTL_MS,
  GuestStore,
  guestName,
  guestNameMessage,
  guestNameRefusal,
  guestRefused,
  isGuestId,
  ratedWithGuests,
  tokenDigest,
} from '../server/guests';

const dirs: string[] = [];
function tmpFile(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'loc-guests-'));
  dirs.push(d);
  return path.join(d, 'guests.json');
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function seqTokens(prefix = 't'): () => string {
  let n = 0;
  return () => `${prefix}${n++}`;
}

const noAccount = (): boolean => false;

describe('guests', () => {
  it('are negative ids no account can hold, under names no account can take', () => {
    const store = new GuestStore({ ttlMs: 1000, max: 10, tokenGen: seqTokens(), digits: () => 42 });
    const a = store.issue(0).guest;
    const b = store.issue(0).guest;
    expect(a.id).toBeLessThan(0);
    expect(b.id).not.toBe(a.id);
    expect(isGuestId(a.id)).toBe(true);
    expect(isGuestId(1)).toBe(false);
    expect(a.name).toBe('Wanderer 0042');
    expect(a.points).toBe(0);
    expect(a.named).toBe(false);
    expect(validateName(guestName(1234))).not.toBeNull();
  });

  it('come back on their cookie, and are forgotten after a day unused', () => {
    const store = new GuestStore({
      ttlMs: 1000,
      max: 10,
      tokenGen: () => 'tok',
      digits: () => 7,
    });
    const { token, guest } = store.issue(0);
    expect(store.resolve(token, 900)?.id).toBe(guest.id);
    // Each use rolls the window forward.
    expect(store.resolve(token, 1800)?.id).toBe(guest.id);
    expect(store.resolve(token, 2801)).toBeUndefined();
    expect(store.resolve('nope', 0)).toBeUndefined();
  });

  it('are bounded: the oldest with nothing kept goes when the store is full', () => {
    const store = new GuestStore({ ttlMs: 1000, max: 3, tokenGen: seqTokens(), digits: () => 1 });
    const first = store.issue(0).guest;
    // The first one scores, so it is kept whatever happens to the rest.
    store.addPoints(first.id, 5, 0);
    for (let i = 1; i < 6; i++) store.issue(i);
    expect(store.resolve('t0', 6)?.id).toBe(first.id);
    expect(store.resolve('t1', 6)).toBeUndefined();
    expect(store.resolve('t5', 6)).toBeDefined();
    expect(store.size).toBe(4);
  });

  it('make the match they sit in unrated, for everyone', () => {
    expect(ratedWithGuests(true, [3, 8])).toBe(true);
    expect(ratedWithGuests(true, [3, -1])).toBe(false);
    expect(ratedWithGuests(false, [3, 8])).toBe(false);
    expect(ratedWithGuests(true, [])).toBe(true);
  });

  it('have the public queue and the match, and no other door', () => {
    for (const t of ['hello', 'queue', 'start_now', 'pick', 'lane', 'leave', 'chat', 'ping']) {
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

describe('a kept Guest', () => {
  it('is written once it scores, under the hash of its token, and found again', () => {
    const file = tmpFile();
    const store = new GuestStore({ file, tokenGen: () => 'secret-token', digits: () => 4821 });
    const { token, guest } = store.issue(0);
    // Nothing worth keeping yet: nothing on disk.
    store.flush();
    expect(() => statSync(file)).toThrow();
    expect(store.addPoints(guest.id, 12, 10)).toBe(12);
    expect(store.addPoints(guest.id, 3, 20)).toBe(15);
    store.flush();
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain(token);
    expect(raw).toContain(tokenDigest(token));

    const again = new GuestStore({ file });
    const back = again.resolve(token, 30);
    expect(back).toMatchObject({ id: guest.id, name: 'Wanderer 4821', points: 15 });
  });

  it('banks points in memory only, until the flush', () => {
    const file = tmpFile();
    const store = new GuestStore({ file, tokenGen: seqTokens() });
    const { guest } = store.issue(0);
    store.addPoints(guest.id, 1, 0);
    store.flush();
    const before = readFileSync(file, 'utf8');
    for (let i = 0; i < 50; i++) store.addPoints(guest.id, 1, i);
    expect(readFileSync(file, 'utf8')).toBe(before);
    store.flush();
    expect(new GuestStore({ file }).findById(guest.id)?.points).toBe(51);
  });

  it('keeps its id across a restart, and no one after it is handed that id again', () => {
    const file = tmpFile();
    const store = new GuestStore({ file, tokenGen: seqTokens() });
    const a = store.issue(0).guest;
    const b = store.issue(0).guest;
    store.addPoints(a.id, 1, 0);
    store.addPoints(b.id, 1, 0);
    store.flush();
    // b becomes an account: its line is retired, and its id stays spent.
    store.retire(b.id);
    const again = new GuestStore({ file, tokenGen: seqTokens('u') });
    expect(again.findById(a.id)?.points).toBe(1);
    expect(again.findById(b.id)).toBeUndefined();
    const c = again.issue(1).guest;
    expect(c.id).toBeLessThan(b.id);
    expect(c.id).not.toBe(a.id);
  });

  it('leaves the Guests with nothing kept out of the file, so a restart forgets them', () => {
    const file = tmpFile();
    const store = new GuestStore({ file, tokenGen: seqTokens() });
    const kept = store.issue(0).guest;
    store.issue(0);
    store.addPoints(kept.id, 2, 0);
    store.flush();
    const again = new GuestStore({ file });
    expect(again.resolve('t0', 1)?.id).toBe(kept.id);
    expect(again.resolve('t1', 1)).toBeUndefined();
  });

  it('lives a year after it was last seen, where one with nothing kept lives a day', () => {
    const store = new GuestStore({ tokenGen: seqTokens() });
    const kept = store.issue(0).guest;
    store.issue(0);
    store.addPoints(kept.id, 1, 0);
    expect(store.resolve('t1', GUEST_TTL_MS + 1)).toBeUndefined();
    expect(store.resolve('t0', GUEST_KEPT_TTL_MS)?.id).toBe(kept.id);
    expect(store.resolve('t0', 2 * GUEST_KEPT_TTL_MS + 1)).toBeUndefined();
  });

  it('is written when it names itself, even with no points', () => {
    const file = tmpFile();
    const store = new GuestStore({ file, tokenGen: seqTokens() });
    const { guest } = store.issue(0);
    expect(store.setName(guest.id, 'Starling', 5, noAccount).ok).toBe(true);
    const again = new GuestStore({ file });
    expect(again.resolve('t0', 6)).toMatchObject({ name: 'Starling', named: true, points: 0 });
    expect(again.holderOf('starling')).toBe(guest.id);
  });
});

describe('a Guest naming itself', () => {
  it('follows the account name rules and the word filter', () => {
    expect(guestNameRefusal('ab')).toBe('too_short');
    expect(guestNameRefusal('a'.repeat(17))).toBe('too_long');
    expect(guestNameRefusal('Two Words')).toBe('charset');
    expect(guestNameRefusal('shit_head')).toBe('blocked');
    expect(guestNameRefusal('BigShit')).toBe('blocked');
    expect(guestNameRefusal('Starling')).toBeNull();
    // Every refusal says why in words.
    for (const err of ['too_short', 'charset', 'blocked', 'taken', 'unknown_guest'] as const) {
      expect(guestNameMessage(err).length).toBeGreaterThan(10);
    }
  });

  it('cannot take a name an account holds or once held, or another Guest holds', () => {
    const store = new GuestStore({ tokenGen: seqTokens() });
    const a = store.issue(0).guest;
    const b = store.issue(0).guest;
    const accounts = new Set(['bob']);
    const held = (fold: string): boolean => accounts.has(fold);
    expect(store.setName(a.id, 'B_o_b', 1, held)).toEqual({ ok: false, error: 'taken' });
    expect(store.setName(a.id, 'Starling', 1, held).ok).toBe(true);
    expect(store.setName(b.id, 'starling', 1, held)).toEqual({ ok: false, error: 'taken' });
    // Its own name in another case is still its own.
    expect(store.setName(a.id, 'STARLING', 1, held).ok).toBe(true);
    expect(store.findById(a.id)?.name).toBe('STARLING');
  });

  it('gives back the name it leaves, one name at a time', () => {
    const store = new GuestStore({ tokenGen: seqTokens() });
    const a = store.issue(0).guest;
    const b = store.issue(0).guest;
    store.setName(a.id, 'Starling', 1, noAccount);
    store.setName(a.id, 'Nightjar', 2, noAccount);
    expect(store.holderOf('starling')).toBeUndefined();
    expect(store.setName(b.id, 'Starling', 3, noAccount).ok).toBe(true);
  });

  it('frees the name when the Guest is retired', () => {
    const store = new GuestStore({ tokenGen: seqTokens() });
    const a = store.issue(0).guest;
    store.setName(a.id, 'Starling', 1, noAccount);
    store.retire(a.id);
    expect(store.holderOf('starling')).toBeUndefined();
    expect(store.setName(-99, 'Starling', 1, noAccount)).toEqual({
      ok: false,
      error: 'unknown_guest',
    });
  });
});
