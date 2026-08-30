// Linking a Discord account (ADR 0008): the exchange with Discord, the
// short-lived state and ticket a round trip needs, and the index that
// keeps one Discord account on one game account.
//
// Nothing here reaches the network. The exchange takes its fetch as an
// argument, so the two calls it makes are asserted rather than mocked
// away, and every failure a third party can hand us has a test.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountRegistry, selfAccount } from '../server/accounts';
import { DiscordFlows, FLOW_TTL_MS, PENDING_TTL_MS } from '../server/discord_link';
import {
  authorizeUrl,
  CALLBACK_PATH,
  type DiscordConfig,
  DiscordOauth,
  discordConfigFromEnv,
  readIdentity,
  SCOPE,
} from '../server/discord_oauth';

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
  it('spends a state once, whatever it was for', () => {
    const flows = new DiscordFlows();
    const state = flows.start(7, 0);
    expect(flows.take(state, 0)?.accountId).toBe(7);
    expect(flows.take(state, 0)).toBeUndefined();
  });

  it('refuses a state nobody issued, and one that sat too long', () => {
    const flows = new DiscordFlows();
    expect(flows.take('forged', 0)).toBeUndefined();
    const state = flows.start(null, 0);
    expect(flows.take(state, FLOW_TTL_MS)).toBeUndefined();
    // Expired or not, it is gone: a slow player cannot replay it later.
    expect(flows.flowCount).toBe(0);
  });

  it('remembers a signup as an account id of null', () => {
    const flows = new DiscordFlows();
    const flow = flows.take(flows.start(null, 0), 0);
    expect(flow?.accountId).toBeNull();
  });

  it('holds a link for a signup, peeks freely and claims once', () => {
    const flows = new DiscordFlows();
    const ticket = flows.hold({ id: '42', username: 'bo' }, 0);
    expect(flows.peek(ticket, 0)?.username).toBe('bo');
    expect(flows.peek(ticket, 0)?.username).toBe('bo');
    expect(flows.claim(ticket, 0)?.id).toBe('42');
    expect(flows.peek(ticket, 0)).toBeUndefined();
    expect(flows.claim(ticket, 0)).toBeUndefined();
  });

  it('lets a held link lapse, and lets one be dropped unused', () => {
    const flows = new DiscordFlows();
    const stale = flows.hold({ id: '1', username: 'a' }, 0);
    expect(flows.peek(stale, PENDING_TTL_MS)).toBeUndefined();
    const dropped = flows.hold({ id: '2', username: 'b' }, 0);
    flows.release(dropped);
    expect(flows.peek(dropped, 0)).toBeUndefined();
    expect(flows.pendingCount).toBe(0);
  });

  it('sweeps what nobody came back for', () => {
    const flows = new DiscordFlows();
    flows.start(1, 0);
    flows.hold({ id: '3', username: 'c' }, 0);
    expect(flows.purge(PENDING_TTL_MS + FLOW_TTL_MS)).toBe(2);
    expect(flows.flowCount + flows.pendingCount).toBe(0);
  });

  it('keeps issuing under a flood, and bounds what it holds', () => {
    // A counter rather than random bytes: the point is the cap, and a
    // deterministic key makes the failure readable.
    let n = 0;
    const flows = new DiscordFlows(() => `k${n++}`);
    for (let i = 0; i < 6000; i++) flows.start(null, 0);
    expect(flows.flowCount).toBeLessThanOrEqual(5000);
    // The newest survives; the oldest is what a flood costs.
    expect(flows.take('k5999', 0)).toBeDefined();
    expect(flows.take('k0', 0)).toBeUndefined();
  });
});

