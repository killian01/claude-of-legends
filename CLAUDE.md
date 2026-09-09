<!-- Claude of Legends, project-root CLAUDE.md. Keep this lean and strictly
     repo-wide; anchor guidance on stable paths, symbols, and pinned tests, never
     on counts that rot. HTML comments like this are stripped before load.
     No em dashes, en dashes, or emojis. -->

# Claude of Legends

A mini MOBA in the browser: 5v5, three lanes, ten champions,
online-first, with every non-human participant behind one deterministic Policy
abstraction. Built on the architecture proven by world-of-claudecraft (ADR 0001).
Stack: TypeScript (ESM, `strict`) · Three.js renderer · `ws` WebSockets · Vite ·
Vitest · Biome. No UI framework; tiny dependency set.

## Canonical docs

- `docs/design/game-definition.md`: what the game is. `docs/design/roster.md`: the ten champions.
- `docs/adr/`: the decisions and why. `CONTEXT.md`: the glossary; use its terms in code and docs.
- `docs/plan-48h.md`: the build plan and phase order. `docs/plan-forge.md`: the Forge build plan.
  `docs/plan-bots.md`: the bots build plan (`docs/design/bots.md`, ADR 0013).

## Repo map

| Path | What it is |
|---|---|
| `src/sim/` | **Deterministic game core, the source of truth.** No DOM/Three/network imports; runs in browser, server, and headless. |
| `src/sim/content/` | Data-as-code: champions, items, sigils, the map, bots (`content/bots/`, one file per bot), the default playbooks (`content/playbooks/`). |
| `src/sim/playbook/` | The playbook interpreter: a bot's decisions as data (ADR 0013), the validator, the patch operations, the play report. |
| `src/render/` | Three.js top-down renderer. Reads the world; never mutates it. |
| `src/game/` | Local input and client glue. |
| `src/ui/` | The HUD and every screen, DOM + CSS with no framework: the landing and the home (`page.ts`, `home_*.ts`), the Academy (`academy.ts` over `academy_steps.ts`), the ladder, the gallery, the Forge editor. |
| `src/net/` | Online client: wire protocol + WebSocket mirror world. |
| `server/` | Authoritative game server; `server/generation/` is the Forge's provider seam (ADR 0010); the bots' store, the Arena and the night coach live beside it (ADR 0013). |
| `headless/` | The environment: a match stepped from outside the repo over NDJSON (ADR 0002 phase 2). |
| `public/map/star-orchard/` | The shipped Star Orchard export (`docs/star-orchard.md`), one revision; raw Blender exports stay in `art_src/map_exports/`, gitignored. |
| `tests/` | Vitest suite, including the structural gates. |
| `scripts/` | Build, art, seeding, and browser e2e tooling; not part of `pnpm test`. |
| `.claude/` | The agent's project skills, hooks and settings (`.claude/skills/README.md`). |

Directories that do not exist yet are created by their phase in `docs/plan-48h.md`;
keep this table honest as they land.

## Commands

- `pnpm install`: once per clone. `pnpm dev`: Vite client. `pnpm test`: Vitest.
  Prefer a single file while iterating: `pnpm vitest run tests/determinism.test.ts`.
- `pnpm env`: builds and runs the headless environment on stdio (`headless/README.md`).
- `pnpm check`: strict `tsc`, fast; run liberally while working.
- `pnpm lint`: Biome (2-space, lineWidth 100, single quotes). Format only the files you changed.
- Node 22 is required (`.nvmrc`); a shell without nvm loaded gets it from
  `. .claude/skills/dev-server/node_env.sh`.

## Local development

The runbook is `docs/dev-local.md`: what each surface needs, accounts without mail,
the `.env` knobs, and how to read a red run. The project's own skills under
`.claude/skills/` carry the procedures (the vendored ones are listed in its README):

- `dev-server`: the server and client in the background, task-local state under `.dev/`,
  via `.claude/skills/dev-server/stack.sh up|status|log|links|down`. Never write into
  `data/` from a task unless asked.
- `academy`: testing the bot builder (tests, the `/api/bots` routes, the browser).
- `verify`: the three gates the way CI runs them, and which red runs are timeouts.
- `browser-e2e`: the puppeteer scripts and PR screenshots.

## Architecture (the load-bearing ideas)

