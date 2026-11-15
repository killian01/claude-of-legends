// The private lobby's own rules (server/lobby.ts, ADR 0036): who is the same
// person, who hosts, who fits where, who is shown, what is forgotten, and
// when a lobby expires. Pure: the Matchmaker holds the records.

import { describe, expect, it } from 'vitest';
import {
  addMember,
  admit,
  DROP_GRACE_MS,
  fateOf,
  forgetOldest,
  hostOf,
  LOBBY_IDLE_MS,
  LOBBY_MEMORY,
  LOBBY_PLAY_GUARD_MS,
  LOBBY_REMOVED,
  LOBBY_TTL_MS,
  type Lobby,
  type LobbyMember,
  lobbyMessage,
  mergeAccounts,
  openLobby,
  removeFromLobby,
  RETURN_GRACE_MS,
  reopen,
  returningCount,
  seatedCount,
  spendGraces,
} from '../server/lobby';

// A lobby opened by client 1 (account 101) at time 0.
function lobby(): Lobby {
  return openLobby('ABCDEF', { clientId: 1, accountId: 101, name: 'opener' }, 0, 'k');
}

function join(l: Lobby, clientId: number, accountId: number | null, name = `p${clientId}`) {
  const a = admit(l, clientId, accountId);
  if (a.kind !== 'new') throw new Error(`expected a newcomer, got ${a.kind}`);
  return addMember(l, { clientId, accountId, name, team: a.team });
}

const member = (l: Lobby, n: number): LobbyMember => l.members.find((m) => m.n === n)!;

describe('the record', () => {
  it('opens with its opener on the first side, numbered 1, nothing played', () => {
    const l = lobby();
    expect(l).toMatchObject({ code: 'ABCDEF', phase: 'open', round: 0, matchId: null });
    expect(l.members).toEqual([
      expect.objectContaining({ n: 1, clientId: 1, accountId: 101, team: 0, inPlay: false }),
    ]);
    expect(l.createdBy).toBe('k');
  });

  it('numbers members from 1 and never reuses a number', () => {
    const l = lobby();
    join(l, 2, 102);
    join(l, 3, 103);
    l.members.splice(1, 1);
    expect(join(l, 4, 104).n).toBe(4);
  });
});

describe('who is the same person', () => {
  it('the same socket, or the same known account; an unknown account never matches', () => {
    const l = lobby();
    join(l, 2, null);
    expect(admit(l, 1, null).kind).toBe('already');
    expect(admit(l, 9, 101).kind).toBe('rebind');
    // Two sockets nobody can name are two people.
    expect(admit(l, 3, null).kind).toBe('new');
  });

  it('refuses an account the host removed, whatever socket it comes on', () => {
    const l = lobby();
    removeFromLobby(l, join(l, 2, 102));
    expect(admit(l, 7, 102).kind).toBe('refused');
    expect(admit(l, 8, 103).kind).toBe('new');
  });
});

describe('who hosts', () => {
  it('the opener while present, else the next present member in join order', () => {
    const l = lobby();
    join(l, 2, 102);
    join(l, 3, 103);
    expect(hostOf(l, 0)?.n).toBe(1);
    member(l, 1).clientId = null;
    expect(hostOf(l, 0)?.n).toBe(2);
    member(l, 1).clientId = 1;
    expect(hostOf(l, 0)?.n).toBe(1);
  });

  it('veterans of the last match before everyone else', () => {
    const l = lobby();
    join(l, 2, 102);
    join(l, 3, 103);
    member(l, 3).veteran = true;
    member(l, 1).clientId = null;
    expect(hostOf(l, 0)?.n).toBe(3);
  });

  it('holds through a grace: an away host keeps it until the grace ends', () => {
    const l = lobby();
    join(l, 2, 102);
    member(l, 1).clientId = null;
    member(l, 1).awayUntil = DROP_GRACE_MS;
    expect(hostOf(l, 10)?.n).toBe(1);
    expect(hostOf(l, DROP_GRACE_MS)?.n).toBe(2);
  });

  it('nobody while the lobby is not open', () => {
    const l = lobby();
    for (const phase of ['queue', 'select', 'match'] as const) {
      l.phase = phase;
      expect(hostOf(l, 0)).toBeNull();
    }
  });
});

