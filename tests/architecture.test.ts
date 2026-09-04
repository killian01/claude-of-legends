// Structural gates. Two of them: src/sim/ stays host-agnostic and
// deterministic, and no account secret ever leaves the server. Both are
// scans rather than unit tests on purpose, so they also catch the field
// somebody adds later without knowing the rule.

import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AccountRegistry, publicAccount, selfAccount } from '../server/accounts';
import { buildLadder } from '../server/ladder';
import { buildLadderPage, placeOf } from '../server/ladder_page';
import { hashPassword } from '../server/password';
import { buildProfile } from '../server/profile';
import { SessionStore } from '../server/sessions';

const simDir = fileURLToPath(new URL('../src/sim', import.meta.url));

function simFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...simFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /Math\.random/, why: 'sim randomness must go through Rng' },
  { re: /Date\.now/, why: 'sim time is tick-driven, never wall-clock' },
  { re: /performance\.now/, why: 'sim time is tick-driven, never wall-clock' },
  { re: /from\s+'three/, why: 'sim never imports the renderer stack' },
  { re: /from\s+'[^']*\/(render|ui|net)\//, why: 'sim never imports presentation or network code' },
  { re: /\b(document|window|navigator)\s*\./, why: 'sim runs outside the DOM' },
  { re: /\bWebSocket\b/, why: 'sim never touches the network' },
];

