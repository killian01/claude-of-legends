---
name: academy
description: Test the Academy, the bot builder where an account writes a bot's playbook, spars it, and asks the coach (ADR 0013). Use when a change touches src/sim/playbook, src/sim/content/playbooks, src/ui/academy.ts, server/bots.ts, server/bot_store.ts, server/playbook_suggest.ts, the Arena, or the night coach, or when asked to try the bot builder locally.
---

# Testing the Academy locally

The Academy is the screen where an account builds a bot: a name, one champion, two sigils,
a playbook of ordered plays, then local sparring, the live queue, and the Arena
(`docs/design/bots.md`, `docs/plan-bots.md`, terms in `CONTEXT.md`). Pick the cheapest
loop that exercises the change; the three below go from seconds to minutes.

## 1. The tests (no server, no browser)

Run under Node 22 (`. .claude/skills/dev-server/node_env.sh` first). One file at a time
while iterating:

| Change touches | Run |
|---|---|
| The playbook language, validator, interpreter | `tests/playbook.test.ts`, `tests/playbook_trace.test.ts`, `tests/bots.test.ts`, `tests/bots_v2.test.ts` |
| Patch operations the coach applies | `tests/playbook_patch.test.ts` |
| The coach conversation (streamed Messages API, refusals, quota) | `tests/playbook_suggest.test.ts` |
| Local sparring and its replay | `tests/sparring.test.ts` |
| Bots on the account, the store, the API, the kept chat | `tests/bots_api.test.ts`, `tests/bot_chats.test.ts`, `tests/bot_records.test.ts`, `tests/bot_page.test.ts` |
| Bots in the live queue, coach orders | `tests/bot_seats.test.ts`, `tests/coach_orders.test.ts`, `tests/coach_bar.test.ts` |
| The Arena, the night coach, the ladders | `tests/arena.test.ts`, `tests/night_coach.test.ts`, `tests/bot_way_stats.test.ts` |

The coach is never called for real in tests: `tests/playbook_suggest.test.ts` injects a
fake streaming Messages API through `CoachDeps.fetchFn`. Copy that stub when a new test
needs a canned model answer.

Any sim or server behavior change adds or updates a test in the same change
(`CLAUDE.md`). The playbook Laner and the default bot are data under
`src/sim/content/playbooks/`; a change there must keep determinism and env parity green.

## 2. The API from the shell

Bring the stack up (`/dev-server`), register an account with a cookie jar, then:

```bash
J=.dev/cj; B=http://127.0.0.1:${CLIENT_PORT:-5173}
curl -s -b $J $B/api/bots                                      # {"ok":true,"bots":[]}
curl -s -b $J -H 'content-type: application/json' \
  -d '{"name":"Nightfall","championId":"torv"}' $B/api/bots/create   # the default playbook comes back
curl -s -b $J -H 'content-type: application/json' -d '{"id":"<bot id>","text":"be aggressive"}' $B/api/bots/suggest
```

Facts that bite:

- A bot plays a champion **in the account's collection**. A fresh account holds the four
  starters (`torv`, `fenn`, `ashvyn`, `sylra`); any other id answers
  `a bot plays a champion in your collection`.
- Every route needs the session cookie; without it the answer is `This needs an account.`
- Without `ANTHROPIC_API_KEY` the coach answers
  `the coach is not configured on this server yet`. That is the honest answer, not a bug.
  Set the key in `.env` (never commit it), optionally `BOT_COACH_MODEL`, restart the
  server, and the answer streams as NDJSON. There is no mock coach on the server; the
  keyless path is the test stub above.
- The other routes are `save`, `delete`, `deposit`, `versions`, `version`,
  `record/add`, `record/list`, `page`, `challenge`; see the `/api/bots` block in
  `server/main.ts` and the outcomes in `server/bots.ts`.

## 3. In the browser

With the stack up, open the client, create an account, and take the Academy card on the
home screen. What each piece needs:

- **The play list editor** and **versions**: only the server. Reorder, edit parameters,
  disable, revert; each apply is a version.
- **Local sparring**: nothing beyond the browser. It steps the offline sim without the
  renderer at full speed against house bots (`src/game/sparring_core.ts`), then opens the
  replay with the active-play overlay. This is the fastest way to see a playbook behave.
- **The test drive**: the bot in the offline practice match.
- **The coach**: the key, as above.
- **The live queue with a bot** and **the Arena**: the server, plus for the Arena a
  deposited bot (the toggle, at most three) and either the hourly round or "play now".

The scripted click-through is `scripts/e2e_academy.mjs` (a fresh account creates a bot,
spars it, asks the coach one thing, opens the replay); run it as in `/browser-e2e`.
Its coach step expects an answer, so run it with a key or read its output knowing that
step will be the not-configured one.

## What the sim owes the Academy

The interpreter runs the same playbook in the browser (sparring), on the server (live
queue, Arena) and headless. If a change makes those disagree, `tests/determinism.test.ts`,
`tests/world_api_parity.test.ts` and `tests/remote_policy.test.ts` are where it shows
first; run them before the Academy tests.
