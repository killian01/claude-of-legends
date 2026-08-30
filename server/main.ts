// The authoritative game server: one process, one port. Serves the built
// client from dist/, upgrades /ws to WebSocket, runs every live match's Sim
// on a fixed-step 20 Hz accumulator, and streams team-scoped snapshots.
// Every connection belongs to an account (ADR 0006): the upgrade itself is
// refused without a live session, so nothing below this line has to wonder
// who it is talking to. No database still: accounts, sessions and the
// match log are JSON files under DATA_DIR.

import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { type WebSocket, WebSocketServer } from 'ws';
import { isFiniteVec, parseClientMsg, type ServerMsg } from '../src/net/protocol';
import { DT } from '../src/sim/types';
import { foldName, nameErrorMessage } from './account_name';
import {
  type Account,
  AccountRegistry,
  publicAccount,
  type RegisterError,
  selfAccount,
} from './accounts';
import { CONFIRM_TTL_MS, RESET_TTL_MS, TokenStore } from './action_tokens';
import { fillWithBots } from './bot_fill';
import { ConnectionLimiter } from './conn_limit';
import { clearCookie, parseCookies, serializeCookie } from './cookies';
import { DiscordFlows, PENDING_TTL_MS, TICKET_COOKIE } from './discord_link';
import { authorizeUrl, CALLBACK_PATH, DiscordOauth, discordConfigFromEnv } from './discord_oauth';
import { clientAddress, edgeConfig, originAllowed } from './edge';
import { emailErrorMessage } from './email_address';
import { CLAIM_TTL_MS } from './email_claim';
import { buildLadder } from './ladder';
import { accountKey, addressKey, LoginThrottle } from './login_throttle';
import { confirmMail, confirmUrl, publicOrigin, resetMail, resetUrl } from './mail_messages';
import { mailerFromEnv } from './mailer';
import { AFK_IDLE_TICKS, Match } from './match';
import { Matchmaker } from './matchmaker';
import { passwordErrorMessage, validatePassword } from './password';
import { buildProfile } from './profile';
import { isRated, LEAVER_LOCKOUT_MS, leaverPenalty, type RatedSeat, ratingDeltas } from './rating';
import { buildMatchRecord, type MatchRecord } from './records';
import { RejoinRegistry } from './rejoin';
import { COOKIE_NAME, SESSION_TTL_MS, SessionStore } from './sessions';
import { appendJsonl, pruneNumberedJson, readJsonl, saveJsonAtomic } from './store';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = path.resolve(process.cwd(), 'dist');
// Runtime state on disk: account identities and the match log. DATA_DIR is
// the volume to mount in production; nothing else persists.
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
const TICK_MS = DT * 1000;
const MATCH_LINGER_MS = 20_000;
// How long a match with zero connected players keeps running so a dropped
// player (or a reloading solo player) can claim their seat back.
const REJOIN_GRACE_MS = 60_000;
const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 60;
// Abuse bound on live sims per process. Sockets per address are capped by
// server/conn_limit.ts.
const MAX_MATCHES = 50;
// What to believe about a connection that came through a proxy: how deep
// the forwarded chain is (TRUST_PROXY) and which pages may open a socket
// besides our own (ALLOWED_ORIGINS). Both default to trusting nothing.
const EDGE = edgeConfig(process.env);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  // The landing art is the one jpg in the tree, and the first thing a
  // visitor loads. Without this it went out as application/octet-stream,
  // which browsers sniff past for an <img> but which makes the preload
  // link in ui/home_backdrop.ts a coin flip.
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};

interface Client {
  id: number;
  ws: WebSocket;
  // Both settled on the upgrade, from the session cookie: there is no
  // anonymous window in which a client exists without an account.
  accountId: number;
  name: string;
  // The session this socket came in on, so closing it can be traced back
  // to a logout elsewhere.
  sessionId: string;
  matchId: number | null;
  msgWindowStart: number;
  msgCount: number;
}

const clients = new Map<number, Client>();
interface MatchEntry {
  match: Match;
  endedAt: number | null;
  failures: number;
  // Set when the last connected player drops; the match survives a grace
  // window for rejoins instead of being reaped on the spot.
  abandonedAt: number | null;
  // Only public-queue matches can be rated; a private lobby never is
  // (it would be a boosting machine otherwise).
  ratedEligible: boolean;
}
const matches = new Map<number, MatchEntry>();
// Abandoned seats and leaver lockouts, both keyed on the account
// (server/rejoin.ts): the seat comes back on whatever device its owner
// logs in from, and the lockout follows the person who earned it.
const rejoins = new RejoinRegistry();
let nextClientId = 1;
let nextMatchId = 1;

const registry = new AccountRegistry(path.join(DATA_DIR, 'accounts.json'));
const sessions = new SessionStore(path.join(DATA_DIR, 'sessions.json'));
// What a wrong password costs the next attempt (server/login_throttle.ts).
const logins = new LoginThrottle();
// One-time links for confirming an address and for resetting a password
// (ADR 0007). Persisted, because a deploy replaces the container and every
// pending link in somebody's inbox would die with it.
const tokens = new TokenStore(path.join(DATA_DIR, 'tokens.json'));
// Asking for a reset makes this server send mail to a third party, so it
// is rate limited per address on its own budget. "Attempt" here means
// "request", not "wrong guess": the cost is the mail, not the mistake.
const resets = new LoginThrottle();
// A third party this process talks to, and only outbound. Without
// MAIL_API_KEY it logs links instead of sending them, and says so at boot.
const mailer = mailerFromEnv(process.env);
// What the links in those mails point at.
const ORIGIN = publicOrigin(process.env, EDGE.origins, PORT);
// The other one, and it is entirely optional (ADR 0008): without the two
// Discord secrets the routes below answer "not configured", the client
// never offers the button, and everything else works exactly as before.
const DISCORD = discordConfigFromEnv(process.env, ORIGIN);
const discord = DISCORD ? new DiscordOauth(DISCORD) : null;
// The states in flight and the links waiting for a signup to finish.
// In memory only: both are minutes old and their owner is watching.
const discordFlows = new DiscordFlows();
const MATCHES_FILE = path.join(DATA_DIR, 'matches.jsonl');
const REPLAYS_DIR = path.join(DATA_DIR, 'replays');
// How many finished-match replays stay on disk (named by match id).
const REPLAY_KEEP = 40;
// The whole log stays in memory for profile queries; one line per match,
// appended as each ends (kilobytes each, guests-scale).
const matchLog: MatchRecord[] = readJsonl<MatchRecord>(MATCHES_FILE);

