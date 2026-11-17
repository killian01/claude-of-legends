// One account in one mode at a time, the 5v5's side (server/classic_seat.ts):
// a tab playing a 5v5 keeps the account's other tabs out of a royale and a
// Thornfray, a tab in either keeps the 5v5's doors shut, and entering either
// takes every tab of the account out of the 5v5's queue and lobbies.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type ClassicSocket,
  classicDoorRefused,
  classicPlaying,
  classicSeatHeld,
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

describe('classicSeatHeld', () => {
  const running = (matchId: number): boolean => matchId === 7;

  it('counts a seat held for the account in a running 5v5', () => {
    expect(classicSeatHeld({ matchId: 7 }, running)).toBe(true);
  });

  it('does not count no hold, or a hold whose match has ended or is gone', () => {
    expect(classicSeatHeld(undefined, running)).toBe(false);
    expect(classicSeatHeld({ matchId: 8 }, running)).toBe(false);
  });
});

// One game socket per account: a new tab closes the old one. The old one
// leaves the queues at once, not when its close handshake ends, so a Start
// from the new tab in between never seats the account twice.
describe('a tab taking over from another', () => {
  const mainTs = readFileSync(fileURLToPath(new URL('../server/main.ts', import.meta.url)), 'utf8');

  it('takes the closed socket out of every matchmaker on the spot', () => {
    const takeover = /other\.ws\.close\(4409[^;]*;([^}]*)\}/.exec(mainTs);
    expect(takeover).not.toBeNull();
    expect(takeover![1]).toMatch(
      /for \(const mm of matchmakers\) mm\.removeEverywhere\(other\.id, now, 'drop'\)/,
    );
  });

  it('then seats only the new tab when Start takes the queue', () => {
    const selects: number[] = [];
    const mm = new Matchmaker(
      (to, msg) => {
        if (msg.t === 'select_start') selects.push(to);
      },
      () => 1,
      () => 'ABCD',
    );
    // Tab 1 of an account waits; tab 5 of it connects and takes over.
    mm.addToQueue(1, 'ash', 0);
    mm.addToQueue(2, 'birch', 0);
    expect(mm.removeEverywhere(1, 0, 'drop')).toBe(true);
    mm.addToQueue(5, 'ash', 0);
    mm.startNow(5, 0);
    expect(selects.sort()).toEqual([2, 5]);
  });
});

// The wiring in server/main.ts: the 5v5's doors ask about a 5v5 seat the
// account plays from another tab, not only a royale or a Thornfray. Without
// it a second tab could queue, or drop into a live 5v5 (even the same
// match, on the other side), while the first tab plays.
describe('the 5v5 door guard in main.ts', () => {
  const mainTs = readFileSync(fileURLToPath(new URL('../server/main.ts', import.meta.url)), 'utf8');

  it('shuts the doors while another tab of the account plays a 5v5', () => {
    const guard = /classicDoorRefused\(\s*msg\.t,\s*\(\) =>([^;]*?)\)\s*\)\s*\{/.exec(mainTs);
    expect(guard).not.toBeNull();
    const asks = guard![1]!;
    expect(asks).toContain('royale.playing(client.accountId)');
    expect(asks).toContain('thornfray.holds(client.accountId)');
    expect(asks).toContain('playsClassic(client.accountId)');
  });

  it('shuts them while the account has a seat held in a running 5v5', () => {
    expect(mainTs).toMatch(/classicSeatHeld\(\s*rejoins\.held\(client\.accountId\)/);
  });
});
