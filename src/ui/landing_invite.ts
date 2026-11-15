// The invitation on the landing (ADR 0036): what the band under the bar
// says to someone who followed an invite link to a private lobby without
// an account, read off the landing's answer (src/net/landing.ts
// LandingInvite); the name they join under; which code a sign-in still
// owes; and the code line under the ways to play. Pure, so a test reads
// every state without a browser; ui/invite_card.ts draws the band and
// ui/landing.ts the code line.

import { normalizeJoinCode } from '../game/invite';
import type { LandingInvite, LandingOwn } from '../net/landing';
import type { LandingDoor, LandingPlay } from './landing_modes';
import { editValue, nameShapeError } from './own_panel';

export const INVITE_TITLE = 'You are invited to a private lobby';
export const INVITE_CALL = 'Join the lobby';
export const INVITE_FIELD_LABEL = 'Your name (also your name on the ladder)';
export const INVITE_SIGN_IN = 'Sign in';
export const INVITE_REGISTER = 'Create an account';
export const INVITE_NOT_NOW = 'Not now';
export const INVITE_OPEN_OWN = 'Open a lobby';

// The band's state, by the answer: no answer yet (or none came), an open
// lobby, a full one, a closed one (unknown, expired and closed read alike),
// a connection over its wrong codes, whose lobby was not looked up, or the
// reader's own lobby, coming back to it (never full: their place is kept).
export type InviteState = 'waiting' | 'open' | 'full' | 'closed' | 'limited' | 'member';

export interface InviteWords {
  state: InviteState;
  title: string;
  line: string;
}

export function inviteState(invite: LandingInvite | null | undefined): InviteState {
  if (!invite) return 'waiting';
  if (!invite.open) return invite.limited ? 'limited' : 'closed';
  if (invite.member) return 'member';
  return invite.players >= invite.seats ? 'full' : 'open';
}

function openLine(invite: Extract<LandingInvite, { open: true }>): string {
  if (invite.phase === 'queue') return 'They are queued for a match. Join to play the next one.';
  if (invite.phase) return 'They are in a match now. Join to play the next one.';
  if (invite.players === 0) return 'Nobody in it yet: you will be the first.';
  return `${invite.players} of ${invite.seats} in the lobby. A 5v5 among friends, never rated.`;
}

export function inviteWords(invite: LandingInvite | null | undefined): InviteWords {
  const state = inviteState(invite);
  if (state === 'open' && invite?.open) {
    return {
      state,
      title: `${invite.host} invited you to a private lobby`,
      line: openLine(invite),
    };
  }
  switch (state) {
    case 'member':
      return {
        state,
        title: 'Back to your private lobby',
        line: 'Your place is kept. Join to go back in.',
      };
    case 'full':
      return {
        state,
        title: 'This lobby is full',
        line: 'Ask your friend to make room, or open your own.',
      };
    case 'closed':
      return {
        state,
        title: 'This lobby has closed',
        line: 'Ask your friend for a new link, or open your own.',
      };
    case 'limited':
      return {
        state,
        title: INVITE_TITLE,
        line: 'Too many wrong lobby codes from this connection. Try again in a few minutes.',
      };
    default:
      return { state, title: INVITE_TITLE, line: '' };
  }
}

// One gold call breathes at a time: the band while its invitation can be
// taken, the Play now card once it cannot.
export function breathes(state: InviteState): boolean {
  return state === 'waiting' || state === 'open' || state === 'member';
}

// Join, as a Guest, by the code; and a lobby of one's own, offered by a
// full or closed one.
export function inviteDoor(code: string): LandingDoor {
  return { call: INVITE_CALL, kind: 'guest', play: { to: 'lobby', code } };
}
export const OPEN_OWN_DOOR: LandingDoor = {
  call: INVITE_OPEN_OWN,
  kind: 'guest',
  play: { to: 'lobby' },
};

// How the visitor left the band, and the code a sign-in still owes after
// it: kept through Sign in and Create an account (the account goes into
// the lobby on the other side), dropped by every other way out. A band
// never answered keeps it too: the code starts pending.
export type InviteExit = 'join' | 'open_own' | 'not_now' | 'sign_in' | 'register';

export function codeAfter(exit: InviteExit, code: string | null): string | null {
  return exit === 'sign_in' || exit === 'register' ? code : null;
}

// The name a Guest joins under. The field offers the own panel's editable
// form of the name it stands under; left as offered (or emptied) it asks
// nothing, so the field is never a step between the visitor and the lobby.
// A wrong shape is said in the server's own words before any request; an
// account is renamed elsewhere, never here.
export type NameStep =
  | { kind: 'keep' }
  | { kind: 'wrong'; error: string }
  | { kind: 'rename'; name: string };

// Whether the band shows the name field: never to an account, which is
// renamed elsewhere, nor to a member coming back, who keeps the name they
// had in the lobby.
export function asksName(state: InviteState, own: LandingOwn | null): boolean {
  return state !== 'member' && own?.account !== true;
}

export function nameStep(typed: string, own: LandingOwn | null): NameStep {
  const name = typed.trim();
  if (name === '' || own?.account) return { kind: 'keep' };
  if (own && (name === editValue(own) || name === own.name)) return { kind: 'keep' };
  const wrong = nameShapeError(name);
  return wrong ? { kind: 'wrong', error: wrong } : { kind: 'rename', name };
}

// The code line under the ways to play: a code typed by hand joins its
// lobby as a Guest.
export const CODE_PROMPT = 'Have a code?';
export const CODE_JOIN = 'Join';
export const CODE_WRONG = 'A lobby code is five or six letters.';

export function codePlay(typed: string): LandingPlay | null {
  const code = normalizeJoinCode(typed);
  return code === null ? null : { to: 'lobby', code };
}