// What a refused registration says, one line per way it can be refused.
// A table rather than a chain of ternaries, so a new way to be refused is
// one line and cannot be dropped by accident.
const REGISTER_ERRORS: Record<RegisterError, string> = {
  name_invalid: nameErrorMessage('charset'),
  name_taken: 'That name is taken.',
  password_invalid: passwordErrorMessage('too_short'),
  email_invalid: emailErrorMessage('shape'),
  email_taken: 'An account already uses that email address.',
  discord_taken: 'That Discord account is already linked to another account here.',
};

// The public shape of an account: publicAccount() drops the credential by
// construction rather than by deletion, and tests/architecture.test.ts
// holds that line for every route that ever serialises one.
function describeAccount(a: Account): unknown {
  return { ...publicAccount(a), profile: buildProfile(matchLog, a.id) };
}

// The same, for the owner asking about themselves: it adds the address
// they registered with and whether it is confirmed, which nobody else may
// see. /api/account/:id stays on describeAccount for exactly that reason.
function describeSelf(a: Account): unknown {
  return { ...selfAccount(a), profile: buildProfile(matchLog, a.id) };
}

// Issues a fresh confirmation link and mails it. Deliberately not awaited
// by its callers: a slow relay must not hold a registration open, and the
// account works perfectly well unconfirmed (ADR 0007).
async function sendConfirmation(account: Account): Promise<void> {
  if (!account.email || account.email.confirmed) return;
  const token = tokens.issue('confirm', account.id, account.email.address, Date.now());
  const sent = await mailer.send(
    confirmMail(
      account.email.address,
      account.name,
      confirmUrl(ORIGIN, token.token),
      CONFIRM_TTL_MS,
    ),
  );
  // The address is a player's and stays out of the log; the id is enough
  // to find them if someone reports never getting their mail.
  if (!sent) console.error(`confirmation mail not delivered for account ${account.id}`);
}

function send(clientId: number, msg: ServerMsg): void {
  const c = clients.get(clientId);
  if (!c || c.ws.readyState !== c.ws.OPEN) return;
  c.ws.send(JSON.stringify(msg));
}

const matchmaker = new Matchmaker(send, (picks, source) => {
  const id = nextMatchId++;
  const match = new Match((Date.now() % 2_000_000_000) + id, fillWithBots(picks));
  matches.set(id, {
    match,
    endedAt: null,
    failures: 0,
    abandonedAt: null,
    ratedEligible: source === 'queue',
  });
  for (const p of picks) {
    const c = clients.get(p.clientId);
    if (!c) continue;
    c.matchId = id;
    const player = match.players.get(p.clientId);
    if (player) send(p.clientId, { t: 'match_start', selfUnitId: player.unitId, team: p.team });
  }
  console.log(`match ${id} started with ${picks.length} player(s)`);
});

// A player leaves a live match FOR GOOD, by choice or by the AFK sweep:
// rated walk-out penalty and queue lockout when it applies, champion to a
// bot with NO seat reservation, team notice, abandon check. Reservations
// are for dropped connections only.
function walkOutOfMatch(client: Client, entry: MatchEntry, matchId: number): void {
  client.matchId = null;
  rejoins.drop(client.accountId);
  if (entry.ratedEligible && entry.match.sim.winner === null) {
    const humansByTeam: [number, number] = [0, 0];
    for (const p of entry.match.players.values()) {
      if (clients.has(p.clientId)) humansByTeam[p.team] += 1;
    }
    const penalty = leaverPenalty(humansByTeam);
    const account = registry.findById(client.accountId);
    if (penalty > 0 && account) {
      registry.penalize(account.id, penalty);
      rejoins.lockQueue(client.accountId, Date.now() + LEAVER_LOCKOUT_MS);
      console.log(
        `match ${matchId}: ${client.name} left a rated match (-${penalty}, queue locked)`,
      );
    }
  }
  const left = entry.match.handleDisconnect(client.id);
  if (left) {
    for (const cid of entry.match.players.keys()) {
      send(cid, { t: 'player_left', name: left.name, team: left.team });
    }
  }
  const anyConnected = [...entry.match.players.keys()].some((cid) => clients.has(cid));
  if (!anyConnected && entry.abandonedAt === null) {
    entry.abandonedAt = Date.now();
    console.log(`match ${matchId} abandoned: holding for rejoin grace`);
  }
}

// --- HTTP: auth, the meta API, the static client ---