describe('who fits where', () => {
  it('a newcomer takes the emptier side', () => {
    const l = lobby();
    expect(join(l, 2, 102).team).toBe(1);
    expect(join(l, 3, 103).team).toBe(0);
  });

  it('seats and sides count members in play, present or not', () => {
    const l = lobby();
    for (let i = 2; i <= 10; i++) join(l, i, 100 + i);
    for (const m of l.members) {
      m.inPlay = true;
      m.playClientId = m.clientId;
      m.clientId = null;
    }
    expect(seatedCount(l)).toBe(10);
    expect(admit(l, 11, 111).kind).toBe('refused');
    // A member whose seat is held is always let in, on its side.
    expect(admit(l, 12, 105)).toMatchObject({ kind: 'seat', held: true, team: member(l, 5).team });
  });

  it('a member back after a match takes their side, else the other one', () => {
    const l = lobby();
    const back = join(l, 2, 102);
    expect(back.team).toBe(1);
    back.clientId = null;
    expect(admit(l, 20, 102)).toMatchObject({ kind: 'seat', held: false, team: 1 });
    for (let i = 3; i <= 7; i++)
      addMember(l, { clientId: i, accountId: 100 + i, name: 'x', team: 1 });
    expect(seatedCount(l, 1)).toBe(5);
    expect(admit(l, 20, 102)).toMatchObject({ kind: 'seat', team: 0 });
  });

  it('nobody but a held seat past ten seated', () => {
    const l = lobby();
    for (let i = 2; i <= 10; i++) join(l, i, 100 + i);
    expect(admit(l, 11, 111).kind).toBe('refused');
    member(l, 2).clientId = null;
    expect(admit(l, 11, 111).kind).toBe('new');
    // The absent member comes back to a full lobby once 11 sits.
    join(l, 11, 111);
    expect(admit(l, 21, 102).kind).toBe('refused');
  });
});

describe('what each member is told', () => {
  it('rows: who sits, the host, your own row, and what is in play', () => {
    const l = lobby();
    join(l, 2, 102, 'friend');
    const host = lobbyMessage(l, member(l, 1), 0);
    expect(host).toEqual({
      t: 'lobby',
      code: 'ABCDEF',
      host: true,
      team: 0,
      players: [
        { n: 1, name: 'opener', team: 0, host: true, you: true },
        { n: 2, name: 'friend', team: 1 },
      ],
    });
    const friend = lobbyMessage(l, member(l, 2), 0, 'Hello.');
    expect(friend).toMatchObject({ host: false, team: 1, notice: 'Hello.' });
    expect(friend.players[1]).toEqual({ n: 2, name: 'friend', team: 1, you: true });
  });

  it('while the lobby plays: its phase, the rows in play, and a held seat', () => {
    const l = lobby();
    join(l, 2, 102, 'waiter');
    const p = member(l, 1);
    p.inPlay = true;
    p.playClientId = 1;
    p.clientId = null;
    l.phase = 'match';
    const waiter = lobbyMessage(l, member(l, 2), 0);
    expect(waiter).toMatchObject({ host: false, phase: 'match' });
    expect(waiter).not.toHaveProperty('seat');
    expect(waiter.players).toEqual([
      { n: 1, name: 'opener', team: 0, playing: true },
      { n: 2, name: 'waiter', team: 1, you: true },
    ]);
    // Back on a lobby socket while the seat is held.
    p.clientId = 5;
    expect(lobbyMessage(l, p, 0)).toMatchObject({ phase: 'match', seat: true });
  });

  it('a member coming back from the match shows as a back row through the grace', () => {
    const l = lobby();
    join(l, 2, 102);
    const m = member(l, 2);
    m.clientId = null;
    m.inPlay = true;
    l.phase = 'match';
    reopen(l, 1000, true);
    expect(lobbyMessage(l, member(l, 1), 1000).players[1]).toEqual({
      n: 2,
      name: 'p2',
      team: 1,
      back: true,
    });
    expect(returningCount(l, 1000)).toBe(1);
    expect(lobbyMessage(l, member(l, 1), 1000 + RETURN_GRACE_MS).players).toHaveLength(1);
    // A dropped socket within its grace is not coming back from a match: it
    // shows as away, and goes with the grace.
    m.inPlay = false;
    m.returning = false;
    m.awayUntil = 5000 + DROP_GRACE_MS;
    expect(lobbyMessage(l, member(l, 1), 5000).players[1]).toEqual({
      n: 2,
      name: 'p2',
      team: 1,
      away: true,
    });
    expect(returningCount(l, 5000)).toBe(0);
    expect(lobbyMessage(l, member(l, 1), 5000 + DROP_GRACE_MS).players).toHaveLength(1);
  });

  it('a reload in a lobby that never played shows as away, never as back from the match', () => {
    const l = lobby();
    join(l, 2, 102);
    const m = member(l, 2);
    m.clientId = null;
    m.awayUntil = DROP_GRACE_MS;
    const row = lobbyMessage(l, member(l, 1), 10).players[1]!;
    expect(row).toEqual({ n: 2, name: 'p2', team: 1, away: true });
    expect(row.back).toBeUndefined();
  });

  it('names a host whose socket dropped, on an away row, while the role waits for them', () => {
    const l = lobby();
    join(l, 2, 102);
    member(l, 1).clientId = null;
    member(l, 1).awayUntil = DROP_GRACE_MS;
    expect(lobbyMessage(l, member(l, 2), 10).players[0]).toEqual({
      n: 1,
      name: 'opener',
      team: 0,
      host: true,
      away: true,
    });
  });

  it('never shows a removed member', () => {
    const l = lobby();
    removeFromLobby(l, join(l, 2, 102));
    expect(lobbyMessage(l, member(l, 1), 0).players).toHaveLength(1);
  });
});

