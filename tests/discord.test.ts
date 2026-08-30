// Entering through Discord (ADR 0009): the exchange with Discord, the
// short-lived anti-forgery state a round trip needs, the name a Discord
// signup is given, and the index that keeps one Discord account on one
// game account.
//
// Nothing here reaches the network. The exchange takes its fetch as an
// argument, so the two calls it makes are asserted rather than mocked
// away, and every failure a third party can hand us has a test.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountRegistry, selfAccount } from '../server/accounts';
import { deriveName, FALLBACK_NAME } from '../server/discord_name';
import {
  authorizeUrl,
  CALLBACK_PATH,
  type DiscordConfig,
  DiscordOauth,
  discordConfigFromEnv,
  readIdentity,
  SCOPE,
} from '../server/discord_oauth';
import { DiscordFlows, FLOW_TTL_MS } from '../server/discord_state';

const dirs: string[] = [];
function tmpFile(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'loc-discord-'));
  dirs.push(d);
  return path.join(d, 'accounts.json');
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

let emailSeq = 0;
function anEmail(): string {
  emailSeq += 1;
  return `linker${emailSeq}@example.com`;
}

const CFG: DiscordConfig = {
  clientId: '112233',
  clientSecret: 'shh',
  redirectUri: 'https://example.test/api/discord/callback',
};

interface Answers {
  token?: unknown;
  tokenStatus?: number;
  me?: unknown;
  meStatus?: number;
}

// A fetch that answers the token call and then the identity call,
// recording what it was asked. No network and no real Response: what is
// pinned is the two requests we make and what we do with each answer.
function fakeFetch(answers: Answers = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    const at = String(url);
    calls.push({ url: at, init: init as RequestInit });
    if (at.includes('/oauth2/token')) {
      const status = answers.tokenStatus ?? 200;
      return {
        ok: status < 400,
        status,
        json: async () => answers.token ?? { access_token: 'at' },
      } as Response;
    }
    const status = answers.meStatus ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => answers.me ?? { id: '42', username: 'bo' },
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('the Discord configuration', () => {
  it('is off unless both secrets are set', () => {
    const origin = 'https://example.test';
    expect(discordConfigFromEnv({}, origin)).toBeNull();
    expect(discordConfigFromEnv({ DISCORD_CLIENT_ID: 'a' }, origin)).toBeNull();
    expect(discordConfigFromEnv({ DISCORD_CLIENT_SECRET: 'b' }, origin)).toBeNull();
    const blank = { DISCORD_CLIENT_ID: ' ', DISCORD_CLIENT_SECRET: 'b' };
    expect(discordConfigFromEnv(blank, origin)).toBeNull();
  });

  it('points the redirect at the same origin the mail links use', () => {
    const cfg = discordConfigFromEnv(
      { DISCORD_CLIENT_ID: 'a', DISCORD_CLIENT_SECRET: 'b' },
      'https://example.test/',
    );
    expect(cfg?.redirectUri).toBe(`https://example.test${CALLBACK_PATH}`);
  });

  it('lets a deployment override the redirect outright', () => {
    const cfg = discordConfigFromEnv(
      {
        DISCORD_CLIENT_ID: 'a',
        DISCORD_CLIENT_SECRET: 'b',
        DISCORD_REDIRECT_URI: 'https://other.test/cb',
      },
      'https://example.test',
    );
    expect(cfg?.redirectUri).toBe('https://other.test/cb');
  });

  it('asks for the identify scope and nothing else', () => {
    const url = new URL(authorizeUrl(CFG, 'st4te'));
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe(SCOPE);
    expect(SCOPE).toBe('identify');
    expect(url.searchParams.get('client_id')).toBe('112233');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('redirect_uri')).toBe(CFG.redirectUri);
    // The secret is the one thing that must never be in a URL a browser
    // is sent to.
    expect(url.search).not.toContain('shh');
  });
});

describe('reading who Discord says this is', () => {
  it('prefers the display name and falls back to the handle', () => {
    expect(readIdentity({ id: '7', username: 'handle', global_name: 'Display' })).toEqual({
      id: '7',
      username: 'Display',
    });
    expect(readIdentity({ id: '7', username: 'handle', global_name: '' })).toEqual({
      id: '7',
      username: 'handle',
    });
  });

  it('refuses anything that is not a snowflake and a name', () => {
    expect(readIdentity(null)).toBeNull();
    expect(readIdentity({ username: 'bo' })).toBeNull();
    expect(readIdentity({ id: 'not-a-number', username: 'bo' })).toBeNull();
    expect(readIdentity({ id: '7', username: '   ' })).toBeNull();
    expect(readIdentity({ id: '7'.repeat(40), username: 'bo' })).toBeNull();
  });

  it('bounds the name it is willing to keep', () => {
    const long = readIdentity({ id: '7', username: 'x'.repeat(200) });
    expect(long?.username.length).toBe(64);
  });
});

