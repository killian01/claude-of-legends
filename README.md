# Claude of Legends

A mini 5v5 MOBA that runs entirely in the browser: three lanes,
ten champions with full kits, jungle camps, a neutral objective, fog of war,
items, and an authoritative server for online play. No account, no install.
Built on the architecture proven by
[world-of-claudecraft](https://github.com/levy-street/world-of-claudecraft):
one deterministic TypeScript simulation core that runs identically in the
browser, on the server, and headless, with every non-human participant
driven by a single `Policy` abstraction.

![Home screen](docs/screenshots/home.png)

![In a match](docs/screenshots/match.png)

## Quick start

```
pnpm install
pnpm dev
```

Open http://localhost:5173 and pick "Practice vs dummies (offline)": a full
5v5 against bots, no server needed.

For online play, run the server in a second terminal:

```
pnpm server        # authoritative server on :8787
pnpm dev           # client; /ws is proxied to the server
```

Then "Play online" to queue (empty seats fill with bots on request), or
"Create private lobby" and share the 5-letter code with friends.

## How to play

- Right-click: move or attack. A: attack-move. S: stop and hold. B: recall.
- Q W E R: abilities, cast at the cursor (hold for the range preview).
  Level them with Alt+key or by clicking the plus.
- D F: sigils (picked in champion select). P: shop. Tab: scoreboard.
- Enter: chat. G: ping. Esc: menu. Space recenters; screen edges pan.
- Push a lane, take towers, and destroy the enemy Sanctum to win. The
  Warden in the river grants a team buff to whoever takes it down.

## Production

One process, one port: the server serves the built client and the
WebSocket. Locally:

```
pnpm start         # builds client + server, then runs on :8787
```

With Docker:

```
docker build -t claude-of-legends .
docker run -p 8787:8787 -v loc-data:/app/data claude-of-legends
```

On a public host, the compose stack adds Caddy in front for TLS and the
public ports, and declares the proxy to the server:

```
cp .env.example .env        # DOMAIN, ACME_EMAIL
docker compose up -d --build
```

The full runbook (DNS, verification, updates, backups, sizing) is
`docs/deploy.md`.

`PORT` overrides the listen port. Player identities and the match log
live as JSON files under `data/` (`DATA_DIR` overrides the location);
mount it as a volume or careers reset with the container.

TLS termination (for wss) belongs to whatever proxy sits in front, and
the proxy has to be declared, or the server counts every player as one
machine:

```
TRUST_PROXY=1      # how many proxies sit in front (0, the default: none)
ALLOWED_ORIGINS=   # pages allowed to open a socket besides the one we serve
```

`TRUST_PROXY` is a hop count, not a switch: with 1, the address the
nearest proxy saw is the player, which is what the per-machine socket
limit counts and what `X-Forwarded-Host` is read from. Leave it at 0
when the port faces the internet directly, or a forged header buys an
attacker any address it likes.

The client is served by this same process, so a page from the host in
the request is always allowed and `ALLOWED_ORIGINS` stays empty for a
normal deploy. Name origins in it (comma separated) only when the client
is also served from somewhere else; `*` turns the check off.

## Development

- `pnpm test` (Vitest, includes structural gates), `pnpm check` (strict
  tsc), `pnpm lint` (Biome).
- Repo map and invariants: `CLAUDE.md`. Domain glossary: `CONTEXT.md`.
  Decisions: `docs/adr/`. Design: `docs/design/`. Deferred work:
  `docs/roadmap.md` and `docs/review/`.
- Dev-only pages: `/dev_champions.html` (champion visual gallery, with
  `?portraits` and `?focus=<id>` modes) and `/vfx.html` (spell VFX).

All project content, in the game and in the docs, is in English, with
original fantasy naming only (no borrowed IP, see
`docs/adr/0004-original-naming-no-borrowed-ip.md`).

License: MIT for the code (`LICENSE`). Art and model assets are covered by
`CREDITS.md` (CC0 packs by KayKit and Quaternius, plus the three.js basis
transcoder).
