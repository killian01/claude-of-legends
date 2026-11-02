// One account in one mode at a time, the 5v5's side (server/classic_seat.ts):
// a tab playing a 5v5 keeps the account's other tabs out of a royale and a
// Thornfray, and a tab in either keeps the 5v5's doors shut.

import { describe, expect, it } from 'vitest';
import { type ClassicSocket, classicDoorRefused, classicPlaying } from '../server/classic_seat';

// Match 7 runs with clients 1 and 2 seated; client 3 only watches it.
// Match 8 has ended with client 4 still on its end screen.
const seated = (matchId: number, clientId: number): boolean =>
  matchId === 7 && (clientId === 1 || clientId === 2);

describe('classicPlaying', () => {
  const sockets: ClassicSocket[] = [
    { id: 1, accountId: 10, matchId: 7 },
    { id: 5, accountId: 10, matchId: null },
    { id: 3, accountId: 30, matchId: 7 },
    { id: 4, accountId: 40, matchId: 8 },
    { id: 6, accountId: 50, matchId: null },
  ];

  it('counts a seat in a running 5v5 from any tab of the account', () => {
    expect(classicPlaying(10, sockets, seated)).toBe(true);
  });

  it('does not count a spectator, an ended match, or a socket in no match', () => {
    expect(classicPlaying(30, sockets, seated)).toBe(false);
    expect(classicPlaying(40, sockets, seated)).toBe(false);
    expect(classicPlaying(50, sockets, seated)).toBe(false);
  });

  it('does not count a seat whose owner has no socket in it (left to its bot)', () => {
    expect(classicPlaying(20, sockets, seated)).toBe(false);
  });
});

describe('classicDoorRefused', () => {
  const doors = ['queue', 'start_now', 'create_lobby', 'join_lobby', 'queue_party'];

  it('shuts every door into a 5v5 while the account plays elsewhere', () => {
    for (const t of doors) expect(classicDoorRefused(t, () => true)).toBe(true);
  });

  it('opens them otherwise', () => {
    for (const t of doors) expect(classicDoorRefused(t, () => false)).toBe(false);
  });

  it('leaves every other message alone, and asks nothing for it', () => {
    let asked = 0;
    const elsewhere = (): boolean => {
      asked++;
      return true;
    };
    for (const t of ['leave', 'lobby_team', 'spectate', 'cmd', 'ping']) {
      expect(classicDoorRefused(t, elsewhere)).toBe(false);
    }
    expect(asked).toBe(0);
  });
});
