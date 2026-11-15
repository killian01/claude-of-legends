---
name: browser-e2e
description: Run the puppeteer click-throughs under scripts/e2e_*.mjs and the browser smoke check against the local stack, with screenshots. Use when a change is visual or crosses the client and server (sign-in, lobby, the Academy, the Forge, replay, spectate), or when the PR needs before and after screenshots.
---

# Browser end-to-end scripts

The scripts under `scripts/` that drive a real browser are not part of `pnpm test`. They
need the stack up (`/dev-server`) on the default ports, a Chrome binary, and Node 22.

```bash
. .claude/skills/dev-server/node_env.sh
.claude/skills/dev-server/stack.sh up
CHROME=$(command -v google-chrome || command -v chromium || command -v chromium-browser) \
  SHOT_DIR=.dev/shots node scripts/e2e_academy.mjs
.claude/skills/dev-server/stack.sh down
```

- `CHROME` defaults to the usual Windows install path; on Linux and macOS it must be set.
- The scripts talk to `http://localhost:5173` and expect the server on the port the client
  proxies to. With a non-default `CLIENT_PORT` they will not find the page.
- `SHOT_DIR`, where a script honours it (`e2e_academy`, `e2e_ladder`, `e2e_wave`, `e2e_landing`), receives PNGs at each step; the scripts print
  page errors and console messages and exit non-zero on a failed check.
- Each script registers a fresh account with a generated name (`scripts/e2e_signin.mjs`),
  so the task-local `DATA_DIR` keeps them out of the ordinary state; a Guest step uses a
  fresh browser context, whose landing hands it a Guest (ADR 0033).

| Script | What it walks |
|---|---|
| `e2e_signin.mjs` | The shared sign-in helpers every script imports; not a script of its own |
| `e2e_academy.mjs`, `e2e_wave.mjs` | The Academy: create a bot, spar, ask the coach, open the replay; the editor's newer triggers and behaviors |
| `e2e_online.mjs`, `e2e_lobby.mjs`, `e2e_party.mjs`, `e2e_ranked.mjs` | Queues, lobbies, parties, ranked |
| `e2e_replay.mjs`, `e2e_spectate.mjs` | The replay player (needs `scripts/seed_replay.mjs` first) and spectating |
| `e2e_forge.mjs`, `e2e_workshop.mjs`, `e2e_test_drive.mjs` | The Forge, its workshop and the test drive (use `GENERATION_PROVIDER=mock` in `.env`) |
| `e2e_profile.mjs`, `e2e_ladder.mjs`, `e2e_lifecycle.mjs` | Profile, ladders, the no-reload match lifecycle |
| `e2e_landing.mjs` | The landing's own panel at 1280x720, 844x390 and 390x844 (touch): the name and the gold button in the first screen, the rename in place, Keep it on every device. `FIXTURE=1` answers the landing and the rename from the page and needs the Vite client alone (`PRESENCE=1` adds the presence line); without it, the real stack seeded with `node scripts/seed_home.mjs` (a fresh Guest, and the seeded Thornwick through `loc_guest=seed-home-guest`) |
| `smoke_browser.mjs [url] [shot.png]` | Load one page, report console errors, save a screenshot |

`e2e_lobby.mjs` and `e2e_party.mjs` sign both people in. A Guest in a private lobby
(ADR 0036) is walked by hand: open the host's invite link in a fresh browser context for the
invitation card, and press Join the lobby. Nothing ends a 5v5 fast enough for a script to reach
Back to the lobby; with everyone walked out of the match, the lobby opens again on its old link
once the rejoin grace, a minute, has passed.

## Reading a failed run

- The scripts were written against a playtest and check exact labels and layouts. When
  one fails on a label or a count, read the check against the current client before
  blaming the change: it may be the script that drifted. Fix the check in the same
  change, with a comment saying what the client now does.
- Some checks are budgets, not facts: the replay seek in `e2e_academy.mjs` must land
  within 1.5 s. Under software GL on a loaded machine (load average above the core
  count) that fails without anything being wrong. Rerun on a quiet machine before
  treating it as a regression.
- The coach step of `e2e_academy.mjs` needs `ANTHROPIC_API_KEY`; without it the script
  ends at `the coach did not answer: the coach is not configured on this server yet`,
  and everything before that step has passed.
- The pre-sign-in `401` on `/api/session` is expected and printed as a console error.
- A refusal that says "from this connection" is one of the limits on private lobbies, which
  every browser of a local stack shares (`docs/dev-local.md`, Browser scripts): restart the
  stack rather than the script.

## Screenshots for a PR

A visual change ships before and after screenshots under `docs/screenshots`, referenced
from the PR body (`CLAUDE.md`, `CONTRIBUTING.md`). Take the "before" on `main` (a
worktree with its own `PORT` and `CLIENT_PORT` works) and the "after" on the branch, at
the same viewport, and commit only the stills the PR shows: `docs/screenshots/frame-*.jpg`
are ignored on purpose. A match drawn on SwiftShader is far below any screen's rate, and
the quality ladder (`src/game/quality_ladder.ts`) steps it down within its first minute:
open the page with `?quality=full` for a still of a match at its best.
