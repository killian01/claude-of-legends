// The invitation on the landing (src/ui/landing_invite.ts, ADR 0036): what
// the band says for each answer the landing's request gives about an
// invite code, the name a Guest joins under, the code a sign-in still owes,
// and the code line under the ways to play. The words are pure; the band is
// drawn by src/ui/invite_card.ts, and a few lines of the page are read off
// the source here, as the other landing tests do.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LandingInvite, LandingOwn } from '../src/net/landing';
import {
  breathes,
  CODE_JOIN,
  CODE_PROMPT,
  CODE_WRONG,
  codeAfter,
  codePlay,
  INVITE_CALL,
  INVITE_FIELD_LABEL,
  INVITE_NOT_NOW,
  INVITE_OPEN_OWN,
  INVITE_REGISTER,
  INVITE_SIGN_IN,
  INVITE_TITLE,
  inviteDoor,
  inviteState,
  inviteWords,
  nameStep,
  OPEN_OWN_DOOR,
} from '../src/ui/landing_invite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

const open = (players: number, phase?: 'queue' | 'select' | 'match'): LandingInvite => ({
  open: true,
  host: 'Marrow',
  players,
  seats: 10,
  ...(phase ? { phase } : {}),
});

const FRESH: LandingOwn = {
  name: 'Wanderer 0421',
  named: false,
  account: false,
  rank: null,
  points: 0,
  level: { level: 1, from: 0, to: 50 },
  best: 0,
  above: null,
  since: Date.UTC(2026, 10, 15),
};

describe('the invitation, by the answer', () => {
  it('invites plainly before the answer, and when the request failed', () => {
    for (const none of [undefined, null]) {
      expect(inviteState(none)).toBe('waiting');
      expect(inviteWords(none)).toEqual({ state: 'waiting', title: INVITE_TITLE, line: '' });
    }
    expect(INVITE_TITLE).toBe('You are invited to a private lobby');
  });

  it('names the host and says how many are in', () => {
    expect(inviteWords(open(3))).toEqual({
      state: 'open',
      title: 'Marrow invited you to a private lobby',
      line: '3 of 10 in the lobby. A 5v5 among friends, never rated.',
    });
    expect(inviteWords(open(1)).line).toBe(
      '1 of 10 in the lobby. A 5v5 among friends, never rated.',
    );
    expect(inviteWords(open(0)).line).toBe('Nobody in it yet: you will be the first.');
  });

  it('says when the lobby is playing, and that a join plays the next one', () => {
    expect(inviteWords(open(6, 'match')).line).toBe(
      'They are in a match now. Join to play the next one.',
    );
    expect(inviteWords(open(6, 'select')).line).toBe(
      'They are in a match now. Join to play the next one.',
    );
    expect(inviteWords(open(4, 'queue')).line).toBe(
      'They are queued for a match. Join to play the next one.',
    );
    expect(inviteWords(open(6, 'match')).title).toBe('Marrow invited you to a private lobby');
  });

  it('says a full lobby is full, and offers one of your own', () => {
    for (const players of [10, 12]) {
      expect(inviteWords(open(players))).toEqual({
        state: 'full',
        title: 'This lobby is full',
        line: 'Ask your friend to make room, or open your own.',
      });
    }
    expect(inviteState(open(10, 'match'))).toBe('full');
  });

  it('says a closed lobby has closed, whatever closed it', () => {
    expect(inviteWords({ open: false })).toEqual({
      state: 'closed',
      title: 'This lobby has closed',
      line: 'Ask your friend for a new link, or open your own.',
    });
  });

  it('says a connection over its wrong codes waits, and never that the lobby closed', () => {
    expect(inviteWords({ open: false, limited: true })).toEqual({
      state: 'limited',
      title: INVITE_TITLE,
      line: 'Too many wrong lobby codes from this connection. Try again in a few minutes.',
    });
  });

  it('moves the breathing gold to the band only while the invitation can be taken', () => {
    expect(breathes('waiting')).toBe(true);
    expect(breathes('open')).toBe(true);
    expect(breathes('full')).toBe(false);
    expect(breathes('closed')).toBe(false);
    expect(breathes('limited')).toBe(false);
  });
});

describe('its buttons', () => {
  it('joins the lobby by its code as a Guest', () => {
    expect(inviteDoor('KMNPQR')).toEqual({
      call: 'Join the lobby',
      kind: 'guest',
      play: { to: 'lobby', code: 'KMNPQR' },
    });
    expect(INVITE_CALL).toBe('Join the lobby');
  });

  it('opens a lobby of your own from a closed or full one', () => {
    expect(OPEN_OWN_DOOR).toEqual({ call: 'Open a lobby', kind: 'guest', play: { to: 'lobby' } });
    expect(INVITE_OPEN_OWN).toBe('Open a lobby');
  });

  it('says its quiet links and its field in these words', () => {
    expect(INVITE_SIGN_IN).toBe('Sign in');
    expect(INVITE_REGISTER).toBe('Create an account');
    expect(INVITE_NOT_NOW).toBe('Not now');
    expect(INVITE_FIELD_LABEL).toBe('Your name (also your name on the ladder)');
  });

  it('keeps the code through a sign-in, and drops it on every other way out', () => {
    expect(codeAfter('sign_in', 'KMNPQR')).toBe('KMNPQR');
    expect(codeAfter('register', 'KMNPQR')).toBe('KMNPQR');
    expect(codeAfter('not_now', 'KMNPQR')).toBeNull();
    expect(codeAfter('open_own', 'KMNPQR')).toBeNull();
    expect(codeAfter('join', 'KMNPQR')).toBeNull();
    expect(codeAfter('sign_in', null)).toBeNull();
  });
});