- **One sim, every host.** The exact same `src/sim/` code runs offline in the browser,
  on the authoritative server, and headless. Behavior must be identical everywhere.
- **The server is authoritative.** The client renders and never decides outcomes.
- **Every bot is a `Policy`** (`src/sim/policy.ts`): deterministic (observation, rng) -> action,
  zero I/O. The observation is team vision, never global sim state. The obs/action space and
  the decision budget are a public, versioned contract (ADR 0002, ADR 0003).
- **One page, and the browser history mirrors it (ADR 0020).** The client never reloads
  between screens; `src/game/nav.ts` gives every screen that opens over another (a section,
  a drawer, a card, a match) one history entry, so Back closes it instead of leaving the site.
  A match is a guarded layer: Back opens the pause menu, a reload or a closed tab asks first.
  Only the home's sections carry an address (`#ladder`).

## Invariants, YOU MUST keep these

- **`src/sim/` has zero DOM, Three.js, or network imports** and never imports from
  `render/`, `ui/`, or `net/`. Guarded by `tests/architecture.test.ts`.
- **Determinism.** Fixed **20 Hz** tick (`DT = 1/20` in `src/sim/types.ts`). All randomness
  goes through `Rng` (`src/sim/rng.ts`): **never `Math.random`**, `Date.now`, or
  `performance.now` in sim logic. Same seed gives the same world. Guarded by
  `tests/architecture.test.ts` and `tests/determinism.test.ts`.
- **The sim rounds alike on every engine (ADR 0019).** Lengths and angles go through
  `src/sim/exact.ts`: never `Math.hypot`, the trigonometric functions, `Math.pow`, or `**`
  in `src/sim/`. A replay re-simulates on whatever engine opens it. Guarded by
  `tests/architecture.test.ts`.
- **The decision budget (ADR 0003) applies identically to humans and bots.** Server and
  headless env share its implementation, pinned by a parity test.
- **Original naming, in English, everywhere (ADR 0004).** No borrowed IP (names, icons, assets).
  A new game term goes through `CONTEXT.md` first.
- **No em dashes, en dashes, or emojis** anywhere: code, comments, docs, commits.
- **Never commit `.env` or secrets.**

## Conventions

- ESM + TypeScript `strict` everywhere, 2-space indent. Keep the dependency set tiny;
  do not add packages without a clear need.
- **Module-first.** New logic lands as its own small tested module behind an existing seam,
  never appended to a coordinator file. Data-as-code tables are exempt: large declarative
  tables are correctly big.
- **Content is data.** Champions, items, sigils, and map records live under
  `src/sim/content/`, merged by one data module; never content tables inline in sim logic.
- **A screen reads one request.** What a screen shows is built by a pure
  `server/<screen>_page.ts` with its own test (`ladder_page.ts`, `home_page.ts`,
  `bot_page.ts`) and served by one route; the client module mirrors the wire shape locally
  and never imports from `server/`. What a screen decides without the DOM (the play tiles,
  the Academy's steps, a pick rule) is a pure `src/ui/*.ts` module beside it, tested.
- **A screen that opens over another is a nav layer** (`src/game/nav.ts`): push a frame when
  it opens, call `closed()` on its own way out (its Back, Escape, scrim), guard it while
  leaving would cost something. Sections, drawers and notices get this from their shared
  host; a new kind of overlay wires it itself. `scripts/e2e_nav.mjs` presses the real Back.
- **Commits:** Conventional Commits with a scope (`feat(sim): ...`, `fix(net): ...`) and a
  short body saying what changed and why. Branches: `feature/<slug>`, `fix/<slug>`.
- **Pull requests:** based on `main`, small and focused, following
  `.github/PULL_REQUEST_TEMPLATE.md`. If the change is visual, add before/after screenshots
  to the PR, committed under `docs/screenshots` as WebP and referenced from the PR body;
  take them on a state directory with people on it (`node scripts/seed_home.mjs`,
  `docs/dev-local.md`), never on an empty server.
  The contributor-facing walkthrough is `CONTRIBUTING.md`; keep the two consistent.
- **Releases:** `main` is the development branch; releases are `vX.Y.Z` tags cut from `main`
  by the maintainer, with `package.json` `version` bumped in the tagged commit.
- **Every sim or server behavior change adds or updates a test in the same change.**
  Fix bugs test-first: reproduce with a failing test, then the smallest change to green.
