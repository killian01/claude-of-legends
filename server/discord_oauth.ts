// Talking to Discord, and the second place in this repo that talks to a
// third party (server/mailer.ts is the first).
//
// The authorization code flow, by hand: two HTTPS calls with `fetch`, no
// OAuth package, no SDK, no new dependency (CLAUDE.md keeps the set tiny).
// The scope asked for is `identify` and nothing else, because the only
// question this server has for Discord is "who is this", asked once.
//
// The access token is never stored. It is exchanged, used for one call to
// /users/@me, and dropped with the function that held it: the account
// keeps the id and the name that came back, which is all a link is
// (ADR 0009). Nothing here can read a mailbox, a guild list, or a
// message, and nothing here can act on a player's behalf later.
//
// Delivery is best effort in exactly one direction: a Discord outage
// means a link cannot be made right now, never that signing up fails.

const AUTHORIZE = 'https://discord.com/oauth2/authorize';
const TOKEN = 'https://discord.com/api/v10/oauth2/token';
const IDENTITY = 'https://discord.com/api/v10/users/@me';

// The only scope. Written once, here, so widening it is a visible edit
// rather than a string somewhere in a URL.
export const SCOPE = 'identify';

// How long to wait on Discord before giving up. A person is sitting in
// front of a redirect while this runs, so it is short.
export const EXCHANGE_TIMEOUT_MS = 8000;

// Who Discord says this is. The id is what uniqueness is judged on: it
// never changes, while the name can change any day and is only ever
// shown back to the owner so they can recognise the link they made.
export interface DiscordIdentity {
  id: string;
  username: string;
}

export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
  // Must match the redirect registered on the Discord application, byte
  // for byte, or Discord refuses the exchange.
  redirectUri: string;
}

export const CALLBACK_PATH = '/api/discord/callback';

// Picks the configuration out of the environment, or null when the two
// secrets are not both there. Null is the off switch: server/main.ts
// answers the Discord routes with "not configured" and the client never
// offers the button, which is what a developer without a Discord
// application wants and what an operator must not ship by accident.
export function discordConfigFromEnv(
  env: Record<string, string | undefined>,
  origin: string,
): DiscordConfig | null {
  const clientId = env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = env.DISCORD_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  // The redirect follows the origin the rest of the links use
  // (server/mail_messages.ts), so one PUBLIC_URL settles both.
  const explicit = env.DISCORD_REDIRECT_URI?.trim();
  return {
    clientId,
    clientSecret,
    redirectUri: explicit || `${origin.replace(/\/+$/, '')}${CALLBACK_PATH}`,
  };
}

// Where to send the browser. `state` is the whole CSRF story: it is
// unguessable, single use, and server/discord_state.ts is what remembers
// what it meant.
export function authorizeUrl(cfg: DiscordConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE}?${q.toString()}`;
}

// The display name to keep. Discord moved to unique handles and a
// separate display name; `global_name` is what the person sees on
// themselves, and `username` is what an account that never migrated
// still has. Anything unreadable gives up rather than guessing.
export function readIdentity(body: unknown): DiscordIdentity | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = body as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const global = typeof raw.global_name === 'string' ? raw.global_name.trim() : '';
  const handle = typeof raw.username === 'string' ? raw.username.trim() : '';
  const username = global || handle;
  // A numeric snowflake, and nothing longer than one: this string ends up
  // as a map key and in a JSON file, so it is bounded here.
  if (!/^\d{1,32}$/.test(id) || username.length === 0) return null;
  return { id, username: username.slice(0, 64) };
}

export class DiscordOauth {
  constructor(
    private readonly cfg: DiscordConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly tokenUrl: string = TOKEN,
    private readonly identityUrl: string = IDENTITY,
  ) {}

  // Code in, identity out. Null for every failure alike (a stale code, a
  // refused exchange, an outage, an answer that does not parse): the
  // caller has exactly one thing to do about any of them, which is to
  // send the player back with "that did not work".
  async exchange(code: string): Promise<DiscordIdentity | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);
    try {
      const form = new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.cfg.redirectUri,
      });
      const tokenRes = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: controller.signal,
      });
      if (!tokenRes.ok) {
        // The code is a bearer credential, so it stays out of the log.
        console.error(`discord token exchange refused with ${tokenRes.status}`);
        return null;
      }
      const token = (await tokenRes.json()) as { access_token?: unknown };
      if (typeof token.access_token !== 'string' || token.access_token.length === 0) return null;
      const meRes = await this.fetchImpl(this.identityUrl, {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: controller.signal,
      });
      if (!meRes.ok) {
        console.error(`discord identity refused with ${meRes.status}`);
        return null;
      }
      return readIdentity(await meRes.json());
    } catch (err) {
      console.error('discord exchange failed', err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