// Secure cookies need a secure context. Production is always HTTPS behind
// Caddy; dev is http://localhost, which browsers already treat as secure,
// so the flag is safe to set there too. A plain-http deployment on a bare
// IP is the only case that has to go without.
function cookieSecure(req: http.IncomingMessage): boolean {
  if ((req.headers['x-forwarded-proto'] ?? '').toString().split(',')[0]?.trim() === 'https') {
    return true;
  }
  const host = (req.headers.host ?? '').split(':')[0];
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

// The account behind a request, or undefined. Every use rolls the session
// forward in memory (server/sessions.ts explains why that is not a write).
function accountForRequest(req: http.IncomingMessage, now: number): Account | undefined {
  const id = parseCookies(req.headers.cookie).get(COOKIE_NAME);
  if (!id) return undefined;
  const session = sessions.resolve(id, now);
  if (!session) return undefined;
  const account = registry.findById(session.accountId);
  if (!account) return undefined;
  sessions.touch(id, now);
  registry.touch(account.id, now);
  return account;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Bodies here are tiny (a name and a password); anything larger is not a
// login and is dropped rather than buffered.
const MAX_BODY_BYTES = 2048;

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Adds one Set-Cookie without dropping any already on the response. A
// registration that came back from Discord sets two (the new session, and
// the spent ticket being cleared), and setHeader would have kept only the
// last one written.
function addCookie(res: http.ServerResponse, cookie: string): void {
  const existing = res.getHeader('set-cookie');
  const already = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  res.setHeader('set-cookie', [...already, cookie]);
}

function openSession(res: http.ServerResponse, req: http.IncomingMessage, account: Account): void {
  const session = sessions.create(account.id, Date.now());
  addCookie(
    res,
    serializeCookie(COOKIE_NAME, session.id, {
      maxAgeS: Math.floor(SESSION_TTL_MS / 1000),
      secure: cookieSecure(req),
    }),
  );
}

const server = http.createServer(async (req, res) => {
  try {
    const url = (req.url ?? '/').split('?')[0]!;

    // --- auth: the only routes reachable without a session ---
    if (url === '/api/register' || url === '/api/login') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'use POST' });
        return;
      }
      const body = await readJsonBody(req);
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      const now = Date.now();
      // Both keys, so neither a word list at one name nor one machine
      // sweeping many names gets a free run (server/login_throttle.ts).
      const keys = [
        accountKey(foldName(name)),
        addressKey(clientAddress(req.headers, req.socket.remoteAddress, EDGE)),
      ];
      const wait = logins.retryAfterAny(keys, now);
      if (wait > 0) {
        res.setHeader('retry-after', String(Math.ceil(wait / 1000)));
        sendJson(res, 429, {
          error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.`,
        });
        return;
      }
      if (url === '/api/register') {
        // A Discord round trip that finished before the form did leaves a
        // ticket in a cookie (ADR 0008). Only peeked at here: a signup
        // that fails on its name must not spend the link the player made,
        // or they would have to go round again to fix a typo.
        const ticket = parseCookies(req.headers.cookie).get(TICKET_COOKIE) ?? '';
        const pending = ticket ? discordFlows.peek(ticket, now) : undefined;
        const created = registry.register(name, password, email, now, pending);
        if (!created.ok) {
          // A taken name is not a failed credential guess, but it is still
          // an attempt: rate it, or the signup form becomes the oracle the
          // login form refuses to be.
          for (const key of keys) logins.recordFailure(key, now);
          // "Taken" for an address says an account exists on it, which is
          // the same disclosure the login form refuses to make. It is
          // unavoidable: uniqueness cannot be enforced without saying so.
          // The throttle above is what keeps it from being enumerable.
          sendJson(res, 409, { error: REGISTER_ERRORS[created.error] });
          return;
        }
        for (const key of keys) logins.recordSuccess(key);
        // The account exists, so the link is spent and the cookie that
        // carried it has no further use. Both, or a reload of the signup
        // page would offer to attach a Discord that is already attached.
        if (ticket) {
          discordFlows.claim(ticket, now);
          addCookie(res, clearCookie(TICKET_COOKIE, { secure: cookieSecure(req) }));
        }
        openSession(res, req, created.value);
        sendJson(res, 200, selfAccount(created.value));
        // Not awaited: the account is usable now, the link can arrive when
        // it arrives, and a broken relay must not break registration.
        void sendConfirmation(created.value);
        return;
      }
      const account = registry.authenticate(name, password);
      if (!account) {
        for (const key of keys) logins.recordFailure(key, now);
        // One message for an unknown name and for a wrong password: the
        // answer must not tell an attacker which names exist.
        sendJson(res, 401, { error: 'Wrong name or password.' });
        return;
      }
      for (const key of keys) logins.recordSuccess(key);
      registry.touch(account.id, now);
      openSession(res, req, account);
      sendJson(res, 200, selfAccount(account));
      return;
    }

    // The landing page's counters, and the one hole in the wall. It is
    // deliberately three integers: no name, no id, nothing that could be
    // walked to learn who plays here. /healthz already published the same
    // two live numbers to anyone who asked, so this adds no exposure, only
    // an endpoint that says out loud that it is public.
    if (url === '/api/public/stats') {
      sendJson(res, 200, {
        online: clients.size,
        matches: [...matches.values()].filter((e) => e.endedAt === null).length,
        accounts: registry.count,
      });
      return;
    }

    // Followed from a mail client, so it must be a plain GET and must end
    // somewhere a person can read. Success and failure both land on the
    // site; the query says which, and the page explains it.
    if (url === '/api/email/confirm') {
      const token = new URLSearchParams((req.url ?? '').split('?')[1] ?? '').get('token') ?? '';
      const now = Date.now();
      const redeemed = tokens.redeem(token, 'confirm', now);
      // The token carries the address it was issued for: an old link must
      // not confirm an address the account moved to since.
      const ok = redeemed ? registry.confirmEmail(redeemed.accountId, redeemed.email, now) : false;
      res.writeHead(302, { location: `${ORIGIN}/?confirmed=${ok ? '1' : '0'}` });
      res.end();
      return;
    }

    // --- linking a Discord account (ADR 0008) ---
    // Reachable without a session on purpose: the whole point is that
    // somebody can start the round trip while creating their account,
    // before there is a session to start it under. A signed-in caller
    // links to the account they are signed in as, and everyone else is
    // linking to an account that does not exist yet.
    if (url === '/api/discord/start') {
      const now = Date.now();
      if (!DISCORD) {
        res.writeHead(302, { location: `${ORIGIN}/?discord=off`, 'cache-control': 'no-store' });
        res.end();
        return;
      }
      const me = accountForRequest(req, now);
      const state = discordFlows.start(me?.id ?? null, now);
      res.writeHead(302, {
        location: authorizeUrl(DISCORD, state),
        'cache-control': 'no-store',
      });
      res.end();
      return;
    }

    // Where Discord sends the browser back. Like the confirmation link it
    // is a plain GET that has to end somewhere a person can read, so every
    // outcome lands on the site and the query says which one.
    if (url === CALLBACK_PATH) {
      const q = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const now = Date.now();
      const land = (outcome: string): void => {
        res.writeHead(302, {
          location: `${ORIGIN}/?discord=${outcome}`,
          'cache-control': 'no-store',
        });
        res.end();
      };
      // The state is the whole defence: unknown, expired and forged are
      // one case, and it is spent whether or not the rest works out.
      const flow = discordFlows.take(q.get('state') ?? '', now);
      const code = q.get('code') ?? '';
      // No code means the player said no on the consent screen, which is
      // an answer and not a failure, but there is nothing to do with it
      // either way.
      if (!discord || !flow || code.length === 0 || code.length > 512) {
        land('failed');
        return;
      }
      const identity = await discord.exchange(code);
      if (!identity) {
        land('failed');
        return;
      }
      // Held already, by this account or another: either way there is
      // nothing to link. Saying so to the person who just proved they own
      // that Discord discloses nothing they could not already check.
      const held = registry.findByDiscordId(identity.id);
      if (flow.accountId === null) {
        if (held) {
          land('taken');
          return;
        }
        // Nothing to attach this to yet, so it waits under a ticket the
        // browser carries into /api/register.
        const ticket = discordFlows.hold(identity, now);
        addCookie(
          res,
          serializeCookie(TICKET_COOKIE, ticket, {
            maxAgeS: Math.floor(PENDING_TTL_MS / 1000),
            secure: cookieSecure(req),
          }),
        );
        land('ready');
        return;
      }
      const linked = registry.linkDiscord(flow.accountId, identity, now);
      land(linked.ok ? 'linked' : 'taken');
      return;
    }

    // What is waiting under this browser's ticket, for the signup form to
    // name the Discord it is about to attach. Peeked, never spent: only
    // creating the account spends it. Answers about this caller's own
    // cookie and nothing else, which is why it needs no session.
    if (url === '/api/discord/pending') {
      const ticket = parseCookies(req.headers.cookie).get(TICKET_COOKIE);
      const waiting = ticket ? discordFlows.peek(ticket, Date.now()) : undefined;
      sendJson(res, 200, { configured: DISCORD !== null, discord: waiting?.username ?? null });
      return;
    }

    // Asking for a reset link. Always answers the same way, whatever it
    // finds: telling a caller that an address is on the server would make
    // this the account directory the wall exists to prevent.
    if (url === '/api/password/forgot') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'use POST' });
        return;
      }
      const body = await readJsonBody(req);
      const email = typeof body?.email === 'string' ? body.email.trim() : '';
      const now = Date.now();
      const key = addressKey(clientAddress(req.headers, req.socket.remoteAddress, EDGE));
      const wait = resets.retryAfterMs(key, now);
      if (wait > 0) {
        res.setHeader('retry-after', String(Math.ceil(wait / 1000)));
        sendJson(res, 429, {
          error: `Too many requests. Try again in ${Math.ceil(wait / 1000)}s.`,
        });
        return;
      }
      resets.recordFailure(key, now);
      // Confirmed addresses only. A mistyped address at signup belongs to
      // a stranger who never asked for it, and resetting into their inbox
      // would hand them somebody else's account.
      const account = registry.findByConfirmedEmail(email);
      if (account?.email) {
        const token = tokens.issue('reset', account.id, account.email.address, now);
        void mailer
          .send(
            resetMail(
              account.email.address,
              account.name,
              resetUrl(ORIGIN, token.token),
              RESET_TTL_MS,
            ),
          )
          .then((sent) => {
            if (!sent) console.error(`reset mail not delivered for account ${account.id}`);
          });
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // Spending a reset link.
    if (url === '/api/password/reset') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'use POST' });
        return;
      }
      const body = await readJsonBody(req);
      const token = typeof body?.token === 'string' ? body.token : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      // Checked BEFORE the token is spent: a password that is too short is
      // the owner's typo, and it must not cost them the link as well.
      const passErr = validatePassword(password);
      if (passErr) {
        sendJson(res, 400, { error: passwordErrorMessage(passErr) });
        return;
      }
      const redeemed = tokens.redeem(token, 'reset', Date.now());
      if (!redeemed || !registry.setPassword(redeemed.accountId, password)) {
        sendJson(res, 400, { error: 'That link has expired or has already been used.' });
        return;
      }
      // A reset is what someone reaches for when they believe another
      // person has their password: every open session and every other
      // outstanding link goes with it.
      sessions.revokeAllFor(redeemed.accountId);
      tokens.revokeAllFor(redeemed.accountId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url === '/api/logout') {
      const id = parseCookies(req.headers.cookie).get(COOKIE_NAME);
      const everywhere =
        new URLSearchParams((req.url ?? '').split('?')[1] ?? '').get('all') === '1';
      if (id) {
        const session = sessions.resolve(id, Date.now());
        // Logging out everywhere is what a player reaches for after
        // playing on someone else's machine; it is why sessions are
        // stored at all (ADR 0006).
        if (everywhere && session) sessions.revokeAllFor(session.accountId);
        else sessions.revoke(id);
      }
      res.setHeader('set-cookie', clearCookie(COOKIE_NAME, { secure: cookieSecure(req) }));
      sendJson(res, 200, { ok: true });
      return;
    }

    // --- everything else under /api needs an account ---
    if (url.startsWith('/api/')) {
      const me = accountForRequest(req, Date.now());
      if (!me) {
        sendJson(res, 401, { error: 'This needs an account.' });
        return;
      }
      if (url === '/api/me') {
        sendJson(res, 200, describeSelf(me));
        return;
      }
      // Fixing a typo at signup, moving mailbox, or adding an address to
      // an account old enough not to have one.
      if (url === '/api/email') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'use POST' });
          return;
        }
        const body = await readJsonBody(req);
        const email = typeof body?.email === 'string' ? body.email.trim() : '';
        const result = registry.setEmail(me.id, email, Date.now());
        if (!result.ok) {
          sendJson(res, 409, {
            error:
              result.error === 'email_taken'
                ? 'An account already uses that email address.'
                : emailErrorMessage('shape'),
          });
          return;
        }
        sendJson(res, 200, selfAccount(result.value));
        void sendConfirmation(result.value);
        return;
      }
      // The link never arrived, or it sat too long. Rate limited on the
      // same budget as a reset request, and for the same reason: it is a
      // button that makes this server send mail.
      if (url === '/api/email/resend') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'use POST' });
          return;
        }
        const now = Date.now();
        const key = addressKey(clientAddress(req.headers, req.socket.remoteAddress, EDGE));
        const wait = resets.retryAfterMs(key, now);
        if (wait > 0) {
          res.setHeader('retry-after', String(Math.ceil(wait / 1000)));
          sendJson(res, 429, {
            error: `Too many requests. Try again in ${Math.ceil(wait / 1000)}s.`,
          });
          return;
        }
        resets.recordFailure(key, now);
        sendJson(res, 200, { ok: true });
        void sendConfirmation(me);
        return;
      }
      // Undoing a link. The owner's to undo and nobody else's, so it is a
      // POST on the session rather than anything a link could trigger,
      // and it releases the Discord id for whatever account its owner
      // wants to attach it to next (ADR 0008).
      if (url === '/api/discord/unlink') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'use POST' });
          return;
        }
        registry.unlinkDiscord(me.id);
        sendJson(res, 200, selfAccount(me));
        return;
      }
      if (url === '/api/ladder') {
        sendJson(res, 200, buildLadder(registry.all()));
        return;
      }
      if (url === '/api/live') {
        // Running matches open to spectators: never abandoned, not ended.
        const live = [...matches.entries()]
          .filter(([, e]) => e.endedAt === null && e.abandonedAt === null)
          .map(([id, e]) => ({
            id,
            durationS: Math.round(e.match.sim.time),
            spectators: e.match.spectators.size,
            players: [...e.match.players.values()].map((p) => ({ name: p.name, team: p.team })),
          }));
        sendJson(res, 200, live);
        return;
      }
      const replayUrl = /^\/api\/replay\/(\d{1,9})$/.exec(url);
      if (replayUrl) {
        try {
          const body = await readFile(path.join(REPLAYS_DIR, `${replayUrl[1]}.json`));
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(body);
        } catch {
          sendJson(res, 404, { error: 'replay not found' });
        }
        return;
      }
      const accountUrl = /^\/api\/account\/(\d{1,9})$/.exec(url);
      if (accountUrl) {
        const a = registry.findById(Number(accountUrl[1]));
        if (!a) {
          sendJson(res, 404, { error: 'unknown account' });
          return;
        }
        sendJson(res, 200, describeAccount(a));
        return;
      }
      sendJson(res, 404, { error: 'unknown endpoint' });
      return;
    }
    if (url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          clients: clients.size,
          matches: matches.size,
          uptimeS: Math.round(process.uptime()),
        }),
      );
      return;
    }
    let filePath = path.join(DIST, url === '/' ? 'index.html' : url);
    if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {
      filePath = path.join(DIST, 'index.html');
    }
    const body = await readFile(filePath);
    // The client shipped no caching headers at all, which leaves a browser
    // free to serve a stale index.html and with it the previous build's
    // hashed bundle: you reload after a change and see yesterday's game.
    // Vite fingerprints everything under /assets/, so those are immutable
    // and the entry document must always be revalidated.
    const immutable = url.startsWith('/assets/');
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

// --- WebSocket ---

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 16 * 1024,
  // A seat is handed out on the upgrade, so both gates live here: a page
  // we never served does not get one (a client with no Origin header, a
  // headless bot, does), and neither does a visitor with no live session.
  // Refusing here rather than after the socket opens means nothing below
  // has to carry an "unauthenticated client" state.
  verifyClient: ({ req }, done) => {
    if (!originAllowed(req.headers, EDGE)) {
      console.warn(`refused upgrade from origin ${String(req.headers.origin)}`);
      done(false, 403, 'forbidden origin');
      return;
    }
    const cookieId = parseCookies(req.headers.cookie).get(COOKIE_NAME);
    const session = cookieId ? sessions.resolve(cookieId, Date.now()) : undefined;
    if (!session || !registry.findById(session.accountId)) {
      done(false, 401, 'this needs an account');
      return;
    }
    done(true);
  },
});

// Sockets per player address, so one machine cannot farm connections.
const connections = new ConnectionLimiter();

wss.on('connection', (ws, req) => {
  const ip = clientAddress(req.headers, req.socket.remoteAddress, EDGE);
  if (!connections.acquire(ip)) {
    ws.close(1013, 'too many connections');
    return;
  }
  // verifyClient already refused anything without a live session, so this
  // can only fail if the session died in the microseconds since. Treat it
  // as a refusal rather than trusting a half-identified socket.
  const now = Date.now();
  const cookieId = parseCookies(req.headers.cookie).get(COOKIE_NAME) ?? '';
  const session = sessions.resolve(cookieId, now);
  const account = session ? registry.findById(session.accountId) : undefined;
  if (!session || !account) {
    connections.release(ip);
    ws.close(4401, 'this needs an account');
    return;
  }
  sessions.touch(cookieId, now);
  registry.touch(account.id, now);

  // One game socket per account: a second connection takes the seat and
  // the first is closed. Two sockets on one account could otherwise queue
  // into both sides of the same match, which would make its Elo
  // self-referential. The upside is the reason to prefer it to a refusal:
  // when a laptop dies mid-match, the phone takes the seat back.
  for (const other of clients.values()) {
    if (other.accountId === account.id) {
      other.ws.close(4409, 'this account connected somewhere else');
    }
  }

  const id = nextClientId++;
  const client: Client = {
    id,
    ws,
    accountId: account.id,
    name: account.name,
    sessionId: session.id,
    matchId: null,
    msgWindowStart: now,
    msgCount: 0,
  };
  clients.set(id, client);
  send(id, { t: 'welcome', clientId: id, name: account.name });

  ws.on('message', (data) => {
    const raw = data.toString();
    if (raw.length > MAX_MSG_BYTES) return;
    const now = Date.now();
    if (now - client.msgWindowStart > 1000) {
      client.msgWindowStart = now;
      client.msgCount = 0;
    }
    if (++client.msgCount > MAX_MSGS_PER_SEC) return;

    const msg = parseClientMsg(raw);
    if (!msg) return;

    if (msg.t === 'hello') {
      // Identity was settled on the upgrade, so hello carries none: it
      // only asks whether a live match is still holding this account's
      // seat. If it is, hand it back (the bot stand-in steps aside); the
      // later queue/lobby message is then ignored by the in-match guard.
      // Keyed on the account, so the seat comes back on whatever device
      // the player reconnects from.
      const seat = rejoins.claim(client.accountId);
      if (seat) {
        const entry = matches.get(seat.matchId);
        if (entry) {
          entry.match.restorePlayer(id, seat);
          entry.abandonedAt = null;
          client.matchId = seat.matchId;
          send(id, { t: 'match_start', selfUnitId: seat.unitId, team: seat.team });
          for (const cid of entry.match.players.keys()) {
            if (cid !== id) send(cid, { t: 'player_back', name: seat.name, team: seat.team });
          }
          console.log(`match ${seat.matchId}: ${seat.name} reconnected`);
        }
      }
      return;
    }

    // A client already seated in a live match cannot re-enter matchmaking
    // (review F.2: interleaved double-match snapshots corrupted the mirror).
    const inMatch = client.matchId !== null;
    // Capacity gate at the entry points: a full server refuses new games
    // politely instead of degrading every running one.
    const atCapacity = matches.size >= MAX_MATCHES;
    const refuseCapacity = (): void =>
      send(id, { t: 'error', message: 'The server is at capacity, try again in a bit.' });
    switch (msg.t) {
      case 'queue': {
        if (inMatch) break;
        // Rated-match leavers sit out a short lockout before requeueing.
        const locked = rejoins.queueLockRemaining(client.accountId, now);
        if (locked > 0) {
          send(id, {
            t: 'error',
            message: `You left a rated match. The queue unlocks in ${Math.ceil(locked / 1000)}s.`,
          });
          break;
        }
        if (atCapacity) refuseCapacity();
        else matchmaker.addToQueue(id, client.name, now);
        break;
      }
      case 'start_now':
        if (!inMatch) matchmaker.startNow(id, now);
        break;
      case 'leave': {
        matchmaker.removeEverywhere(id);
        // A deliberate walk-out from a live match: hand the champion to a
        // bot for good and hold NO seat reservation. Reservations are for
        // dropped connections; a player who chose to leave (end screen,
        // escape menu) must not be pulled back in by their next queue.
        const leftMatchId = client.matchId;
        if (leftMatchId !== null) {
          const entry = matches.get(leftMatchId);
          if (entry && !entry.match.players.has(id)) {
            // A spectator walking out only stops watching: no bot
            // takeover, no penalty, no team notice.
            client.matchId = null;
            entry.match.removeSpectator(id);
          } else if (entry) {
            walkOutOfMatch(client, entry, leftMatchId);
          } else {
            client.matchId = null;
            rejoins.drop(client.accountId);
          }
        }
        break;
      }
      case 'create_lobby':
        if (inMatch) break;
        if (atCapacity) refuseCapacity();
        else matchmaker.createLobby(id, client.name, now);
        break;
      case 'join_lobby':
        if (!inMatch) matchmaker.joinLobby(id, client.name, String(msg.code ?? ''));
        break;
      case 'lobby_team':
        if (!inMatch) matchmaker.setLobbyTeam(id, msg.team);
        break;
      case 'queue_party':
        if (inMatch) break;
        if (atCapacity) refuseCapacity();
        else if (rejoins.queueLockRemaining(client.accountId, now) > 0) {
          const locked = rejoins.queueLockRemaining(client.accountId, now);
          send(id, {
            t: 'error',
            message: `You left a rated match. The queue unlocks in ${Math.ceil(locked / 1000)}s.`,
          });
        } else matchmaker.queuePartyFromLobby(id, now);
        break;
      case 'spectate': {
        if (inMatch) break;
        const target = typeof msg.matchId === 'number' ? matches.get(msg.matchId) : undefined;
        if (!target || target.endedAt !== null || target.abandonedAt !== null) {
          send(id, { t: 'error', message: 'That match is over or gone.' });
          break;
        }
        if (!target.match.addSpectator(id, msg.team === 1 ? 1 : 0)) {
          send(id, { t: 'error', message: 'That match has no spectator slots left.' });
          break;
        }
        client.matchId = msg.matchId as number;
        send(id, { t: 'match_start', selfUnitId: 0, team: msg.team === 1 ? 1 : 0 });
        break;
      }
      case 'start_lobby':
        if (!inMatch) matchmaker.startLobby(id, now);
        break;
      case 'pick':
        matchmaker.pick(id, msg.championId, msg.sigils, msg.skin);
        break;
      case 'chat':
      case 'ping': {
        if (client.matchId === null) break;
        const entry = matches.get(client.matchId);
        const player = entry?.match.players.get(id);
        if (!entry || !player) break;
        // Team-scoped, like the snapshots: a chat line or a ping must never
        // hand the enemy a position (review: cross-team ping leak).
        if (msg.t === 'chat') {
          const text = String(msg.text ?? '')
            .trim()
            .slice(0, 200);
          if (!text) break;
          for (const cid of entry.match.teamRecipients(id)) {
            send(cid, { t: 'chat', from: player.name, team: player.team, text });
          }
        } else if (isFiniteVec(msg.x, msg.z)) {
          for (const cid of entry.match.teamRecipients(id)) {
            send(cid, {
              t: 'ping',
              from: player.name,
              team: player.team,
              x: msg.x,
              z: msg.z,
            });
          }
        }
        break;
      }
      default: {
        if (client.matchId === null) return;
        const entry = matches.get(client.matchId);
        if (entry) entry.match.handleCommand(id, msg);
      }
    }
  });

  ws.on('close', () => {
    connections.release(ip);
    matchmaker.removeEverywhere(id);
    const matchId = client.matchId;
    clients.delete(id);
    // Reap matches whose players are all gone (review F.2: ghost matches
    // kept ticking until a Sanctum fell).
    if (matchId !== null) {
      const entry = matches.get(matchId);
      if (entry) {
        // A dropped spectator just stops watching.
        entry.match.removeSpectator(id);
        // Hand the abandoned champion to a bot, tell the team, and reserve
        // the seat against the account so the player can come back, from
        // this browser or any other they log in on.
        const left = entry.match.handleDisconnect(id);
        if (left) {
          rejoins.reserve(client.accountId, { matchId, ...left });
          for (const cid of entry.match.players.keys()) {
            send(cid, { t: 'player_left', name: left.name, team: left.team });
          }
        }
        // Not reaped on the spot: the seat reservations above deserve a
        // grace window, so an accidental reload can come back (the world
        // loop reaps once the window closes).
        const anyConnected = [...entry.match.players.keys()].some((cid) => clients.has(cid));
        if (!anyConnected && entry.abandonedAt === null) {
          entry.abandonedAt = Date.now();
          console.log(`match ${matchId} abandoned: holding for rejoin grace`);
        }
      }
    }
  });
});

// --- The world loop: fixed-step accumulator, guarded per match ---

let last = Date.now();
let acc = 0;
setInterval(() => {
  const now = Date.now();
  acc += Math.min(now - last, 500);
  last = now;
  matchmaker.tickClock(now);

  // Reap abandoned matches whose rejoin grace ran out.
  for (const [matchId, entry] of matches) {
    if (entry.abandonedAt !== null && now - entry.abandonedAt > REJOIN_GRACE_MS) {
      matches.delete(matchId);
      rejoins.pruneMatch(matchId);
      console.log(`match ${matchId} reaped: rejoin grace expired`);
    }
  }

  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    for (const [matchId, entry] of matches) {
      try {
        entry.match.tick();
        const score = entry.match.sim.tickCount % 40 === 0 ? entry.match.buildScore() : null;
        for (const player of entry.match.players.values()) {
          const snap = entry.match.buildSnapshotFor(player.clientId);
          if (snap) send(player.clientId, snap);
          if (score) send(player.clientId, score);
        }
        for (const cid of entry.match.spectators.keys()) {
          const snap = entry.match.buildSpectatorSnapshotFor(cid);
          if (snap) send(cid, snap);
          if (score) send(cid, score);
        }
        // AFK sweep: a connected player silent for two minutes in a live
        // match with other humans walks out (bot takeover, penalty when
        // rated); a solo-vs-bots match harms nobody and is left alone.
        if (
          entry.match.sim.tickCount % 200 === 0 &&
          entry.match.sim.winner === null &&
          entry.match.players.size >= 2
        ) {
          for (const cid of entry.match.idleClientIds(AFK_IDLE_TICKS)) {
            const c = clients.get(cid);
            if (!c) continue;
            send(cid, {
              t: 'error',
              message: 'Removed for inactivity: a bot takes your champion over.',
            });
            walkOutOfMatch(c, entry, matchId);
            console.log(`match ${matchId}: ${c.name} removed for inactivity`);
          }
        }
        if (entry.match.sim.winner !== null && entry.endedAt === null) {
          entry.endedAt = now;
          // Record the finished match once, the moment the winner lands:
          // seats still held by a connected human carry their player id.
          const accountIdByUnit = new Map<number, number>();
          for (const p of entry.match.players.values()) {
            const c = clients.get(p.clientId);
            if (c) accountIdByUnit.set(p.unitId, c.accountId);
          }
          // Rating policy (server/rating.ts): only public-queue matches
          // with at least one human on each side are rated; every human
          // on a team moves together.
          const seats: RatedSeat[] = [];
          for (const p of entry.match.players.values()) {
            const pid = accountIdByUnit.get(p.unitId);
            const account = pid !== undefined ? registry.findById(pid) : undefined;
            if (pid !== undefined && account) {
              seats.push({ accountId: pid, team: p.team, rating: account.rating });
            }
          }
          const humansByTeam: [number, number] = [
            seats.filter((s) => s.team === 0).length,
            seats.filter((s) => s.team === 1).length,
          ];
          const rated = entry.ratedEligible && isRated(humansByTeam);
          const deltas = rated
            ? ratingDeltas(seats, entry.match.sim.winner)
            : new Map<number, number>();
          for (const [pid, delta] of deltas) registry.applyRating(pid, delta);
          // Tell each human what the match did to their rating; the end
          // screen shows it next to the final scoreboard.
          for (const p of entry.match.players.values()) {
            const pid = accountIdByUnit.get(p.unitId);
            const account = pid !== undefined ? registry.findById(pid) : undefined;
            if (pid === undefined || !account) continue;
            send(p.clientId, {
              t: 'match_result',
              rated,
              delta: deltas.get(pid) ?? 0,
              rating: account.rating,
            });
          }
          // Save the replay first so the match record can point at it.
          let replayId: number | undefined;
          if (entry.match.replayComplete) {
            try {
              saveJsonAtomic(path.join(REPLAYS_DIR, `${matchId}.json`), {
                version: 1,
                seed: entry.match.seed,
                picks: entry.match.replayPicks,
                events: entry.match.replayEvents,
                ticks: entry.match.sim.tickCount,
              });
              replayId = matchId;
              pruneNumberedJson(REPLAYS_DIR, REPLAY_KEEP);
            } catch (err) {
              console.error('replay save failed', err);
            }
          }
          const score = entry.match.buildScore();
          if (score.t === 'score') {
            const rec = buildMatchRecord(
              score.rows,
              accountIdByUnit,
              entry.match.sim.winner,
              entry.match.sim.time,
              now,
              { rated, deltas },
              replayId,
            );
            matchLog.push(rec);
            try {
              appendJsonl(MATCHES_FILE, rec);
            } catch (err) {
              console.error('match log append failed', err);
            }
            console.log(`match ${matchId} recorded (${accountIdByUnit.size} human seat(s))`);
          }
        }
        if (entry.endedAt !== null && now - entry.endedAt > MATCH_LINGER_MS) {
          for (const player of entry.match.players.values()) {
            const c = clients.get(player.clientId);
            if (c) c.matchId = null;
            send(player.clientId, { t: 'match_end' });
          }
          for (const cid of entry.match.spectators.keys()) {
            const c = clients.get(cid);
            if (c) c.matchId = null;
            send(cid, { t: 'match_end' });
          }
          matches.delete(matchId);
          rejoins.pruneMatch(matchId);
          console.log(`match ${matchId} closed`);
        }
        entry.failures = 0;
      } catch (err) {
        console.error(`match ${matchId} tick failed`, err);
        entry.failures += 1;
        if (entry.failures > 200) {
          for (const player of entry.match.players.values()) {
            const c = clients.get(player.clientId);
            if (c) c.matchId = null;
            send(player.clientId, { t: 'match_end' });
          }
          for (const cid of entry.match.spectators.keys()) {
            const c = clients.get(cid);
            if (c) c.matchId = null;
            send(cid, { t: 'match_end' });
          }
          matches.delete(matchId);
          rejoins.pruneMatch(matchId);
          console.error(`match ${matchId} force-closed after repeated tick failures`);
        }
      }
    }
  }
}, 25);

// Last-resort guards: a throw outside the per-match try/catch must never
// take down every live match silently. Log loudly and keep serving; the
// per-match failure counter already contains repeated sim faults.
process.on('uncaughtException', (err) => {
  console.error('uncaught exception (server kept alive)', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandled rejection (server kept alive)', err);
});

// Graceful stop: close the sockets so clients get a clean disconnect notice
// instead of a timeout.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`${sig}: shutting down`);
    // Write the session expiry extensions that touch() only made in
    // memory, so a restart does not send everyone back to the login form.
    sessions.flush();
    for (const c of clients.values()) c.ws.close();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

// Housekeeping, hourly. None of this is load bearing: an expired session
// and a spent link are already refused on read, and a lapsed email claim
// is released the moment somebody asks for the address. This only stops
// the three files growing with records nothing will ever ask about again.
setInterval(() => {
  const now = Date.now();
  const sessionsDropped = sessions.purgeExpired(now);
  const tokensDropped = tokens.purgeExpired(now);
  const claimsReleased = registry.purgeExpiredClaims(now);
  // In memory and minutes old, so this is the one that would never grow
  // anyway; swept here so nothing is left holding a state from last week.
  discordFlows.purge(now);
  if (sessionsDropped + tokensDropped + claimsReleased > 0) {
    console.log(
      `housekeeping: ${sessionsDropped} session(s), ${tokensDropped} link(s), ` +
        `${claimsReleased} email claim(s) released after ${Math.round(CLAIM_TTL_MS / 86_400_000)} days`,
    );
  }
}, 60 * 60_000).unref();

server.listen(PORT, () => {
  console.log(`claude-of-legends server on :${PORT} (serving ${DIST})`);
  // Said at boot so a misconfigured relay is found now, rather than the
  // first time a player forgets their password.
  console.log(`mail: ${mailer.description}, links point at ${ORIGIN}`);
  console.log(
    DISCORD
      ? `discord: linking on, redirect ${DISCORD.redirectUri}`
      : 'discord: off (no DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET set)',
  );
  console.log(
    `edge: ${EDGE.hops} trusted proxy hop(s), origins ${
      EDGE.origins.length > 0 ? EDGE.origins.join(' ') : 'same-host only'
    }`,
  );
  // In dev the vite server owns the client and this warning is expected
  // noise only when dist was never built; in production it means the image
  // or the start script skipped `pnpm build`.
  void stat(path.join(DIST, 'index.html')).catch(() => {
    console.warn('dist/index.html not found: the client is not built (run "pnpm build")');
  });
});
