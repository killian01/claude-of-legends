// The lobby screen's words (src/ui/lobby_view.ts, ADR 0036): the rows and
// their tags, who sees Remove and Change, the status line in every phase,
// the hint for a handed-out name, and the words for a lobby that closed.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LobbyPlayer } from '../src/net/protocol';
import {
  canStart,
  GUEST_NO_ANSWER,
  handedOutName,
  LOBBY_AWAY_TAG,
  LOBBY_BACK_TO,
  LOBBY_DISCONNECTED,
  LOBBY_EXPIRED_ERROR,
  LOBBY_GONE_ERROR,
  LOBBY_NOTICE_MS,
  LOBBY_REMOVED_ERROR,
  type LobbyMsg,
  lobbyClosedWords,
  lobbyHint,
  lobbyNameValue,
  lobbyRows,
  lobbyStatus,
  lobbyVerdict,
  partyFits,
  seatedOn,
  sessionBackAction,
} from '../src/ui/lobby_view';

const ME: LobbyPlayer = { n: 1, name: 'Ilsa', team: 0, host: true, you: true };
const FRIEND: LobbyPlayer = { n: 2, name: 'Wanderer 0042', team: 1 };

function msg(over: Partial<LobbyMsg> = {}): LobbyMsg {
  return { t: 'lobby', code: 'KMNPQR', host: true, team: 0, players: [ME, FRIEND], ...over };
}

describe('the lobby rows', () => {
  it('tags the host, the reader, a member in the match and one coming back', () => {
    const rows = lobbyRows(
      msg({
        host: false,
        players: [
          { n: 1, name: 'Ilsa', team: 0, host: true },
          { n: 2, name: 'Bram', team: 0, you: true },
          { n: 3, name: 'Cato', team: 1, playing: true },
          { n: 4, name: 'Dara', team: 1, back: true },
        ],
      }),
      false,
    );
    expect(rows.map((r) => [r.n, r.name, r.tags])).toEqual([
      [1, 'Ilsa', ['host']],
      [2, 'Bram', ['(you)']],
      [3, 'Cato', ['in the match']],
      [4, 'Dara', ['coming back']],
    ]);
  });

  it('offers the host a Remove on every other row while the lobby is open', () => {
    const rows = lobbyRows(
      msg({ players: [ME, FRIEND, { n: 3, name: 'Dara', team: 1, back: true }] }),
      false,
    );
    expect(rows.map((r) => r.remove)).toEqual([false, true, true]);
    // Nobody else, and nobody while the lobby plays.
    expect(lobbyRows(msg({ host: false }), false).some((r) => r.remove)).toBe(false);
    expect(lobbyRows(msg({ phase: 'match' }), false).some((r) => r.remove)).toBe(false);
  });

  it('offers a Guest a Change on its own row, and an account none', () => {
    expect(lobbyRows(msg(), true).map((r) => r.change)).toEqual([true, false]);
    expect(lobbyRows(msg(), false).some((r) => r.change)).toBe(false);
  });

  it('tags a member whose connection dropped as reconnecting, never as coming back', () => {
    const rows = lobbyRows(
      msg({ players: [ME, { n: 2, name: 'Bram', team: 1, away: true }] }),
      false,
    );
    expect(rows.map((r) => [r.n, r.tags])).toEqual([
      [1, ['host', '(you)']],
      [2, ['reconnecting']],
    ]);
    expect(LOBBY_AWAY_TAG).toBe('reconnecting');
  });

  it('counts a side by who holds a seat, not who is coming back', () => {
    const players: LobbyPlayer[] = [
      { n: 1, name: 'a', team: 1 },
      { n: 2, name: 'b', team: 1, playing: true },
      { n: 3, name: 'c', team: 1, back: true },
      { n: 4, name: 'd', team: 1, away: true },
    ];
    expect(seatedOn(players, 1)).toBe(2);
    expect(seatedOn(players, 0)).toBe(0);
  });

  it('lets a party of up to five present members queue', () => {
    const five = [1, 2, 3, 4, 5].map((n) => ({ n, name: `p${n}`, team: 0 as const }));
    expect(partyFits(five)).toBe(true);
    expect(partyFits([...five, { n: 6, name: 'p6', team: 1, back: true }])).toBe(true);
    expect(partyFits([...five, { n: 6, name: 'p6', team: 1, away: true }])).toBe(true);
    expect(partyFits([...five, { n: 6, name: 'p6', team: 1 }])).toBe(false);
  });
});

