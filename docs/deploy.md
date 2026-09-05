# Deploying

One image, one process, one port. The game container publishes no port of its
own: the only way in is the Caddy instance of the km01 stack, reached over the
shared `km01_edge` Docker network. That is what makes `TRUST_PROXY=1` safe to
set here, and it keeps this public game server off the network where the
database and the job queue live.

`docker-compose.yml` at the repo root is the whole deployment. There is no
Caddy in it: the proxy belongs to the km01 stack, which owns `km01_edge` and
has to be up first on a fresh box.

## What you need

- A machine with Docker and the compose plugin. The sizing section says how
  small it can be.
- The km01 stack running, so `km01_edge` exists and its Caddy is listening on
  80 and 443. The game vhost lives at the bottom of that stack's `Caddyfile`.
- A domain whose A record points at the box. Caddy issues and renews the
  certificate; the game process never sees TLS.
- No database: accounts, sessions, pending links and the match log are JSON
  files under `DATA_DIR` (ADR 0006).
- One external service: a transactional mail provider, called outbound over
  HTTPS to send confirmation and reset links (ADR 0007). It is optional to
  run and required to be useful, see below.
- Optionally a second, a Discord application, for the Continue with Discord
  button (ADR 0009). Nothing needs it: unconfigured, the button never
  appears and the rest of the game is unchanged.

## Mail

The game sends exactly two mails: confirm this address, and reset this
password. Both are outbound HTTPS calls to Resend, so the container still
publishes no port and still sits off the km01 network. Nothing ever arrives
by mail; there is no inbox to run.

Set both of these in a `.env` file beside `docker-compose.yml`. That file is
gitignored, and `MAIL_API_KEY` is a credential: it must never be committed.
`.env.example` is the template.

```
MAIL_API_KEY=re_...
MAIL_FROM=Claude of Legends <no-reply@claudeoflegends.com>
```

`MAIL_FROM` must be at a domain verified with the provider, which means
adding the DNS records they give you on `claudeoflegends.com`. Mail from an
unverified domain is accepted by the API and then not delivered, which looks
like success in the log and like silence to the player.

`PUBLIC_URL` is what the links point at. It is set in the compose file
because it is not a secret, and it must be the public name: a link built
from the container's own address reaches nobody.

**With neither variable set the server does not send mail. It writes the
links to its own log and says so on the boot line:**

```
docker compose logs game | grep '^mail:'
mail: resend, from Claude of Legends <no-reply@claudeoflegends.com>, links point at https://claudeoflegends.com
```

If that line says `log only`, mail is not configured, nobody can confirm an
address or reset a password, and the log now contains bearer credentials.
That is the intended behaviour for a developer and a misconfiguration in
production.

Delivery is best effort by design. A dead relay never fails a registration:
the account is created and usable, and the player simply has no link yet.

## Discord sign-in

Optional, and off unless configured (ADR 0009). The entry screen offers one
button, Continue with Discord: it creates an account from the Discord
identity that comes back (no name, password or email typed), and afterwards
the same button signs that account back in. A name-and-password account can
never be opened through Discord, and nothing stored is ever shown to another
player.

Make one application at `https://discord.com/developers/applications`, and
under OAuth2 add a redirect that is exactly the public origin plus
`/api/discord/callback`:

```
https://claudeoflegends.com/api/discord/callback
```

Discord matches that string byte for byte, so a trailing slash or the wrong
host is a refused exchange and nothing else. Then set both of these in the
same `.env` file as the mail keys, where `DISCORD_CLIENT_SECRET` is a
credential and must never be committed:

```
DISCORD_CLIENT_ID=1234567890
DISCORD_CLIENT_SECRET=...
```

The scope requested is `identify` and nothing else. The access token is used
for one call and then dropped: the account stores the Discord id, the name
that came back, and when. `DISCORD_REDIRECT_URI` overrides the callback for a
deployment whose public origin is not `PUBLIC_URL`; it is not normally set.

Optionally, a new account can be put into your Discord server on the way in,
with no invite to click (ADR 0009). Two more variables turn it on:

```
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=1545843596320575559
```

The token comes from the Bot tab of the same application, and that bot has to
already be a member of the server with the Create Invite permission and
nothing else it does not need: add it through OAuth2 > URL Generator with the
`bot` scope, open the URL it builds, pick the server. The guild id is not a
secret: turn on Developer Mode in Discord, right click the server, Copy Server
ID.

Weigh it before turning it on. The consent screen then reads "Join servers for
you" alongside the username, at the moment somebody is deciding whether to
sign up at all. Unset, the flow is exactly the identify-only one above and the
client offers a plain invite link instead. Either way a join that fails never
costs anybody their account, and an existing member is a no-op.

**With neither variable set the routes answer "not configured", the client
never offers the button, and the boot line says so:**

```
docker compose logs game | grep '^discord:'
discord: sign-in on, redirect https://claudeoflegends.com/api/discord/callback, auto-join into guild 1545843596320575559
```

The tail of that line is the auto-join: the guild it will add new accounts to,
or `no auto-join` when the two variables are not both set.

If that line says `off`, Discord sign-in is not configured. Nothing else is
affected: accounts are created, rated and played exactly as before.

## The proxy contract

Caddy overwrites both forwarding headers rather than appending to what the
client sent, or a player could pick their own bucket and walk around the
socket cap:

```
reverse_proxy claude_of_legends:8787 {
    header_up X-Forwarded-For {http.request.header.Cf-Connecting-Ip}
    header_up X-Real-IP {remote_host}
}
```

