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
- `docs/plan-48h.md`: the build plan and phase order.

## Repo map

| Path | What it is |
|---|---|
| `src/sim/` | **Deterministic game core, the source of truth.** No DOM/Three/network imports; runs in browser, server, and headless. |
| `src/sim/content/` | Data-as-code: champions, items, sigils, the map, bots (`content/bots/`, one file per bot). |
| `src/render/` | Three.js top-down renderer. Reads the world; never mutates it. |
| `src/game/` | Local input and client glue. |
| `src/ui/` | HUD (DOM + CSS). |
| `src/net/` | Online client: wire protocol + WebSocket mirror world. |
| `server/` | Authoritative game server. |
| `headless/` | The environment: a match stepped from outside the repo over NDJSON (ADR 0002 phase 2). |
| `tests/` | Vitest suite, including the structural gates. |

Directories that do not exist yet are created by their phase in `docs/plan-48h.md`;
keep this table honest as they land.

## Commands

- `pnpm install`: once per clone. `pnpm dev`: Vite client. `pnpm test`: Vitest.
  Prefer a single file while iterating: `pnpm vitest run tests/determinism.test.ts`.
- `pnpm env`: builds and runs the headless environment on stdio (`headless/README.md`).
- `pnpm check`: strict `tsc`, fast; run liberally while working.
- `pnpm lint`: Biome (2-space, lineWidth 100, single quotes). Format only the files you changed.

## Architecture (the load-bearing ideas)

- **One sim, every host.** The exact same `src/sim/` code runs offline in the browser,
  on the authoritative server, and headless. Behavior must be identical everywhere.
- **The server is authoritative.** The client renders and never decides outcomes.
- **Every bot is a `Policy`** (`src/sim/policy.ts`): deterministic (observation, rng) -> action,
  zero I/O. The observation is team vision, never global sim state. The obs/action space and
  the decision budget are a public, versioned contract (ADR 0002, ADR 0003).

## Invariants, YOU MUST keep these

- **`src/sim/` has zero DOM, Three.js, or network imports** and never imports from
  `render/`, `ui/`, or `net/`. Guarded by `tests/architecture.test.ts`.
- **Determinism.** Fixed **20 Hz** tick (`DT = 1/20` in `src/sim/types.ts`). All randomness
  goes through `Rng` (`src/sim/rng.ts`): **never `Math.random`**, `Date.now`, or
  `performance.now` in sim logic. Same seed gives the same world. Guarded by
  `tests/architecture.test.ts` and `tests/determinism.test.ts`.
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
- **Commits:** Conventional Commits with a scope (`feat(sim): ...`, `fix(net): ...`) and a
  short body saying what changed and why. Branches: `feature/<slug>`, `fix/<slug>`.
- **Pull requests:** based on `main`, small and focused, following
  `.github/PULL_REQUEST_TEMPLATE.md`. If the change is visual, add before/after screenshots
  to the PR, committed under `docs/screenshots` and referenced from the PR body.
  The contributor-facing walkthrough is `CONTRIBUTING.md`; keep the two consistent.
- **Releases:** `main` is the development branch; releases are `vX.Y.Z` tags cut from `main`
  by the maintainer, with `package.json` `version` bumped in the tagged commit.
- **Every sim or server behavior change adds or updates a test in the same change.**
  Fix bugs test-first: reproduce with a failing test, then the smallest change to green.