describe('reopening', () => {
  it('after a match: open again, the next round, those who played on their way back', () => {
    const l = lobby();
    join(l, 2, 102);
    for (const m of l.members) {
      m.inPlay = true;
      m.playClientId = m.clientId;
      m.clientId = null;
    }
    l.phase = 'match';
    l.round = 1;
    l.matchId = 7;
    l.startedAt = 0;
    reopen(l, 500, true);
    expect(l).toMatchObject({ phase: 'open', round: 2, matchId: null, startedAt: null });
    expect(l.emptySince).toBe(500);
    expect(l.lastActivity).toBe(500);
    for (const m of l.members) {
      expect(m).toMatchObject({ inPlay: false, playClientId: null, returning: true });
      expect(m.awayUntil).toBe(500 + RETURN_GRACE_MS);
    }
  });

  it('otherwise: nobody is marked coming back', () => {
    const l = lobby();
    l.members[0]!.inPlay = true;
    l.members[0]!.clientId = null;
    l.phase = 'select';
    reopen(l, 500, false);
    expect(l.members[0]).toMatchObject({ inPlay: false, awayUntil: null, returning: false });
  });

  it('spends the graces that ran out', () => {
    const l = lobby();
    const m = join(l, 2, 102);
    m.clientId = null;
    m.awayUntil = 100;
    m.returning = true;
    expect(spendGraces(l, 99)).toBe(false);
    expect(spendGraces(l, 100)).toBe(true);
    expect(m).toMatchObject({ awayUntil: null, returning: false });
    expect(spendGraces(l, 200)).toBe(false);
  });
});

