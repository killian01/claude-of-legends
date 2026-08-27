# Out-of-game review: everything around the match

Status: findings from a full sweep of the client meta surface and the
server/product/ops surface (August 2026). The in-match game is complete;
almost every gap below sits around it. Items marked FIXED were addressed in
the change that landed this document.

## The number one hole: shipping (plan phase 9, not started)

- No Dockerfile, no compose file, although the game definition specifies a
  single Docker image on the maintainer's Hetzner machine.
- No CI at all (no .github directory). The qa-stop hook comments assume a CI
  that does not exist.
- `pnpm server` builds the server but never builds the client, so it serves
  a stale or missing `dist/` without any error.
- The server URL is same-origin only (`src/main.ts`); a split client/CDN
  deployment is impossible without a code change. No env config beyond
  `PORT`; `.gitignore` whitelists a `.env.example` that does not exist.
- Nothing terminates TLS; the client already picks `wss` under https.
- README.md still says "Status: day 0. Design in progress" and contains no
  setup, run, or how-to-play instructions. The only written record of the
  two-terminal online workflow is a runtime error string.

## Player lifecycle around the match

- FIXED: a disconnected player's champion now falls to the default bot
  policy instead of standing inert, the scoreboard row gains a bot tag, and
  teammates get a `player_left` notice in chat
  (`server/match.ts handleDisconnect`, `tests/match_flow.test.ts`).
- FIXED: server `error` messages (bad lobby code, closed lobby) now tear
  down the current menu and surface in a notice instead of `console.warn`
  (`src/main.ts`).
- No reconnection to a running match: no session token, client ids are
  per-connection integers, a reload strands the seat. Deferred in the
  roadmap; still the biggest lifecycle gap.
- FIXED (meta-game review batch 1): every exit is an in-app transition
  now, with "Play again" on the end screen; `window.location.reload()`
  is gone from the client.

## Settings: none exist

No options screen anywhere. SFX, music, and announcer volumes are module
constants (the announcer cannot be muted at all), pixel ratio and shadow
quality are hardcoded, and the QWER/DF keymap has no remap path. The Escape
menu has only Resume and Leave.

## Fairness and abuse, server side

- FIXED: chat and pings are now team-scoped through
  `Match.teamRecipients`; they previously broadcast to both teams, so an
  enemy ping leaked a map coordinate in an otherwise fog-scoped protocol.
- FIXED: process-level guards. `uncaughtException` and `unhandledRejection`
  are logged instead of killing every live match; SIGINT/SIGTERM close the
  sockets and the server cleanly.
- Lobby codes are a deterministic transform of an incrementing counter:
  predictable, enumerable, no TTL, no collision check, no join-guess
  lockout beyond the global message rate limit.
- One socket can queue and `start_now` repeatedly; nothing caps concurrent
  matches or connections per IP, so spawning N full 20 Hz sims is cheap.
- No WebSocket origin check. Dropped (oversized or rate-limited) messages
  are silently discarded with no log, so abuse is invisible.
- `ws.send` has no backpressure check; a slow client grows server memory.

## Ops and observability

Four console.log calls total. `/healthz` returns a static string with no
match count, player count, or tick-lag. No structured logging, no metrics,
no crash reporting, no restart supervision. The e2e scripts
(`scripts/e2e_online.mjs`, `scripts/smoke_browser.mjs`) are not wired into
package.json, hardcode a Windows Chrome path, and cover only the
queue-plus-bot-fill path.

## Stale or inaccurate docs

- README.md: see above; the worst offender.
- `docs/roadmap.md` lists offline practice as deferred; it shipped.
- `CLAUDE.md` describes `src/net/` as "auth + WebSocket mirror world";
  there is no auth.
- `CONTEXT.md` stops at the sim boundary: Queue, Lobby, Match, Snapshot,
  Guest, Session are load-bearing server types with no glossary entry.
- `tsconfig.json` includes a `headless/` directory that does not exist.

## Accepted v1 scope, worth naming

Guests only with zero persistence (no accounts, history, or profiles),
no spectators, no replays (frustrating: the deterministic sim makes
seed-plus-command replay nearly free), FIFO matchmaking with no skill
signal, no cosmetics economy (skins are free picks, server range-clamps
only), no touch or mobile support, and "Practice vs dummies" actually
launches a full bot 5v5 rather than a practice range.

## Suggested order of attack

1. DONE in this change: team-scoped social layer, bot substitution on
   disconnect, surfaced server errors, process guards.
2. Ship it: Dockerfile, a build that produces client plus server, a real
   README with run and play instructions.
3. Player comfort: reconnection by session token, a minimal options panel
   (volume and mute first), rematch without a page reload.
4. Hardening: random lobby codes with TTL, per-IP caps, structured logs
   and a useful healthz, cross-platform e2e wired into CI.
