# Local development

The runbook for a working copy: what runs where, what each surface needs, and how to
tell a healthy stack from a broken one. `CONTRIBUTING.md` covers the first clone;
`CLAUDE.md` holds the invariants; this page is the operational detail both point at.
The agent's versions of these procedures are the project skills under
`.claude/skills/` (`dev-server`, `academy`, `verify`, `browser-e2e`).

## The pieces

| Piece | Command | Needs | Serves |
|---|---|---|---|
| Client | `pnpm dev` | Node 22, pnpm | The page on `:5173`; proxies `/api` and `/ws` to the server. Alone, it runs the offline practice match and local sparring. |
| Server | `pnpm server` | Node 22 (`node:sqlite`) | Accounts, sessions, queues, the Academy, the Forge, the Arena on `:8787`. State under `data/`. |
| Environment | `pnpm env` | Node 22 | The headless match over NDJSON on stdio (`headless/README.md`). |
| Gates | `pnpm check`, `pnpm lint`, `pnpm test` | Node 22 | What CI runs. |

Node 22 is a requirement, not a preference: the server's stores are built on
`node:sqlite` (22.5 and up) and Vitest 4 does not start on 18. `nvm use` reads `.nvmrc`;
in a shell that has not loaded nvm, source `.claude/skills/dev-server/node_env.sh`.

## One script for the stack

`.claude/skills/dev-server/stack.sh up|status|log|links|down` builds and starts the
server and the client in the background, waits until both answer, and keeps pids and
logs under `.dev/` (gitignored). Its state directory defaults to `.dev/data`, so a
testing session never writes into `data/`; `DATA_DIR=data` opts back in. `PORT` and
`CLIENT_PORT` move it off the defaults when another checkout holds them.

The boot lines tell you what is configured:

```
suggestions: off (no ANTHROPIC_API_KEY set)
mail: log only (no MAIL_API_KEY set): links are printed, not sent, links point at http://localhost:8787
arena: worker thread
discord: off (no DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET set)
```

`dist/index.html not found` on boot is expected while the client is served by Vite.

## Accounts without mail

Registration takes a name, a password and an email address, and opens a session at once;
the confirmation link only claims the address. Without `MAIL_API_KEY` every mail is
printed in the server log under `[mail:log-only]`, so a developer follows the link from
there (`stack.sh links` extracts them). A new account holds the four starter champions
(`STARTER_COLLECTION` in `server/laurels.ts`); a bot or a ranked pick outside them is
refused with a plain message.

Sessions are cookies (ADR 0006). From the shell, keep a jar:

```bash
J=.dev/cj; B=http://127.0.0.1:5173
curl -s -c $J -H 'content-type: application/json' \
  -d '{"name":"tester","password":"correct horse battery","email":"tester@example.com"}' $B/api/register
curl -s -b $J $B/api/bots
```

## A server with people on it

A fresh state directory holds your one account and nothing else, so the home's panels,
the ladder page, the Arena pool and the gallery all show their empty states, which is the
wrong thing to look at while working on any of them. `scripts/seed_home.mjs` fills a
state directory with what a small server looks like after a few weeks: eight accounts
placed by hand with a match log behind them, six ranked bots with Arena play in their
Records, seven sealed forged champions with likes. Nothing goes through generation: the
champions are the roster's twins under new names with placeholder splashes, and every
row is written straight into the stores through their own classes. Run it with the server
down (the registry loads `accounts.json` at boot), against the directory the stack will
use; it defaults to the stack's `.dev/data` and never touches `data/` unless told to:

```bash
node scripts/seed_home.mjs                # into .dev/data
.claude/skills/dev-server/stack.sh up
```

Sign in with any seeded name and the password `seed-home-shots`:

| Account | What it shows |
|---|---|
| `Marrow` | Rank 1 by hand, the top Arena bot, one forged champion |
| `Halloway` | Still placing (2 of 3 rated matches), no bot, one forged champion |
| `Quillon`, `Ashvale`, `Tessaly`, `Bramble`, `Orrin`, `Vexley` | Placed lower, a bot or a champion each |

An account you register yourself shows the fresh career beside a full ladder. The seed
refuses to run twice into the same directory; delete it to start over. Once the server is
up the Arena runner plays the seeded bots on its own, so their numbers move.

## What each surface needs

| Surface | Without any `.env` | To turn on |
|---|---|---|
| Practice match, local sparring, the test drive | Works in the browser alone | nothing |
| Sign-in, queues, lobbies, parties, replays, ladders | The server | nothing |
| The Academy: bots, the play list editor, versions, deposit | The server | nothing |
| The Academy's coach, the Forge conversations, the night coach | Answers "not configured" | `ANTHROPIC_API_KEY` in `.env` (`BOT_COACH_MODEL`, `SUGGEST_MODEL` optional) |
| The Forge's generation | Finalize answers "not configured" | `GENERATION_PROVIDER=mock` for placeholders, or `TRIPO_API_KEY` |
| Mail | Links printed to the log | `MAIL_API_KEY` and `MAIL_FROM` |
| Continue with Discord | Button hidden | `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` |

Every knob is documented in `.env.example`. `.env` is gitignored and never committed.

## Testing the Academy

From cheapest to most complete:

1. **Vitest**, no server: the playbook language and interpreter (`tests/playbook*.test.ts`,
   `tests/bots*.test.ts`), sparring (`tests/sparring.test.ts`), the API and store
   (`tests/bots_api.test.ts`), the coach against a fake streaming Messages API
   (`tests/playbook_suggest.test.ts`), the Arena and the night (`tests/arena.test.ts`,
   `tests/night_coach.test.ts`).
2. **The API** with the stack up and a cookie jar, as above: `/api/bots`,
   `/api/bots/create`, `/api/bots/save`, `/api/bots/suggest` (NDJSON when a key is set).
3. **The browser**: the Academy card on the home screen; local sparring needs nothing
   else and shows the active-play overlay in the replay.
4. **The click-through**: `scripts/e2e_academy.mjs` with `CHROME` set to a Chrome binary.

## Browser scripts

`scripts/e2e_*.mjs` and `scripts/smoke_browser.mjs` drive headless Chrome with
puppeteer-core against the stack on the default ports. They are not part of `pnpm test`.
`CHROME` names the binary (the default is the Windows install path); `SHOT_DIR` collects
screenshots where a script supports it.

## Reading a red test run

The suite gives each test 60 seconds because the heaviest ones step whole matches; on a
loaded machine `tests/kit.test.ts` and the objectives and pacing tests can time out in a
full run and pass alone. Rerun the file by itself before treating it as a regression.
`does not provide an export named styleText` at startup means the wrong Node.