describe('the name a Guest joins under', () => {
  it('asks nothing when the field still holds the name offered', () => {
    // The offer is the own panel's: a handed-out name without its space.
    expect(nameStep('Wanderer0421', FRESH)).toEqual({ kind: 'keep' });
    expect(nameStep('  Wanderer0421 ', FRESH)).toEqual({ kind: 'keep' });
    expect(nameStep('Wanderer 0421', FRESH)).toEqual({ kind: 'keep' });
    expect(nameStep('', FRESH)).toEqual({ kind: 'keep' });
    const named = { ...FRESH, name: 'Thornwick', named: true };
    expect(nameStep('Thornwick', named)).toEqual({ kind: 'keep' });
  });

  it("says a wrong shape in the server's words, before any request", () => {
    expect(nameStep('ab', FRESH)).toEqual({
      kind: 'wrong',
      error: 'A name needs at least 3 letters or digits.',
    });
    expect(nameStep('Bad name', FRESH)).toEqual({
      kind: 'wrong',
      error: 'A name may use letters, digits, underscores and hyphens only.',
    });
  });

  it('renames otherwise, and never an account', () => {
    expect(nameStep('Brindle', FRESH)).toEqual({ kind: 'rename', name: 'Brindle' });
    expect(nameStep(' Brindle ', null)).toEqual({ kind: 'rename', name: 'Brindle' });
    expect(nameStep('Brindle', { ...FRESH, name: 'Marrow', named: true, account: true })).toEqual({
      kind: 'keep',
    });
  });
});

describe('the code line under the ways to play', () => {
  it('joins a typed code, trimmed and uppercased', () => {
    expect(codePlay(' kmnpqr ')).toEqual({ to: 'lobby', code: 'KMNPQR' });
    expect(codePlay('KMNPQ')).toEqual({ to: 'lobby', code: 'KMNPQ' });
  });

  it('refuses what is not the shape of a code', () => {
    for (const bad of ['', 'abc', 'KMN-PQ', 'KMNPQRS', '12345']) expect(codePlay(bad)).toBeNull();
    expect(CODE_WRONG).toBe('A lobby code is five or six letters.');
  });

  it('asks in a few words', () => {
    expect(CODE_PROMPT).toBe('Have a code?');
    expect(CODE_JOIN).toBe('Join');
  });
});

describe('the band on the page', () => {
  it('asks the landing request with the code, and builds the band before the hero', () => {
    const landing = read('src/ui/landing.ts');
    expect(landing).toContain('loadLanding(undefined, invite)');
    expect(landing).toContain('mountInviteCard(');
    expect(landing).toContain('inner.insertBefore(band, hero)');
  });

  it("hands a sign-in the code the band still holds, and puts it down before Discord's trip", () => {
    const landing = read('src/ui/landing.ts');
    expect(landing).toContain("finish({ kind: 'account', account, join: pendingJoin() })");
    expect(landing).toContain('rememberPendingJoin(tabStore(), code, Date.now())');
    const discord = read('src/ui/discord_entry.ts');
    const told = discord.indexOf('onDeparture?.()');
    expect(told).toBeGreaterThan(0);
    expect(told).toBeLessThan(discord.indexOf("window.location.assign('/api/discord/start')"));
    const auth = read('src/ui/auth.ts');
    expect(auth).toContain('buildDiscordEntry(discordResult, onDeparture)');
    expect(auth).toContain('control.signIn = ');
  });

  it('wears gold of its own, never the Play now button class', () => {
    const card = read('src/ui/invite_card.ts');
    expect(card).toContain("'menu-btn pg-invite-go'");
    expect(card).not.toContain('pg-play');
    // An author display rule beats [hidden]: the band says it again.
    expect(card).toContain('.pg-invite[hidden] { display: none; }');
    expect(card).toContain('prefers-reduced-motion');
    // Its field is 16 px, so a phone does not zoom the page on focus, and
    // it never takes the focus by itself.
    expect(card).toMatch(/\.pg-invite-field[^}]*font-size: 16px/);
    expect(card).not.toMatch(/field\.focus\(/);
  });

  it('awaits the rename before it joins, after the landing has answered', () => {
    const card = read('src/ui/invite_card.ts');
    const answered = card.indexOf('await pagePromise');
    const renamed = card.indexOf('await save(');
    const joined = card.indexOf('opts.onJoin(');
    expect(answered).toBeGreaterThan(0);
    expect(renamed).toBeGreaterThan(answered);
    expect(joined).toBeGreaterThan(renamed);
  });

  it('tells the own panel, the ladder and the account card about the rename', () => {
    const landing = read('src/ui/landing.ts');
    expect(landing).toContain('panel?.renamed(name);');
    const view = read('src/ui/own_panel_view.ts');
    expect(view).toContain('renamed(name: string): void;');
  });

  it('has no en or em dash in what it says', () => {
    const said = [
      inviteWords(undefined),
      inviteWords(open(3)),
      inviteWords(open(0)),
      inviteWords(open(3, 'queue')),
      inviteWords(open(3, 'match')),
      inviteWords(open(10)),
      inviteWords({ open: false }),
      inviteWords({ open: false, limited: true }),
    ].flatMap((w) => [w.title, w.line]);
    for (const s of [...said, CODE_WRONG, CODE_PROMPT, INVITE_FIELD_LABEL]) {
      for (const ch of s) {
        expect(ch.charCodeAt(0)).not.toBe(8211);
        expect(ch.charCodeAt(0)).not.toBe(8212);
      }
    }
  });
});
