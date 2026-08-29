# Deploying

One machine, two containers: the game process (the built client and the
authoritative server in one image, one port) and Caddy in front of it for TLS
and the public ports. Everything below assumes a fresh Linux box with Docker
and the compose plugin installed.

## What you need

- A machine with Docker. The sizing section says how small it can be.
- A domain, with an A record (and AAAA if the box has IPv6) pointing at it.
  Certificates are issued over HTTP, so the name has to resolve before the
  first boot.
- Ports 80 and 443 open, TCP and UDP. Port 80 is not optional: it is how the
  certificate is issued and renewed. 443/UDP is HTTP/3, which the game does
  not require but does benefit from.
- Nothing else. There is no database, no accounts, no external service.

## First deploy

```
git clone <repo> && cd claude-of-legends
cp .env.example .env        # fill in DOMAIN and ACME_EMAIL
docker compose up -d --build
docker compose logs -f caddy   # watch the certificate get issued
```

The image builds the client and bundles the server, so the box needs no
Node, no pnpm and no toolchain of its own.

## Verify

```
curl https://<domain>/healthz          # {"ok":true,...}
docker compose ps                      # game should be "healthy"
```

Then the real check, from a machine with Chrome, which drives the whole flow
(home menu, queue, champion select, lock, a live match) and fails loudly on
any console error:

```
node scripts/e2e_online.mjs https://<domain>/ smoke.png
```

The server prints what it believes about its edge on startup, and it should
read `1 trusted proxy hop(s)`:

```
docker compose logs game | head -3
```

If it says 0, `TRUST_PROXY` did not reach the container and every player
counts as one machine: the ninth connection to the whole server gets
refused.

## Updating

```
git pull
docker compose up -d --build
```

The game container is replaced, which ends every live match. There is no
drain and no rolling restart: deploy when nobody is playing, or accept that
players are dropped back to the home screen. `data/` survives in its volume,
so identities, the match log and the ladder do not reset.

## Backups

Everything that outlives a container is in the `game-data` volume:
`players.json` (identities and ratings), `matches.jsonl` (the match log that
feeds profiles and the ladder) and `replays/` (the last 40 matches).

```
docker run --rm -v claude-of-legends_game-data:/data -v "$PWD:/out" \
  alpine tar czf /out/game-data-$(date +%F).tgz -C /data .
```

Restoring is the same command with `tar xzf`, into a stopped stack.

## Sizing, measured

One match-tick costs 0.34 ms on a laptop core: the sim step plus ten
team-scoped snapshots, built and serialized, which is what the server
actually does 20 times a second per match. Measured with ten concurrent
bot matches over a minute of game time each.

That puts the process at about 17 ms of CPU per tick at the 50-match cap
(`MAX_MATCHES` in `server/main.ts`), a third of one core. Two cores is
plenty; the cap is the honest limit, not the CPU.

Bandwidth is the real constraint. A player receives about 2.3 KB per tick,
so 45 KB/s each. A full house of 50 matches is 500 players, which is roughly
180 Mbit/s sustained and 80 GB per hour downstream. Check the traffic
allowance on the plan before advertising the server, and remember that each
new player also pulls the client once: 24 MB cold, then cached.

Memory: one Sim plus its snapshot state per match, and the whole match log
stays in memory for profile queries. Guests-scale, kilobytes per match.

## Troubleshooting

**The certificate never arrives.** Caddy needs port 80 reachable from the
internet and the DNS record already pointing here. `docker compose logs
caddy` names the ACME failure. A firewall that only opens 443 is the usual
cause.

**Players are refused with "too many connections".** `TRUST_PROXY` is not
reaching the game container, so all sockets look like Caddy's address. Check
the startup line described in Verify.

**A browser cannot open a socket but curl can.** The origin check refused
the upgrade; the server logs `refused upgrade from origin ...`. The page was
served from a name the request no longer carries, which is what a proxy that
rewrites `Host` does. `TRUST_PROXY=1` is the fix: it lets the server read the
public name back out of `X-Forwarded-Host`. Caddy preserves `Host` anyway, so
this bites when something else has been put in front of it. Naming the origin
in `ALLOWED_ORIGINS` also works.

**Everything is slow at the same moment for everyone.** One event loop runs
every match, so a single expensive tick is felt by all of them. Check
`/healthz` for the match count first.
