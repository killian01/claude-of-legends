// One account in one mode at a time, the 5v5's side (server/classic_seat.ts):
// a tab playing a 5v5 keeps the account's other tabs out of a royale and a
// Thornfray, a tab in either keeps the 5v5's doors shut, and entering either
// takes every tab of the account out of the 5v5's queue and lobbies.

import { describe, expect, it } from 'vitest';
import {
  type ClassicSocket,
  classicDoorRefused,
  classicPlaying,
  leaveClassicDoors,
} from '../server/classic_seat';
import { Matchmaker } from '../server/matchmaker';

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

describe('leaveClassicDoors', () => {
  // Account 10 has three tabs: 1 enters a royale, 5 waits in the 5v5 queue,
  // 6 waits in a lobby it hosts. Account 20's tab 2 waits in the queue too.
  const sockets: ClassicSocket[] = [
    { id: 1, accountId: 10, matchId: null },
    { id: 5, accountId: 10, matchId: null },
    { id: 6, accountId: 10, matchId: null },
    { id: 2, accountId: 20, matchId: null },
  ];
  const setup = () => {
    const sent: { to: number; msg: { t: string; message?: string } }[] = [];
    const formed: unknown[] = [];
    const mm = new Matchmaker(
      (to, msg) => sent.push({ to, msg }),
      (picks) => formed.push(picks),
      () => 'ABCD',
    );
    mm.addToQueue(1, 'ash', 0);
    mm.addToQueue(5, 'ash', 0);
    mm.addToQueue(2, 'birch', 0);
    mm.createLobby(6, 'ash', 0);
    return { mm, sent, formed };
  };

  it("takes the account's other tabs out of the queue and its lobby, and tells them", () => {
    const { mm, sent } = setup();
    const told: number[] = [];
    leaveClassicDoors(
      sockets[0]!,
      sockets,
      (id) => mm.removeEverywhere(id),
      (id) => told.push(id),
    );
    expect(mm.queuedCount).toBe(1);
    expect(mm.removeEverywhere(6)).toBe(false);
    // The entering tab is not told: it is on its way into the royale.
    expect(told).toEqual([5, 6]);
    // The other account still waits, and hears the queue change.
    expect(sent.filter((s) => s.to === 2 && s.msg.t === 'queue_status').length).toBeGreaterThan(1);
  });

  it('tells no tab that was not waiting', () => {
    const { mm } = setup();
    const told: number[] = [];
    const leave = (): void =>
      leaveClassicDoors(
        sockets[0]!,
        sockets,
        (id) => mm.removeEverywhere(id),
        (id) => told.push(id),
      );
    leave();
    leave();
    expect(told).toEqual([5, 6]);
  });
});
