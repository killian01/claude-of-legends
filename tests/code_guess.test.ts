// The lobby code guards (server/code_guess.ts): one budget per internet
// connection for wrong lobby codes, lobbies opened and Guest names changed,
// the codes this process issued answering closed, and bounded memory.

import { describe, expect, it } from 'vitest';
import {
  budgetKey,
  CodeGuard,
  CREATE_WINDOW_MS,
  CREATES_ALLOWED,
  lobbyCode,
  MAX_OPEN_LOBBIES_PER_KEY,
  NAME_WINDOW_MS,
  NAMES_ALLOWED,
  TOMBSTONE_MS,
  WRONG_CODE_WINDOW_MS,
  WRONG_CODES_ALLOWED,
} from '../server/code_guess';

// A code made of the n-th letters, distinct for each n below 26 * 26.
const codeN = (n: number): string =>
  `QQQQ${String.fromCharCode(65 + Math.floor(n / 26))}${String.fromCharCode(65 + (n % 26))}`;

describe('budgetKey', () => {
  it('keeps an IPv4 address whole', () => {
    expect(budgetKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('folds an IPv6 address to its /64, however it is written', () => {
    const a = budgetKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(a).toBe('2001:db8:1:2::/64');
    expect(budgetKey('2001:0db8:0001:0002:1:2:3:4')).toBe(a);
    expect(budgetKey('2001:db8:1:2::9')).toBe(a);
    expect(budgetKey('2001:DB8:1:2::9%eth0')).toBe(a);
    expect(budgetKey('2001:db8:1:3::9')).not.toBe(a);
    expect(budgetKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(budgetKey('::1')).toBe('0:0:0:0::/64');
  });

  it('reads a mapped IPv4 address as the IPv4 address', () => {
    expect(budgetKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('keeps anything it cannot read as one bucket of its own', () => {
    expect(budgetKey('unknown')).toBe('unknown');
    expect(budgetKey('1:2:3')).toBe('1:2:3');
  });
});

describe('lobbyCode', () => {
  it('takes 5 or 6 letters, uppercased, and nothing else', () => {
    expect(lobbyCode('abcdef')).toBe('ABCDEF');
    expect(lobbyCode('ABCDE')).toBe('ABCDE');
    expect(lobbyCode('ABCD')).toBeNull();
    expect(lobbyCode('ABCDEFG')).toBeNull();
    expect(lobbyCode('ABC1EF')).toBeNull();
    expect(lobbyCode(42)).toBeNull();
    expect(lobbyCode(undefined)).toBeNull();
  });
});

describe('wrong codes', () => {
  it('allows twenty distinct wrong codes per connection, then refuses', () => {
    const g = new CodeGuard();
    for (let i = 0; i < WRONG_CODES_ALLOWED; i++) {
      expect(g.limited('k', 0, false)).toBe(false);
      g.miss('k', codeN(i), 0);
    }
    expect(g.limited('k', 0, false)).toBe(true);
    // Another connection has its own budget.
    expect(g.limited('other', 0, false)).toBe(false);
  });

  it('charges the same code once, however often it is asked', () => {
    const g = new CodeGuard();
    for (let i = 0; i < 100; i++) g.miss('k', 'DEADLK', 0);
    expect(g.misses('k', 0)).toBe(1);
    expect(g.limited('k', 0, false)).toBe(false);
    // The same code in another case is the same code.
    g.miss('k', 'deadlk', 0);
    expect(g.misses('k', 0)).toBe(1);
  });

  it('forgets a wrong code ten minutes after it was charged', () => {
    const g = new CodeGuard();
    for (let i = 0; i < WRONG_CODES_ALLOWED; i++) g.miss('k', codeN(i), i);
    expect(g.limited('k', WRONG_CODE_WINDOW_MS - 1, false)).toBe(true);
    expect(g.limited('k', WRONG_CODE_WINDOW_MS + 1, false)).toBe(false);
    expect(g.misses('k', WRONG_CODE_WINDOW_MS + 1)).toBe(WRONG_CODES_ALLOWED - 1);
  });

  // A malformed ask reaches the guard as null: the string is never kept.
  it('counts each malformed ask as one miss', () => {
    const g = new CodeGuard();
    for (let i = 0; i < WRONG_CODES_ALLOWED; i++) g.miss('k', null, 0);
    expect(g.misses('k', 0)).toBe(WRONG_CODES_ALLOWED);
    expect(g.limited('k', 0, false)).toBe(true);
    expect(g.limited('k', WRONG_CODE_WINDOW_MS + 1, false)).toBe(false);
  });

  it("never refuses a remembered member's way back to their own lobby", () => {
    const g = new CodeGuard();
    for (let i = 0; i < WRONG_CODES_ALLOWED; i++) g.miss('k', codeN(i), 0);
    expect(g.limited('k', 0, true)).toBe(false);
    expect(g.limited('k', 0, false)).toBe(true);
  });

  it('answers a code it issued as closed, never charged', () => {
    const g = new CodeGuard();
    g.issued('OLDONE', 0);
    expect(g.tombstoned('OLDONE', 1000)).toBe(true);
    expect(g.tombstoned('oldone', 1000)).toBe(true);
    g.miss('k', 'OLDONE', 1000);
    expect(g.misses('k', 1000)).toBe(0);
    // A day later it is any other wrong code.
    expect(g.tombstoned('OLDONE', TOMBSTONE_MS + 1)).toBe(false);
    g.miss('k', 'OLDONE', TOMBSTONE_MS + 1);
    expect(g.misses('k', TOMBSTONE_MS + 1)).toBe(1);
  });

  it('keeps a bounded number of issued codes, the oldest dropped first', () => {
    const g = new CodeGuard({ maxTombstones: 3 });
    for (const [i, c] of ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD'].entries()) g.issued(c, i);
    expect(g.tombstoned('AAAAAA', 10)).toBe(false);
    expect(g.tombstoned('DDDDDD', 10)).toBe(true);
  });
});

describe('creating lobbies', () => {
  it('allows ten lobbies per connection per ten minutes', () => {
    const g = new CodeGuard();
    for (let i = 0; i < CREATES_ALLOWED; i++) expect(g.mayCreate('k', i, 0)).toBe(true);
    expect(g.mayCreate('k', 100, 0)).toBe(false);
    expect(g.mayCreate('other', 100, 0)).toBe(true);
    expect(g.mayCreate('k', CREATE_WINDOW_MS + 1, 0)).toBe(true);
  });

  it('refuses a sixth lobby whose opener is still in it, without charging', () => {
    const g = new CodeGuard();
    expect(g.mayCreate('k', 0, MAX_OPEN_LOBBIES_PER_KEY)).toBe(false);
    for (let i = 0; i < CREATES_ALLOWED; i++) {
      expect(g.mayCreate('k', 0, MAX_OPEN_LOBBIES_PER_KEY - 1)).toBe(true);
    }
  });
});

describe('naming', () => {
  it('allows five successful renames per connection per hour', () => {
    const g = new CodeGuard();
    for (let i = 0; i < NAMES_ALLOWED; i++) {
      expect(g.mayRename('k', i)).toBe(true);
      g.renamed('k', i);
    }
    expect(g.mayRename('k', 10)).toBe(false);
    expect(g.mayRename('other', 10)).toBe(true);
    expect(g.mayRename('k', NAME_WINDOW_MS + 5)).toBe(true);
  });

  it('counts only what was renamed, never what was only asked', () => {
    const g = new CodeGuard();
    for (let i = 0; i < 50; i++) expect(g.mayRename('k', i)).toBe(true);
  });
});

describe('memory', () => {
  it('purges what ran out, and drops a connection with nothing left', () => {
    const g = new CodeGuard();
    g.miss('a', 'AAAAAA', 0);
    g.mayCreate('b', 0, 0);
    g.renamed('c', 0);
    g.issued('ZZZZZZ', 0);
    expect(g.trackedKeys).toBe(3);
    g.purge(NAME_WINDOW_MS + 1);
    expect(g.trackedKeys).toBe(0);
    g.purge(TOMBSTONE_MS + 1);
    expect(g.tombstoned('ZZZZZZ', TOMBSTONE_MS + 1)).toBe(false);
  });

  it('holds at most so many connections, the oldest dropped first', () => {
    const g = new CodeGuard({ maxKeys: 2 });
    g.miss('a', 'AAAAAA', 0);
    g.miss('b', 'AAAAAA', 1);
    g.miss('c', 'AAAAAA', 2);
    expect(g.trackedKeys).toBe(2);
    expect(g.misses('a', 3)).toBe(0);
    expect(g.misses('c', 3)).toBe(1);
  });
});