describe('memory', () => {
  it('keeps at most so many members: never the opener, one in play or within a grace', () => {
    const l = lobby();
    l.members[0]!.clientId = null;
    for (let i = 2; i <= LOBBY_MEMORY + 3; i++) {
      addMember(l, { clientId: null, accountId: 100 + i, name: 'x', team: 0 });
    }
    member(l, 2).inPlay = true;
    member(l, 3).awayUntil = 1000;
    forgetOldest(l, 0);
    expect(l.members).toHaveLength(LOBBY_MEMORY);
    expect(l.members.slice(0, 3).map((m) => m.n)).toEqual([1, 2, 3]);
    expect(l.members.map((m) => m.n)).not.toContain(4);
  });

  it('a removed member is dropped, and only their id is kept', () => {
    const l = lobby();
    const m = join(l, 2, 102, 'friend');
    removeFromLobby(l, m);
    expect(l.members.map((x) => x.n)).toEqual([1]);
    expect(l.removed).toEqual([102]);
    expect(JSON.stringify(l)).not.toContain('friend');
    // A member nobody can name leaves no id behind.
    removeFromLobby(l, join(l, 3, null));
    expect(l.removed).toEqual([102]);
  });

  it('keeps at most so many removed ids, the oldest dropped first', () => {
    const l = lobby();
    for (let i = 0; i < LOBBY_REMOVED + 2; i++) removeFromLobby(l, join(l, 10 + i, 200 + i));
    expect(l.removed).toHaveLength(LOBBY_REMOVED);
    expect(admit(l, 9, 200).kind).toBe('new');
    expect(admit(l, 9, 202).kind).toBe('refused');
  });

  it('forgetting old members never washes a removal out', () => {
    const l = lobby();
    removeFromLobby(l, join(l, 2, 102));
    for (let i = 0; i < LOBBY_MEMORY + 5; i++) {
      addMember(l, { clientId: null, accountId: 300 + i, name: 'x', team: 0 });
      forgetOldest(l, 0);
    }
    expect(admit(l, 9, 102).kind).toBe('refused');
  });

  it('a present member is never forgotten', () => {
    const l = lobby();
    for (let i = 2; i <= LOBBY_MEMORY + 1; i++) {
      addMember(l, { clientId: i, accountId: 100 + i, name: 'x', team: 0 });
    }
    forgetOldest(l, 0);
    expect(l.members).toHaveLength(LOBBY_MEMORY + 1);
  });
});

describe('fate', () => {
  it('an empty open lobby goes after the TTL; one never played after a drop grace', () => {
    const l = lobby();
    l.members[0]!.clientId = null;
    l.emptySince = 1000;
    expect(fateOf(l, 1000 + DROP_GRACE_MS - 1)).toBe('keep');
    expect(fateOf(l, 1000 + DROP_GRACE_MS)).toBe('drop');
    l.round = 2;
    expect(fateOf(l, 1000 + LOBBY_TTL_MS)).toBe('keep');
    expect(fateOf(l, 1000 + LOBBY_TTL_MS + 1)).toBe('drop');
  });

  it('an open lobby with people in it expires after so long without activity', () => {
    const l = lobby();
    l.lastActivity = 50;
    expect(fateOf(l, 50 + LOBBY_IDLE_MS)).toBe('keep');
    expect(fateOf(l, 50 + LOBBY_IDLE_MS + 1)).toBe('expire');
  });

  it('a playing lobby never expires, and reopens past the play guard', () => {
    const l = lobby();
    l.members[0]!.clientId = null;
    l.emptySince = 0;
    l.phase = 'match';
    l.startedAt = 10;
    expect(fateOf(l, 10 + LOBBY_PLAY_GUARD_MS)).toBe('keep');
    expect(fateOf(l, 10 + LOBBY_PLAY_GUARD_MS + 1)).toBe('reopen');
    l.phase = 'queue';
    l.startedAt = null;
    expect(fateOf(l, 100 * LOBBY_PLAY_GUARD_MS)).toBe('keep');
  });
});

describe('mergeAccounts', () => {
  it('a Guest retired into an account keeps its record under the new id', () => {
    const l = lobby();
    join(l, 2, -5);
    expect(mergeAccounts(l, -5, 77)).toBe(true);
    expect(member(l, 2).accountId).toBe(77);
    expect(mergeAccounts(l, -6, 78)).toBe(false);
  });

  it('a removed Guest retired into an account stays refused under the new id', () => {
    const l = lobby();
    removeFromLobby(l, join(l, 2, -5));
    expect(mergeAccounts(l, -5, 77)).toBe(true);
    expect(l.removed).toEqual([77]);
    expect(admit(l, 9, 77).kind).toBe('refused');
  });

  it('two records of one person become the earlier one, play and sockets kept', () => {
    const l = lobby();
    const guest = join(l, 2, -5);
    guest.clientId = null;
    guest.inPlay = true;
    guest.playClientId = 9;
    join(l, 3, 77);
    expect(mergeAccounts(l, 77, -5)).toBe(true);
    expect(l.members).toHaveLength(2);
    expect(member(l, 2)).toMatchObject({
      accountId: -5,
      clientId: 3,
      inPlay: true,
      playClientId: 9,
    });
  });
});