describe('a Discord link on an account', () => {
  it('is attached at registration when the signup carried one', () => {
    const registry = new AccountRegistry(tmpFile());
    const created = registry.register('bob', 'a good password', anEmail(), 0, {
      id: '42',
      username: 'bo',
    });
    if (!created.ok) throw new Error('expected a registration');
    expect(created.value.discord?.id).toBe('42');
    expect(selfAccount(created.value).discord).toBe('bo');
    expect(registry.findByDiscordId('42')?.id).toBe(created.value.id);
  });

  it('is optional, and its absence changes nothing', () => {
    const registry = new AccountRegistry(tmpFile());
    const created = registry.register('bob', 'a good password', anEmail(), 0);
    if (!created.ok) throw new Error('expected a registration');
    expect(created.value.discord).toBeUndefined();
    expect(selfAccount(created.value).discord).toBeNull();
  });

  it('refuses a second account on the same Discord, at signup and after', () => {
    const registry = new AccountRegistry(tmpFile());
    const first = registry.register('bob', 'a good password', anEmail(), 0, {
      id: '42',
      username: 'bo',
    });
    if (!first.ok) throw new Error('expected a registration');
    const second = registry.register('ann', 'a good password', anEmail(), 0, {
      id: '42',
      username: 'bo',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('discord_taken');
    // And the name it tried to take is still free, because nothing was
    // created: a refused signup must not burn a name.
    expect(registry.nameAvailable('ann')).toBe(true);

    const other = registry.register('cid', 'a good password', anEmail(), 0);
    if (!other.ok) throw new Error('expected a registration');
    const stolen = registry.linkDiscord(other.value.id, { id: '42', username: 'bo' }, 1);
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.error).toBe('discord_taken');
  });

  it('links after the fact, and relinking only refreshes the name', () => {
    const registry = new AccountRegistry(tmpFile());
    const created = registry.register('bob', 'a good password', anEmail(), 0);
    if (!created.ok) throw new Error('expected a registration');
    const id = created.value.id;
    expect(registry.linkDiscord(id, { id: '42', username: 'bo' }, 10).ok).toBe(true);
    expect(created.value.discord).toEqual({ id: '42', username: 'bo', linkedAt: 10 });
    expect(registry.linkDiscord(id, { id: '42', username: 'renamed' }, 99).ok).toBe(true);
    // The name follows Discord; the day it was linked does not move.
    expect(created.value.discord).toEqual({ id: '42', username: 'renamed', linkedAt: 10 });
  });

  it('swaps one Discord for another on the same account, releasing the first', () => {
    const registry = new AccountRegistry(tmpFile());
    const created = registry.register('bob', 'a good password', anEmail(), 0);
    if (!created.ok) throw new Error('expected a registration');
    registry.linkDiscord(created.value.id, { id: '42', username: 'bo' }, 0);
    registry.linkDiscord(created.value.id, { id: '43', username: 'other' }, 1);
    expect(registry.findByDiscordId('42')).toBeUndefined();
    expect(registry.findByDiscordId('43')?.id).toBe(created.value.id);
  });

  it('gives the Discord back on unlink, and keeps everything else', () => {
    const registry = new AccountRegistry(tmpFile());
    const first = registry.register('bob', 'a good password', anEmail(), 0, {
      id: '42',
      username: 'bo',
    });
    if (!first.ok) throw new Error('expected a registration');
    first.value.rating = 1234;
    expect(registry.unlinkDiscord(first.value.id)).toBe(true);
    expect(registry.unlinkDiscord(first.value.id)).toBe(false);
    expect(registry.findByDiscordId('42')).toBeUndefined();
    // The account is untouched but for the link: nothing is ever deleted
    // here (ADR 0006).
    expect(first.value.name).toBe('bob');
    expect(first.value.rating).toBe(1234);

    const second = registry.register('ann', 'a good password', anEmail(), 1, {
      id: '42',
      username: 'bo',
    });
    expect(second.ok).toBe(true);
  });

  it('survives a restart: the index is rebuilt from the accounts', () => {
    const file = tmpFile();
    const registry = new AccountRegistry(file);
    const created = registry.register('bob', 'a good password', anEmail(), 0, {
      id: '42',
      username: 'bo',
    });
    if (!created.ok) throw new Error('expected a registration');

    const reloaded = new AccountRegistry(file);
    expect(reloaded.findByDiscordId('42')?.name).toBe('bob');
    const second = reloaded.register('ann', 'a good password', anEmail(), 1, {
      id: '42',
      username: 'bo',
    });
    expect(second.ok).toBe(false);
    expect(reloaded.unlinkDiscord(created.value.id)).toBe(true);
    expect(new AccountRegistry(file).findByDiscordId('42')).toBeUndefined();
  });

  it('refuses to link an account that does not exist', () => {
    const registry = new AccountRegistry(tmpFile());
    const missing = registry.linkDiscord(999, { id: '42', username: 'bo' }, 0);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe('unknown_account');
  });
});
