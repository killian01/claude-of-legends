<div align="center">

# Claude of Legends

**A 5v5 MOBA born in a 48 hour vibe coding sprint: three lanes, ten champions, free in your browser right now.**

**Play now: https://claudeoflegends.com/**

[![CI](https://github.com/killian01/claude-of-legends/actions/workflows/ci.yml/badge.svg)](https://github.com/killian01/claude-of-legends/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-renderer-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-client-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-suite-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Play now](https://claudeoflegends.com/) · [Quick start](#quick-start) · [How to play](#how-to-play) · [Train a bot](#every-bot-is-a-policy-train-one) · [Contributing](CONTRIBUTING.md)

**Want to build something here?** The eleventh champion is one new file and
three table entries: [docs/adding-a-champion.md](docs/adding-a-champion.md).
A smarter bot is a playbook, no engine code at all. Small and self-contained:
[`good first issue`](../../labels/good%20first%20issue).

![Gameplay](docs/screenshots/gameplay.webp)

</div>

## What this is

A complete mini MOBA you can play right now: three lanes, ten champions with
full kits, jungle camps, a neutral objective, fog of war, items, skins, a
ladder, and an authoritative server for online play. No install. Online play
needs a free account; the practice match against bots does not. An account is
a name and a password, or one click on Continue with Discord: that button
creates an account from a Discord identity and signs it back in (ADR 0009).

The whole game was vibe coded with Claude in a 48 hour sprint, then polished
in the open; the commit history is the real build log, kept intact. It runs
on the architecture proven by
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

Open http://localhost:5173 and pick "Play offline now": a full 5v5 against
bots, no server needed.

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
- Or field a bot instead of playing by hand (`docs/design/bots.md`). In
  the Academy (the Bots tile on the home, or its bar) write its playbook by talking to the
  coach or editing the plays, spar it against house bots in seconds, then
  queue with it and coach it live: right-click sends it somewhere,
  right-click on an enemy focuses it, the coach bar carries Warden, back,
  group, hold and free. Deposit it in the Arena and read the Briefing in
  the morning. Three ladders rank the three ways to play: by hand, your
  bot live, your bot in the Arena.

## Every bot is a Policy: train one

Every non-human participant is a deterministic function
`(observation, rng) -> action` behind one versioned contract
(`src/sim/policy.ts`, ADR 0002). The observation is team vision, never
global state, and the decision budget that rate-limits actions applies
identically to humans and bots (ADR 0003): a bot cannot out-click a person,
only out-think one.

That makes the game a reinforcement learning environment as much as a MOBA:

- `pnpm env` runs a full match headless over NDJSON on stdio, one step per
  decision slot, so a trainer outside the repo can drive any seat
  (`headless/README.md`).
- Every house bot, the Laner and the three styles beside it, is a playbook
  (`src/sim/content/playbooks/`, ADR 0013): an ordered list of
  plays run by the interpreter in `src/sim/playbook/`, the same one every
  account's bot runs. A new trigger or behavior there is a contribution
  every bot on the server can use the next morning; a smarter default
  playbook is a self-contained, well-tested pull request.
- A parity test pins that a policy attached in-sim and driven remotely
  produces the identical world.

Community bots, scripted or trained, are the flagship contribution this
project is built around. The other one is a champion, and it needs no art
and no engine work to land: [docs/adding-a-champion.md](docs/adding-a-champion.md)
walks the whole path.

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

On a public host the game runs behind a proxy that owns TLS and the
public ports. `docker-compose.yml` at the repo root is that deployment:
the container publishes no port, and the front proxy reaches it over a
shared Docker network.

```
docker compose up -d --build
```

The full runbook (the proxy contract, verification, updates, backups,
sizing) is `docs/deploy.md`.

`PORT` overrides the listen port, for the server and for the dev client's
proxy alike, so two checkouts run side by side with one line in each
`.env`. Player identities and the match log
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
limit counts and what `X-Forwarded-Host` is read from. The proxy must
overwrite `X-Forwarded-For` and `X-Real-IP` rather than append to what
the client sent, or a player can pick their own bucket. Leave the count
at 0 when the port faces the internet directly, or a forged header buys
an attacker any address it likes.

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

Contributions are welcome: [CONTRIBUTING.md](CONTRIBUTING.md) has the
setup and the pull request checklist. Issues labeled
[`good first issue`](../../labels/good%20first%20issue) are the best entry
points. Security issues go through [SECURITY.md](SECURITY.md), privately,
never a public issue.

All project content, in the game and in the docs, is in English, with
original fantasy naming only (no borrowed IP, see
`docs/adr/0004-original-naming-no-borrowed-ip.md`).

License: MIT for the code (`LICENSE`). Art and model assets are covered by
`CREDITS.md` (CC0 packs by KayKit and Quaternius, plus the three.js basis
transcoder).