describe('sim architecture', () => {
  it('keeps src/sim free of DOM, renderer, network, and wall-clock dependencies', () => {
    const offenders: string[] = [];
    for (const file of simFiles(simDir)) {
      const text = readFileSync(file, 'utf8');
      for (const rule of FORBIDDEN) {
        if (rule.re.test(text)) offenders.push(`${file}: ${rule.re} (${rule.why})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// Everything an account holds that must never reach a client. The hash and
// the salt are the credential; the session id is the credential's
// equivalent for an open session, and a leaked one is a stolen account
// until it expires.
describe('account secrets', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'loc-arch-')), 'accounts.json');
  const registry = new AccountRegistry(file);
  const created = registry.register('bob', 'a good password', 'bob@example.com', 0);
  if (!created.ok) throw new Error('fixture failed to register');
  const account = created.value;
  const sessions = new SessionStore(path.join(path.dirname(file), 'sessions.json'));
  const session = sessions.create(account.id, 0);

  // Every shape the server serialises out of an account, in one list, so
  // a new route has an obvious place to be added.
  const payloads: { what: string; body: unknown }[] = [
    { what: 'publicAccount', body: publicAccount(account) },
    {
      what: '/api/account',
      body: { ...publicAccount(account), profile: buildProfile([], account.id) },
    },
    {
      what: '/api/me',
      body: { ...selfAccount(account), profile: buildProfile([], account.id) },
    },
    { what: '/api/ladder', body: buildLadder([account]) },
    { what: '/api/ladder (placed)', body: buildLadder([{ ...account, ratedGames: 10 }]) },
    {
      what: '/api/ladder/page',
      body: buildLadderPage(
        'hand',
        [{ id: account.id, accountId: account.id, name: account.name, rating: 1000, games: 10 }],
        new Map(),
        account.id,
      ),
    },
    {
      what: '/api/ladder/mine',
      body: placeOf(
        [{ id: account.id, accountId: account.id, name: account.name, rating: 1000, games: 1 }],
        account.id,
      ),
    },
  ];

  const secrets: { what: string; value: string }[] = [
    { what: 'password hash', value: account.password!.hash },
    { what: 'password salt', value: account.password!.salt },
    { what: 'session id', value: session.id },
  ];

  it('never serialises a credential or a session id', () => {
    const leaks: string[] = [];
    for (const { what, body } of payloads) {
      const json = JSON.stringify(body);
      for (const secret of secrets) {
        if (json.includes(secret.value)) leaks.push(`${what} leaks the ${secret.what}`);
      }
      // A whole account object smuggled in under any key would carry the
      // hash with it, whatever the key is called.
      if (/"(password|salt|hash|token|sessionId)"/.test(json)) {
        leaks.push(`${what} carries a credential-shaped key`);
      }
    }
    expect(leaks).toEqual([]);
  });

  // The landing page needs live numbers, so /api/public/stats sits in
  // front of the wall. It may carry counts and nothing else: the moment a
  // name or an id joins them, the page has become a directory of who
  // plays here, which is exactly what the wall exists to prevent.
  it('keeps the one public route to counts only', () => {
    const payload = { online: 3, matches: 1, accounts: 42 };
    expect(Object.keys(payload).sort()).toEqual(['accounts', 'matches', 'online']);
    for (const value of Object.values(payload)) expect(typeof value).toBe('number');
    const source = readFileSync(
      fileURLToPath(new URL('../server/main.ts', import.meta.url)),
      'utf8',
    );
    const route = source.slice(source.indexOf("url === '/api/public/stats'"));
    const body = route.slice(0, route.indexOf('return;'));
    for (const banned of ['name', 'handle', 'players.values', 'registry.all']) {
      expect(body).not.toContain(banned);
    }
  });

  // The address is not a credential, so the gate above would let it
  // through; it is personal data, and it belongs to exactly one person.
  // The line is between what an account may see about ITSELF and what any
  // other signed-in player may see about it, which is the whole reason
  // selfAccount and publicAccount are two functions.
  it('shows an address to its owner and to nobody else', () => {
    const address = 'bob@example.com';
    expect(account.email?.address).toBe(address);

    // Anything another player can ask for.
    const forOthers: { what: string; body: unknown }[] = [
      { what: 'publicAccount', body: publicAccount(account) },
      {
        what: '/api/account',
        body: { ...publicAccount(account), profile: buildProfile([], account.id) },
      },
      { what: '/api/ladder', body: buildLadder([{ ...account, ratedGames: 10 }]) },
    ];
    const leaks: string[] = [];
    for (const { what, body } of forOthers) {
      const json = JSON.stringify(body);
      if (json.includes(address)) leaks.push(`${what} leaks the email address`);
      if (/"email/.test(json)) leaks.push(`${what} carries an email-shaped key`);
    }
    expect(leaks).toEqual([]);

    // And the owner does see it, or the confirmation banner has nothing
    // to read and this gate would pass by simply losing the feature.
    const self = selfAccount(account);
    expect(self.email).toBe(address);
    expect(self.emailConfirmed).toBe(false);
    expect(JSON.stringify(self)).not.toContain(account.password!.hash);
  });

  // A linked Discord is on exactly the same line as the address (ADR
  // 0008): personal data, the owner's alone. The id is stronger than a
  // name, since it is the same everywhere on Discord, so it never leaves
  // the server at all, not even to its owner.
  it('shows a linked Discord to its owner, the id to nobody', () => {
    const linked = registry.linkDiscord(account.id, { id: '905512340000', username: 'bo' }, 0);
    expect(linked.ok).toBe(true);
    expect(account.discord?.id).toBe('905512340000');

    const forOthers: { what: string; body: unknown }[] = [
      { what: 'publicAccount', body: publicAccount(account) },
      {
        what: '/api/account',
        body: { ...publicAccount(account), profile: buildProfile([], account.id) },
      },
      { what: '/api/ladder', body: buildLadder([{ ...account, ratedGames: 10 }]) },
    ];
    const leaks: string[] = [];
    for (const { what, body } of forOthers) {
      const json = JSON.stringify(body);
      if (json.includes('905512340000')) leaks.push(`${what} leaks the Discord id`);
      if (json.includes('"bo"')) leaks.push(`${what} leaks the Discord name`);
      if (/"discord/i.test(json)) leaks.push(`${what} carries a Discord-shaped key`);
    }
    expect(leaks).toEqual([]);

    const self = JSON.stringify(selfAccount(account));
    expect(self).toContain('bo');
    expect(self).not.toContain('905512340000');
  });

  it('keeps the fixture honest: the secrets really are in the account', () => {
    // If this ever fails, the gate above is passing for the wrong reason.
    const raw = JSON.stringify(account);
    expect(raw).toContain(account.password!.hash);
    expect(raw).toContain(account.password!.salt);
    expect(hashPassword('x').hash).not.toBe('');
  });
});