describe('the exchange with Discord', () => {
  it('posts the code as a form and reads the identity with the token', async () => {
    const { impl, calls } = fakeFetch();
    const identity = await new DiscordOauth(CFG, impl).exchange('the-code');
    expect(identity).toEqual({ id: '42', username: 'bo' });
    expect(calls).toHaveLength(2);

    const token = calls[0]!;
    expect(token.url).toContain('/oauth2/token');
    expect(token.init.method).toBe('POST');
    const body = String(token.init.body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=the-code');
    expect(body).toContain(`redirect_uri=${encodeURIComponent(CFG.redirectUri)}`);

    const me = calls[1]!;
    expect(me.url).toContain('/users/@me');
    const headers = me.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer at');
  });

  it('gives up quietly on every way the other end can refuse', async () => {
    const refusedToken = new DiscordOauth(CFG, fakeFetch({ tokenStatus: 400 }).impl);
    expect(await refusedToken.exchange('c')).toBeNull();
    const noToken = new DiscordOauth(CFG, fakeFetch({ token: { error: 'nope' } }).impl);
    expect(await noToken.exchange('c')).toBeNull();
    const refusedMe = new DiscordOauth(CFG, fakeFetch({ meStatus: 401 }).impl);
    expect(await refusedMe.exchange('c')).toBeNull();
    const junk = new DiscordOauth(CFG, fakeFetch({ me: { id: 'nope' } }).impl);
    expect(await junk.exchange('c')).toBeNull();
  });

  it('survives a third party that simply does not answer', async () => {
    const broken = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    expect(await new DiscordOauth(CFG, broken).exchange('c')).toBeNull();
  });
});

describe('the round trip state', () => {
  it('spends a state once', () => {
    const flows = new DiscordFlows();
    const state = flows.start(0);
    expect(flows.take(state, 0)).toBe(true);
    expect(flows.take(state, 0)).toBe(false);
  });

  it('refuses a state nobody issued, and one that sat too long', () => {
    const flows = new DiscordFlows();
    expect(flows.take('forged', 0)).toBe(false);
    const state = flows.start(0);
    expect(flows.take(state, FLOW_TTL_MS)).toBe(false);
    // Expired or not, it is gone: a slow player cannot replay it later.
    expect(flows.flowCount).toBe(0);
  });

  it('sweeps what nobody came back for', () => {
    const flows = new DiscordFlows();
    flows.start(0);
    expect(flows.purge(FLOW_TTL_MS)).toBe(1);
    expect(flows.flowCount).toBe(0);
  });

  it('keeps issuing under a flood, and bounds what it holds', () => {
    // A counter rather than random bytes: the point is the cap, and a
    // deterministic key makes the failure readable.
    let n = 0;
    const flows = new DiscordFlows(() => `k${n++}`);
    for (let i = 0; i < 6000; i++) flows.start(0);
    expect(flows.flowCount).toBeLessThanOrEqual(5000);
    // The newest survives; the oldest is what a flood costs.
    expect(flows.take('k5999', 0)).toBe(true);
    expect(flows.take('k0', 0)).toBe(false);
  });
});

describe('the name a Discord signup is given', () => {
  const anyFree = () => true;

  it('keeps a usable Discord name as it is', () => {
    expect(deriveName('Caym', anyFree)).toBe('Caym');
    expect(deriveName('some_handle-9', anyFree)).toBe('some_handle-9');
  });

  it('strips what the name space does not allow, and clamps the length', () => {
    expect(deriveName('C a y m!', anyFree)).toBe('Caym');
    expect(deriveName('x'.repeat(40), anyFree)).toBe('x'.repeat(16));
  });

  it('falls back when nothing usable survives', () => {
    expect(deriveName('', anyFree)).toBe(FALLBACK_NAME);
    expect(deriveName('!!', anyFree)).toBe(FALLBACK_NAME);
    // Separators alone fold to nothing, and a name that folds to nothing
    // is not a name (server/account_name.ts).
    expect(deriveName('__--__', anyFree)).toBe(FALLBACK_NAME);
  });

  it('counts up past the names already taken', () => {
    const taken = new Set(['caym', 'caym2', 'caym3']);
    const free = (candidate: string) => !taken.has(candidate.toLowerCase());
    expect(deriveName('Caym', free)).toBe('Caym4');
  });

  it('shortens the stem when the digits would not fit', () => {
    const long = 'x'.repeat(16);
    const taken = new Set([long]);
    const free = (candidate: string) => !taken.has(candidate);
    expect(deriveName(long, free)).toBe(`${'x'.repeat(15)}2`);
  });
});

describe('an account created through Discord', () => {
  it('is named from the Discord name, and starts with no password or email', () => {
    const registry = new AccountRegistry(tmpFile());
    const created = registry.registerWithDiscord({ id: '42', username: 'Caym' }, 7);
    if (!created.ok) throw new Error('expected a registration');
    expect(created.value.name).toBe('Caym');
    expect(created.value.password).toBeUndefined();
    expect(created.value.email).toBeUndefined();
    expect(created.value.discord).toEqual({ id: '42', username: 'Caym', linkedAt: 7 });
    expect(selfAccount(created.value).discord).toBe('Caym');
    expect(registry.findByDiscordId('42')?.id).toBe(created.value.id);
  });

  it('steps around a name that is already taken, folding included', () => {
    const registry = new AccountRegistry(tmpFile());
    registry.register('caym', 'a good password', anEmail(), 0);
    const created = registry.registerWithDiscord({ id: '42', username: 'C-a-y-m' }, 0);
    if (!created.ok) throw new Error('expected a registration');
    // 'C-a-y-m' folds to 'caym', which is held, so the digits step in.
    expect(created.value.name).toBe('C-a-y-m2');
  });

  it('cannot be opened with any password', () => {
    const registry = new AccountRegistry(tmpFile());
    const created = registry.registerWithDiscord({ id: '42', username: 'Caym' }, 0);
    if (!created.ok) throw new Error('expected a registration');
    expect(registry.authenticate('Caym', '')).toBeUndefined();
    expect(registry.authenticate('Caym', 'a good password')).toBeUndefined();
    // Until a mailed reset lands one (ADR 0009): then the front door
    // works like everyone else's.
    expect(registry.setPassword(created.value.id, 'a chosen password')).toBe(true);
    expect(registry.authenticate('Caym', 'a chosen password')?.id).toBe(created.value.id);
  });

  it('refuses a second account on the same Discord', () => {
    const registry = new AccountRegistry(tmpFile());
    const first = registry.registerWithDiscord({ id: '42', username: 'Caym' }, 0);
    if (!first.ok) throw new Error('expected a registration');
    const second = registry.registerWithDiscord({ id: '42', username: 'Caym' }, 1);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('discord_taken');
  });

  it('survives a restart: the index is rebuilt from the accounts', () => {
    const file = tmpFile();
    const registry = new AccountRegistry(file);
    const created = registry.registerWithDiscord({ id: '42', username: 'Caym' }, 0);
    if (!created.ok) throw new Error('expected a registration');

    const reloaded = new AccountRegistry(file);
    expect(reloaded.findByDiscordId('42')?.name).toBe('Caym');
    expect(reloaded.registerWithDiscord({ id: '42', username: 'Caym' }, 1).ok).toBe(false);
    // And the account still has no password to guess at.
    expect(reloaded.authenticate('Caym', 'anything at all')).toBeUndefined();
  });

  it('sees the name it shows follow Discord at each sign-in', () => {
    const registry = new AccountRegistry(tmpFile());
    const created = registry.registerWithDiscord({ id: '42', username: 'Caym' }, 10);
    if (!created.ok) throw new Error('expected a registration');
    // The callback relinks on every sign-in; the same id only refreshes
    // the stored name, and the day it was linked does not move.
    expect(registry.linkDiscord(created.value.id, { id: '42', username: 'Renamed' }, 99).ok).toBe(
      true,
    );
    expect(created.value.discord).toEqual({ id: '42', username: 'Renamed', linkedAt: 10 });
    // The account name is the account's own: a Discord rename does not
    // touch it.
    expect(created.value.name).toBe('Caym');
  });

  it('refuses to link an account that does not exist', () => {
    const registry = new AccountRegistry(tmpFile());
    const missing = registry.linkDiscord(999, { id: '42', username: 'bo' }, 0);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe('unknown_account');
  });
});
