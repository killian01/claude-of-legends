// The private lobby screen's words (ADR 0036): each member's row and its
// tags, who sees Remove and Change, the status line in every phase, the
// hint for a Guest host still wearing a handed-out name, and the words the
// client flow says around a lobby session (src/main.ts runOnline). Pure, so
// a test reads every word without a browser; ui/menu.ts showLobby draws
// them from the server's lobby message (src/net/protocol.ts).

import type { LobbyPlayer, ServerMsg } from '../net/protocol';
import type { TeamId } from '../sim/types';
import { nameSuggestion } from './points_text';

export type LobbyMsg = Extract<ServerMsg, { t: 'lobby' }>;

export const LOBBY_HOST_TAG = 'host';
export const LOBBY_YOU_TAG = '(you)';
export const LOBBY_PLAYING_TAG = 'in the match';
export const LOBBY_BACK_TAG = 'coming back';
// A member whose connection dropped, held for a short grace: a reload, a
// phone that slept. Never counted as coming back from the match.
export const LOBBY_AWAY_TAG = 'reconnecting';
export const LOBBY_REMOVE = 'Remove';
export const LOBBY_CHANGE = 'Change';
export const LOBBY_REJOIN = 'Rejoin the match';
// The end screen's first button and the party queue's Cancel when the
// session belongs to a lobby that lives on.
export const LOBBY_BACK_TO = 'Back to the lobby';
// How long a notice (a refusal that leaves the lobby standing) stays up,
// unless the next one takes its place.
export const LOBBY_NOTICE_MS = 8000;
// The server's answer for a code it cannot seat (server/matchmaker.ts),
// which a join session turns into lobbyClosedWords.
export const LOBBY_GONE_ERROR = 'Lobby not found or full.';
export const LOBBY_DISCONNECTED =
  'Disconnected from the lobby. Open your invite link again to come back.';
// A Guest's way into a lobby when the server hands out no Guest.
export const GUEST_NO_ANSWER = 'The server did not answer. Try again in a moment.';

export interface LobbyRow {
  n: number;
  name: string;
  team: TeamId;
  tags: string[];
  // The host's Remove (lobby_remove with n).
  remove: boolean;
  // A Guest's own name, changed in place.
  change: boolean;
}

export function lobbyRows(msg: LobbyMsg, guest: boolean): LobbyRow[] {
  const open = msg.phase === undefined;
  return msg.players.map((p) => {
    const tags: string[] = [];
    if (p.host) tags.push(LOBBY_HOST_TAG);
    if (p.you) tags.push(LOBBY_YOU_TAG);
    if (p.playing) tags.push(LOBBY_PLAYING_TAG);
    if (p.back) tags.push(LOBBY_BACK_TAG);
    if (p.away) tags.push(LOBBY_AWAY_TAG);
    return {
      n: p.n,
      name: p.name,
      team: p.team,
      tags,
      remove: msg.host && open && p.you !== true,
      change: guest && p.you === true,
    };
  });
}

// A row holding a seat: one coming back, or reconnecting, holds none yet.
function holdsSeat(p: LobbyPlayer): boolean {
  return p.back !== true && p.away !== true;
}

// The members holding a seat on a side.
export function seatedOn(players: readonly LobbyPlayer[], team: TeamId): number {
  return players.filter((p) => p.team === team && holdsSeat(p)).length;
}

// A party of up to five present members can queue together; a full lobby
// starts its own match.
export function partyFits(players: readonly LobbyPlayer[]): boolean {
  return players.filter(holdsSeat).length <= 5;
}

// What browser Back does in a lobby session (src/main.ts runOnline): in
// the party queue a lobby opened, what its Back to the lobby does ('again'
// with the code); anywhere else, what Leave does.
export function sessionBackAction(partyQueue: boolean, lobbyCode: string | null): 'again' | 'menu' {
  return partyQueue && lobbyCode !== null ? 'again' : 'menu';
}

// Start match and Queue as a party: the host of an open lobby.
export function canStart(msg: LobbyMsg): boolean {
  return msg.host && msg.phase === undefined;
}

export function lobbyStatus(msg: LobbyMsg): { line: string; rejoin: boolean } {
  if (msg.seat && (msg.phase === 'select' || msg.phase === 'match')) {
    return { line: 'Your seat in this match is kept for you.', rejoin: true };
  }
  if (msg.phase === 'select') {
    return {
      line: 'Your lobby is choosing champions. You will play the next match.',
      rejoin: false,
    };
  }
  if (msg.phase === 'match') {
    return { line: 'Your lobby is in a match. You will play the next one.', rejoin: false };
  }
  if (msg.phase === 'queue') {
    return { line: 'Your lobby is queued for a match. You will play the next one.', rejoin: false };
  }
  // The host is named even while reconnecting: the server holds the host's
  // place through the grace. Only a return from the match is counted.
  const parts: string[] = [];
  if (!msg.host) {
    const host = msg.players.find((p) => p.host);
    parts.push(host ? `Waiting for ${host.name} to start.` : 'Waiting for the host to start.');
  }
  const back = msg.players.filter((p) => p.back).length;
  if (back > 0) parts.push(`${back} coming back from the match.`);
  return { line: parts.join(' '), rejoin: false };
}

// A name the server handed out ('Wanderer 0042'): the space is what no
// chosen name can hold (server/guests.ts guestName).
export function handedOutName(name: string): boolean {
  return /\s/.test(name);
}

// What the name field offers: a handed-out name without what the name
// rules refuse, a chosen one as it is (ui/points_text.ts nameSuggestion).
export function lobbyNameValue(name: string): string {
  return nameSuggestion({
    rank: null,
    points: 0,
    name,
    guest: true,
    named: !handedOutName(name),
  });
}

export function lobbyHint(msg: LobbyMsg, guest: boolean): string | null {
  if (!guest || !msg.host) return null;
  const me = msg.players.find((p) => p.you);
  if (!me || !handedOutName(me.name)) return null;
  return `Friends see you as ${me.name}. Change it so they know it is you.`;
}

// A join session told the lobby is gone: `returning` when the code came
// from Back to the lobby or a lobby the tab remembered, else from a typed
// code or a link. A Guest's way out lands on the landing.
export function lobbyClosedWords(
  returning: boolean,
  guest: boolean,
): { title: string; line: string; button: string } {
  const button = guest ? 'Back' : 'Back to menu';
  if (returning) {
    return {
      title: 'Your lobby has closed',
      line: 'It stayed empty too long, or the game was updated. Open a new one and send the new link.',
      button,
    };
  }
  return {
    title: 'This lobby has closed',
    line: 'Ask your friend for a new link, or open your own.',
    button,
  };
}
