# Contributing to Claude of Legends

Thank you for being here. Claude of Legends is a small, focused MOBA built in the
open, and every contribution counts: a bug report from a playtest, a doc fix, a
balance observation, a new bot brain. You do not need to be an expert to help.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Play and report.** Play a match (offline needs no account), then open an
  [issue](../../issues/new/choose) for anything that feels broken or off. A clear
  bug report is a real contribution.
- **Code.** Fix a bug, improve a system, sharpen the renderer. Issues labeled
  `good first issue` and `help wanted` are the best places to start.
- **Bots.** Every non-human participant is a deterministic `Policy`
  (`src/sim/policy.ts`). Since ADR 0013 a bot is data: a playbook of plays
  run by `src/sim/playbook/`, and the house Laner is the default playbook
  (`src/sim/content/playbooks/laner.ts`). Two kinds of PR fit here: a
  better default playbook, and a new trigger or behavior in the language.
  A new kind lands in five places kept in step: the types, the validator
  (`src/sim/playbook/`), the words and forms (`src/ui/playbook_text.ts`),
  and the coach's grammar (`server/playbook_suggest.ts`), with a test.
  Trained bots join later through the headless environment
  (`headless/README.md`).
- **Content and balance.** Champions, items, and sigils are data-as-code under
  `src/sim/content/`. Balance changes are welcome when they come with the
  reasoning and pass the pacing tests.
- **Documentation.** The design docs in `docs/`, the ADRs, and this guide can
  always be improved.

## Getting set up

You need [Node.js](https://nodejs.org/) 22 or newer and **pnpm** (exact pin in
`package.json` `packageManager`, currently `pnpm@10.34.5`). 22 is not a
preference: the server's stores are built on `node:sqlite`, which arrived in
22.5, and CI and the production image both run 22.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/claude-of-legends.git
cd claude-of-legends

# 2. Install pnpm once (same command on macOS, Linux, Windows)
npm install -g pnpm@10.34.5

# 3. Install dependencies
pnpm install

# 4. Run the client
pnpm dev          # open the URL it prints (usually http://localhost:5173)
```

That is enough for the offline practice match and most work. For online play,
run the authoritative server in a second terminal:

```bash
pnpm server       # server on :8787; the dev client proxies /ws to it
```

Two checkouts at once (a worktree for a second branch, say) each want their
own server: put `PORT=8788` in the second one's `.env` and both `pnpm server`
and `pnpm dev` there follow it; Vite picks the next free client port itself.

No database: the server keeps its state as JSON files under `data/`
(ADR 0006). No `.env` is needed for development; without mail credentials the
server logs confirmation links instead of sending them (see `.env.example`).

Everyday commands:

```bash
pnpm test         # Vitest, includes the structural gates
pnpm check        # strict tsc, fast; run it liberally
pnpm lint         # Biome
```

Those three are what CI runs, and all three have to pass. The scripts under
`scripts/` that drive a real browser (`e2e_*.mjs`, the screenshot helpers) are
not part of `pnpm test`; they need a Chrome or Chromium binary and take the
path to it from `CHROME`, defaulting to the usual Windows install:

```bash
CHROME=/usr/bin/chromium node scripts/e2e_online.mjs
```

## Making a change

1. Read `CLAUDE.md` (repo map, invariants) and skim `CONTEXT.md` (the
   glossary). Use the glossary's terms in code, tests, and docs.
2. Branch from `main`: `feature/<slug>` or `fix/<slug>`.
3. Keep the invariants. The two that catch most newcomers:
   - **Determinism.** `src/sim/` never touches `Math.random`, `Date.now`, the
     DOM, or the network. All randomness goes through `Rng`. The structural
     tests (`tests/architecture.test.ts`, `tests/determinism.test.ts`) enforce
     this and run in `pnpm test`.
   - **Original naming (ADR 0004).** Every name is original English: no names,
     icons, or assets borrowed from any other game. A new game term goes
     through `CONTEXT.md` first.
4. **Every sim or server behavior change adds or updates a test in the same
   change.** Fix bugs test-first: reproduce with a failing test, then the
   smallest change to green.
5. Style: TypeScript strict, ESM, 2-space indent, Biome-formatted (only the
   files you touched). No em dashes, en dashes, or emojis anywhere: code,
   comments, docs, commits.
6. Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
   with a scope (`feat(sim): ...`, `fix(net): ...`) and a short body saying
   what changed and why.

## Opening a pull request

- Base your PR on `main` and keep it focused; small PRs land faster.
- Fill in the PR template. If the change is visible in game (HUD, renderer,
  menus), add before/after screenshots.
- CI must be green: tests, typecheck, lint.
- Reviewers may ask for changes; that is a normal, friendly part of the
  process.

## Releases

`main` is the development branch. Releases are tags (`vX.Y.Z`) cut from `main`
by the maintainer; the deployed server tracks the latest tag.

## Security issues

Do not open a public issue for a vulnerability; see [SECURITY.md](SECURITY.md).