`server/edge.ts` reads them on that statement, in that order: behind a
proxying CDN the chain names the player, and with DNS-only records that header
is absent and `X-Real-IP` (the peer Caddy saw) is the right answer. Changing
either `header_up` line means rereading `server/edge.ts` first.

## First deploy

```
git clone <repo> /opt/claude-of-legends && cd /opt/claude-of-legends
docker compose up -d --build
docker compose logs -f game
```

The image builds the client and bundles the server, so the box needs no Node,
no pnpm and no toolchain of its own.

## Verify

```
docker compose ps                      # game should be "healthy"
curl https://<domain>/healthz          # {"ok":true,...}
```

The server prints what it believes about its edge on startup, and it should
read `1 trusted proxy hop(s)`:

```
docker compose logs game | head -3
```

If it says 0, `TRUST_PROXY` did not reach the container and every player
counts as one machine: once the whole server holds `MAX_CONN_PER_IP` sockets
the next player is refused.

Then the real check, from a machine with Chrome, which drives the whole flow
(home menu, queue, champion select, lock, a live match) and fails loudly on
any console error:

```
node scripts/e2e_online.mjs https://<domain>/ smoke.png
```

## Updating

```
git pull
docker compose up -d --build
```

The game container is replaced, which ends every live match. There is no drain
and no rolling restart: deploy when nobody is playing, or accept that players
are dropped back to the home screen. The data volume survives, so accounts,
sessions, the match log and the ladder do not reset.

### Deploying the accounts change, once

ADR 0006 replaced the token-keyed identity with real accounts and does not
migrate what came before: `playerId` became `accountId` inside the persisted
match record, so the old files are not readable by the new server and the
ladder restarts. This is a deploy step rather than a commit. With the stack
stopped, archive them and let the server create its own:

```
docker run --rm -v claude-of-legends_game_data:/data alpine sh -c \
  'mkdir -p /data/pre-accounts && mv /data/players.json /data/matches.jsonl /data/pre-accounts/ 2>/dev/null; true'
```

Take a backup first (below). Nothing is deleted, so the old files stay
readable if a number is ever needed from them.

## Backups

Everything that outlives a container is in the `claude-of-legends_game_data`
volume: `accounts.json` (accounts, credentials, email addresses and ratings),
`sessions.json` (open sign-ins), `tokens.json` (confirmation and reset links
still outstanding), `matches.jsonl` (the match log that feeds profiles and the
ladder), `replays/` (the last 40 matches, Arena matches included),
`forge.sqlite3` (the Forge, ADR 0011) and `bots.sqlite3` (the accounts' bots,
their playbook versions, their live and Arena ratings, the Arena reports and
the night coach's proposals, ADR 0013).

The Arena plays its matches in a worker thread bundled beside the server
(`dist-server/arena_worker.cjs`, built by `pnpm build:server`); a server
started without that file says so at boot and runs Arena matches inline,
blocking the live loop for about ten seconds each, which is fine on a dev
machine and wrong in production.

`accounts.json` holds password hashes and email addresses. The hashes are
scrypt with a per-account salt, not plaintext, but a backup of it is still a
credential file AND a list of people's addresses: keep it where you would keep
one. `tokens.json` is shorter lived and worse: every entry in it is a live way
into an account until it expires.

```
docker run --rm -v claude-of-legends_game_data:/data -v "$PWD:/out" \
  alpine tar czf /out/game-data-$(date +%F).tgz -C /data .
```

Restoring is the same command with `tar xzf`, into a stopped stack.

## Sizing, measured

One match-tick costs 0.34 ms on a laptop core: the sim step plus ten
team-scoped snapshots, built and serialized, which is what the server actually
does 20 times a second per match. Measured with ten concurrent bot matches
over a minute of game time each.

That puts the process at about 17 ms of CPU per tick at the 50-match cap
(`MAX_MATCHES` in `server/main.ts`), a third of one core. Two cores is plenty;
the cap is the honest limit, not the CPU.

Bandwidth is the real constraint. A player receives about 2.3 KB per tick, so
45 KB/s each. A full house of 50 matches is 500 players, which is roughly
180 Mbit/s sustained and 80 GB per hour downstream. Check the traffic
allowance on the plan before advertising the server, and remember that each
new player also pulls the client once: 24 MB cold, then cached.

Memory: one Sim plus its snapshot state per match, and the whole match log
stays in memory for profile queries. Kilobytes per match.

## Troubleshooting

**`network km01_edge declared as external, but could not be found`.** The km01
stack is down or was never brought up on this box. It owns the network; start
it first.

**Players are refused with "too many connections".** `TRUST_PROXY` is not
reaching the game container, or Caddy stopped setting the forwarding headers,
so every socket looks like Caddy's address. Check the startup line described in
Verify, then the two `header_up` lines in the proxy contract above.

**A browser cannot open a socket but curl can.** The origin check refused the
upgrade; the server logs `refused upgrade from origin ...`. The page was served
from a name the request no longer carries, which is what a proxy that rewrites
`Host` does. Caddy preserves `Host`, and both public names are already in
`ALLOWED_ORIGINS`, so this bites only when something new has been put in front.

**The certificate never arrives.** Caddy needs port 80 reachable from the
internet and the DNS record already pointing here. That is the km01 stack's
log, not this one.

**Everything is slow at the same moment for everyone.** One event loop runs
every match, so a single expensive tick is felt by all of them. Check
`/healthz` for the match count first.
