// A socket leaving its 5v5 without walking out (server/classic_drop.ts):
// the seat goes to its bot and is held for the account at once, so a tab
// taking the connection over gets it back on its hello, before the old
// socket's close handler has run.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dropFromClassic } from '../server/classic_drop';
import { rejoinClassic } from '../server/classic_rejoin';
import { RejoinRegistry } from '../server/rejoin';
import type { TeamId } from '../src/sim/types';

interface Seat {
  name: string;
  team: TeamId;
  unitId: number;
}

function fakeEntry(players: Map<number, Seat>) {
  const spectators = new Set<number>([9]);
  return {
    spectators,
    abandonedAt: null as number | null,
    endedAt: null as number | null,
    match: {
      players,
      removeSpectator: (cid: number) => void spectators.delete(cid),
      handleDisconnect: (cid: number): Seat | null => {
        const p = players.get(cid);
        if (!p) return null;
        players.delete(cid);
        return { ...p };
      },
      restorePlayer: (cid: number, seat: Seat) => void players.set(cid, seat),
    },
  };
}

function hooks(open: Set<number>) {
  const log: string[] = [];
  return {
    log,
    hooks: {
      report: () => void log.push('report'),
      left: (_e: unknown, seat: Seat) => void log.push(`left ${seat.unitId}`),
      connected: (cid: number) => open.has(cid),
      abandoned: (m: number) => void log.push(`abandoned ${m}`),
    },
  };
}

describe('dropFromClassic', () => {
  it('holds the seat for the account and forgets the match, once', () => {
    const entry = fakeEntry(
      new Map([
        [1, { name: 'ash', team: 0, unitId: 3 }],
        [2, { name: 'birch', team: 1, unitId: 7 }],
      ]),
    );
    const matches = new Map([[4, entry]]);
    const rejoins = new RejoinRegistry();
    const socket = { id: 1, accountId: 50, matchId: 4 as number | null };
    const { log, hooks: h } = hooks(new Set([1, 2]));
    dropFromClassic(socket, matches, rejoins, 1000, h);
    expect(socket.matchId).toBeNull();
    expect(rejoins.held(50)).toEqual({ matchId: 4, name: 'ash', team: 0, unitId: 3 });
    expect(entry.match.players.has(1)).toBe(false);
    expect(entry.abandonedAt).toBeNull();
    expect(log).toEqual(['report', 'left 3']);
    // The close handler later finds nothing left to do.
    dropFromClassic(socket, matches, rejoins, 2000, h);
    expect(log).toEqual(['report', 'left 3']);
  });

  it('marks the match abandoned when no one connected plays it', () => {
    const entry = fakeEntry(new Map([[1, { name: 'ash', team: 0, unitId: 3 }]]));
    const { log, hooks: h } = hooks(new Set([1]));
    dropFromClassic(
      { id: 1, accountId: 50, matchId: 4 },
      new Map([[4, entry]]),
      new RejoinRegistry(),
      1000,
      h,
    );
    expect(entry.abandonedAt).toBe(1000);
    expect(log).toContain('abandoned 4');
  });

  it('lets a spectator just stop watching, with no seat held', () => {
    const entry = fakeEntry(new Map([[1, { name: 'ash', team: 0, unitId: 3 }]]));
    const rejoins = new RejoinRegistry();
    const { hooks: h } = hooks(new Set([1, 9]));
    dropFromClassic({ id: 9, accountId: 60, matchId: 4 }, new Map([[4, entry]]), rejoins, 0, h);
    expect(entry.spectators.has(9)).toBe(false);
    expect(rejoins.held(60)).toBeUndefined();
    expect(entry.abandonedAt).toBeNull();
  });

  it("hands the seat to the new tab's hello while the old socket is still open", () => {
    const entry = fakeEntry(
      new Map([
        [1, { name: 'ash', team: 0, unitId: 3 }],
        [2, { name: 'birch', team: 1, unitId: 7 }],
      ]),
    );
    const matches = new Map([[4, entry]]);
    const rejoins = new RejoinRegistry();
    // Socket 1 is still in the server's clients: its close has not run.
    const { hooks: h } = hooks(new Set([1, 2, 5]));
    dropFromClassic({ id: 1, accountId: 50, matchId: 4 }, matches, rejoins, 0, h);
    const back = rejoinClassic(rejoins, matches, 50, 5);
    expect(back?.start).toEqual({ t: 'match_start', selfUnitId: 3, team: 0 });
    expect(entry.match.players.get(5)).toMatchObject({ name: 'ash', team: 0, unitId: 3 });
  });
});

describe('the takeover in main.ts', () => {
  const mainTs = readFileSync(fileURLToPath(new URL('../server/main.ts', import.meta.url)), 'utf8');

  it("leaves the old socket's match on the spot, not only at its close", () => {
    const takeover = /other\.ws\.close\(4409[^;]*;([^}]*)\}/.exec(mainTs);
    expect(takeover).not.toBeNull();
    expect(takeover![1]).toMatch(/leaveMatchesOnDrop\(other, now\)/);
    expect(mainTs).toMatch(/ws\.on\('close'[\s\S]*?leaveMatchesOnDrop\(client, Date\.now\(\)\)/);
  });

  it('drops the 5v5 seat, the royale and the Thornfray in one place', () => {
    const fn = /function leaveMatchesOnDrop\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(mainTs);
    expect(fn).not.toBeNull();
    expect(fn![1]).toMatch(/thornfray\.disconnect\(client\)/);
    expect(fn![1]).toMatch(/royale\.disconnect\(client\)/);
    expect(fn![1]).toMatch(/dropFromClassic\(client, matches, rejoins/);
  });

  it('ignores a message from a socket that is being closed', () => {
    expect(mainTs).toMatch(
      /ws\.on\('message', \(data\) => \{[^}]*if \(ws\.readyState !== ws\.OPEN\) return;/,
    );
  });
});