describe('the lobby status line', () => {
  it('says nothing extra to the host of an open lobby: Start is the call', () => {
    expect(lobbyStatus(msg())).toEqual({ line: '', rejoin: false });
    expect(canStart(msg())).toBe(true);
    expect(canStart(msg({ host: false }))).toBe(false);
    expect(canStart(msg({ phase: 'select' }))).toBe(false);
  });

  it('names the host to everyone else', () => {
    const view = msg({
      host: false,
      players: [
        { ...ME, you: undefined },
        { ...FRIEND, you: true },
      ],
    });
    expect(lobbyStatus(view).line).toBe('Waiting for Ilsa to start.');
  });

  it('counts who is coming back from the match', () => {
    const back = [
      ME,
      { n: 2, name: 'b', team: 1, back: true },
      { n: 3, name: 'c', team: 1, back: true },
    ] satisfies LobbyPlayer[];
    expect(lobbyStatus(msg({ players: back })).line).toBe('2 coming back from the match.');
    const waiting = msg({
      host: false,
      players: back.map((p, i) => (i === 0 ? { ...p, you: undefined } : p)),
    });
    expect(lobbyStatus(waiting).line).toBe(
      'Waiting for Ilsa to start. 2 coming back from the match.',
    );
  });

  it('never counts a dropped connection as coming back from the match', () => {
    const players = [
      ME,
      { n: 2, name: 'b', team: 1, away: true },
      { n: 3, name: 'c', team: 1, back: true },
    ] satisfies LobbyPlayer[];
    expect(lobbyStatus(msg({ players })).line).toBe('1 coming back from the match.');
    const onlyAway = [ME, { n: 2, name: 'b', team: 1, away: true }] satisfies LobbyPlayer[];
    expect(lobbyStatus(msg({ players: onlyAway })).line).toBe('');
  });

  it('still names a host whose connection dropped, held through the grace', () => {
    const view = msg({
      host: false,
      players: [
        { n: 1, name: 'Ilsa', team: 0, host: true, away: true },
        { ...FRIEND, you: true },
      ],
    });
    expect(lobbyStatus(view).line).toBe('Waiting for Ilsa to start.');
    expect(lobbyRows(view, false)[0]!.tags).toEqual(['host', 'reconnecting']);
  });

  it('tells a waiter what the lobby is doing', () => {
    expect(lobbyStatus(msg({ host: false, phase: 'select' })).line).toBe(
      'Your lobby is choosing champions. You will play the next match.',
    );
    expect(lobbyStatus(msg({ host: false, phase: 'match' })).line).toBe(
      'Your lobby is in a match. You will play the next one.',
    );
    expect(lobbyStatus(msg({ host: false, phase: 'queue' })).line).toBe(
      'Your lobby is queued for a match. You will play the next one.',
    );
  });

  it('offers a held seat back', () => {
    expect(lobbyStatus(msg({ host: false, phase: 'match', seat: true }))).toEqual({
      line: 'Your seat in this match is kept for you.',
      rejoin: true,
    });
    expect(lobbyStatus(msg({ host: false, phase: 'select', seat: true })).rejoin).toBe(true);
  });

  it('keeps a notice up for eight seconds', () => {
    expect(LOBBY_NOTICE_MS).toBe(8000);
  });
});

describe("a Guest's name in the lobby", () => {
  it('tells a Guest host with a handed-out name to pick one', () => {
    const view = msg({ players: [{ ...ME, name: 'Wanderer 0042' }, FRIEND] });
    expect(lobbyHint(view, true)).toBe(
      'Friends see you as Wanderer 0042. Change it so they know it is you.',
    );
    // A name of its own, an account, or a Guest who does not host: no hint.
    expect(lobbyHint(msg(), true)).toBeNull();
    expect(lobbyHint(view, false)).toBeNull();
    expect(lobbyHint({ ...view, host: false }, true)).toBeNull();
  });

  it('knows a handed-out name by its space, and offers it without one', () => {
    expect(handedOutName('Wanderer 0042')).toBe(true);
    expect(handedOutName('Ilsa')).toBe(false);
    expect(lobbyNameValue('Wanderer 0042')).toBe('Wanderer0042');
    expect(lobbyNameValue('Ilsa_9')).toBe('Ilsa_9');
  });
});

describe('the words around a lobby session', () => {
  it('says a lobby closed in friendly words, by the way the reader came', () => {
    expect(lobbyClosedWords(true, false)).toEqual({
      title: 'Your lobby has closed',
      line: 'It stayed empty too long, or the game was updated. Open a new one and send the new link.',
      button: 'Back to menu',
    });
    expect(lobbyClosedWords(false, true)).toEqual({
      title: 'This lobby has closed',
      line: 'Ask your friend for a new link, or open your own.',
      button: 'Back',
    });
  });

  it('pins the words the client flow says', () => {
    expect(LOBBY_GONE_ERROR).toBe('Lobby not found or full.');
    expect(LOBBY_BACK_TO).toBe('Back to the lobby');
    expect(LOBBY_DISCONNECTED).toBe(
      'Disconnected from the lobby. Open your invite link again to come back.',
    );
    expect(GUEST_NO_ANSWER).toBe('The server did not answer. Try again in a moment.');
  });

  // Browser Back follows the screen showing: in the party queue a lobby
  // opened, it is that queue's Back to the lobby; anywhere else, Leave.
  it('sends Back in a party queue back to the lobby, and leaves from anywhere else', () => {
    expect(sessionBackAction(true, 'KMNPQR')).toBe('again');
    expect(sessionBackAction(true, null)).toBe('menu');
    expect(sessionBackAction(false, 'KMNPQR')).toBe('menu');
    expect(sessionBackAction(false, null)).toBe('menu');
  });

  // The server's verdicts that end the reader's place in the lobby: the tab
  // forgets the code before the notice, so a reload goes home.
  it("knows the verdicts that end a place in the lobby, in the server's own words", () => {
    expect(LOBBY_REMOVED_ERROR).toBe('You were removed from the lobby.');
    expect(LOBBY_EXPIRED_ERROR).toBe('Lobby expired.');
    expect(lobbyVerdict(LOBBY_REMOVED_ERROR)).toBe(true);
    expect(lobbyVerdict(LOBBY_EXPIRED_ERROR)).toBe(true);
    expect(lobbyVerdict(LOBBY_GONE_ERROR)).toBe(false);
    expect(lobbyVerdict('Too many private lobbies opened from this connection.')).toBe(false);
    const server = readFileSync(new URL('../server/matchmaker.ts', import.meta.url), 'utf8');
    expect(server).toContain(`message: '${LOBBY_REMOVED_ERROR}'`);
    expect(server).toContain(`message: '${LOBBY_EXPIRED_ERROR}'`);
  });
});
