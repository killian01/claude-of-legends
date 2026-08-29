// Structural gates. Two of them: src/sim/ stays host-agnostic and
// deterministic, and no account secret ever leaves the server. Both are
// scans rather than unit tests on purpose, so they also catch the field
// somebody adds later without knowing the rule.

import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AccountRegistry, publicAccount } from '../server/accounts';
import { buildLadder } from '../server/ladder';
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
  const created = registry.register('bob', 'a good password', 0);
  if (!created.ok) throw new Error('fixture failed to register');
  const account = created.value;
  const sessions = new SessionStore(path.join(path.dirname(file), 'sessions.json'));
  const session = sessions.create(account.id, 0);

  // Every shape the server serialises out of an account, in one list, so
  // a new route has an obvious place to be added.
  const payloads: { what: string; body: unknown }[] = [
    { what: 'publicAccount', body: publicAccount(account) },
    {
      what: '/api/me and /api/account',
      body: { ...publicAccount(account), profile: buildProfile([], account.id) },
    },
    { what: '/api/ladder', body: buildLadder([account]) },
    { what: '/api/ladder (placed)', body: buildLadder([{ ...account, ratedGames: 10 }]) },
  ];

  const secrets: { what: string; value: string }[] = [
    { what: 'password hash', value: account.password.hash },
    { what: 'password salt', value: account.password.salt },
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

  it('keeps the fixture honest: the secrets really are in the account', () => {
    // If this ever fails, the gate above is passing for the wrong reason.
    const raw = JSON.stringify(account);
    expect(raw).toContain(account.password.hash);
    expect(raw).toContain(account.password.salt);
    expect(hashPassword('x').hash).not.toBe('');
  });
});
