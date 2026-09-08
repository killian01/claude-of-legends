---
name: dev-server
description: Start, inspect, and stop the local game server and Vite client for a task, with a task-local state directory, the right Node, and the log-only mail links. Use when a change has to be seen running (online play, sign-in, the Academy, the Forge, anything under /api or /ws), before a browser e2e script, or when "the server is not running" shows up in the client console.
---

# The local stack

Everything is driven by one script; do not hand-roll `pnpm server` in the background.

```bash
.claude/skills/dev-server/stack.sh up        # build the server, start it and the client, wait until both answer
.claude/skills/dev-server/stack.sh status    # pids, ports, state directory, log paths
.claude/skills/dev-server/stack.sh log 60    # tail of the server log
.claude/skills/dev-server/stack.sh links     # confirmation and reset links the log-only mailer printed
.claude/skills/dev-server/stack.sh down      # stop both; always run this before finishing the task
```

What `up` gives you, and why it is shaped that way:

- **Node 22** is selected for you (`node_env.sh`, driven by `.nvmrc`). The login shell on
  some machines resolves to Node 18, where the server's `node:sqlite` stores and Vitest 4
  both fail. Every command in this repo wants that helper sourced first:
  `. .claude/skills/dev-server/node_env.sh`.
- **State is task-local.** `DATA_DIR` defaults to `.dev/data` (gitignored), so accounts,
  bots, and match records made while testing never land in the maintainer's `data/`.
  Set `DATA_DIR=data` on purpose when a task needs the ordinary local state.
- **Ports** come from `.env` (`PORT`) or default to server `8787` and client `5173`. A
  second checkout on the machine will be holding those: the script refuses to start over
  a port that already answers, so pass `PORT=8788 CLIENT_PORT=5174` and go on.
- **The client proxies** `/api` and `/ws` to the server, so the browser talks to
  `http://localhost:<CLIENT_PORT>` only. Without the server, `pnpm dev` alone still runs
  the offline practice match and answers the four sign-in calls with "no session".
- **Mail is log-only** without `MAIL_API_KEY`: the boot line says so, and every
  confirmation or reset mail is printed under a `[mail:log-only]` line. `links` pulls the
  URLs out. Registration does not wait on confirmation; an account is usable at once.
- **Optional surfaces say so.** The boot lines `suggestions:`, `generation:`, `discord:`
  each report on or off. Set the key in `.env` (never commit it) and restart to turn one
  on; `GENERATION_PROVIDER=mock` is the keyless Forge pipeline for development.

## Poking the API from the shell

Sessions are cookies (ADR 0006), so keep a cookie jar. Registration needs a name, a
password, and an email address; the address is never mailed locally.

```bash
J=.dev/cj; B=http://127.0.0.1:${CLIENT_PORT:-5173}
curl -s -c $J -H 'content-type: application/json' \
  -d '{"name":"tester","password":"correct horse battery","email":"tester@example.com"}' $B/api/register
curl -s -b $J $B/api/session
```

A new account owns the four starter champions only (`STARTER_COLLECTION` in
`server/laurels.ts`), which bounds what a bot or a ranked pick may use.

## When it misbehaves

- `up` prints the boot lines; a crash before readiness prints the log tail. Read it
  before changing anything.
- `dist/index.html not found` in the server log is expected in development: the Vite
  client serves the page, the server serves `dist/` only after `pnpm build`.
- The SQLite `ExperimentalWarning` on boot is noise from `node:sqlite`, not a fault.
- Rebuild after a server change: `down` then `up` (the server is a bundled file,
  `dist-server/server.cjs`, not watched). The client hot-reloads on its own.
