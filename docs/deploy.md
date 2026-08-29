# Deploying

One image, one process, one port. The game container publishes no port of its
own: the only way in is the Caddy instance of the km01 stack, reached over the
shared `km01_edge` Docker network. That is what makes `TRUST_PROXY=1` safe to
set here, and it keeps this public, account-less server off the network where
the database and the job queue live.

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
- Nothing else. No database, no accounts, no external service.

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
are dropped back to the home screen. The data volume survives, so identities,
the match log and the ladder do not reset.

## Backups

Everything that outlives a container is in the `claude-of-legends_game_data`
volume: `players.json` (identities and ratings), `matches.jsonl` (the match log
that feeds profiles and the ladder) and `replays/` (the last 40 matches).

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
