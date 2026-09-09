---
name: verify
description: Run the project's gates (strict tsc, Biome, Vitest) the way CI does, on the right Node, with the known slow tests handled. Use before declaring a change done, before a commit or PR, or when a test result looks like a timeout rather than a failure.
---

# Verifying a change

CI runs three commands and all three must pass. Run them on Node 22 (the helper picks it
from `.nvmrc`; on Node 18 the type check happens to work and the test suite does not):

```bash
. .claude/skills/dev-server/node_env.sh
pnpm check                              # strict tsc, seconds; run it liberally while editing
pnpm lint                               # Biome (2-space, lineWidth 100, single quotes)
pnpm vitest run tests/<one>.test.ts     # the file for the change first
pnpm test                               # the whole suite last, several minutes
```

Format only files you changed: `pnpm exec biome format --write <files>`; do not
reformat the tree.

## Order of operations

1. **Type check first.** A test that fails to import is usually a type error in disguise.
2. **The single file for the change**, then its neighbours (the table in `/academy` maps
   bots files to tests; `tests/architecture.test.ts` and `tests/determinism.test.ts`
   guard every `src/sim/` change).
3. **The whole suite once**, after the change is otherwise done.

## Reading a red run

- **A timeout is not a failure.** `vite.config.ts` gives each test 60 s because the
  heaviest ones step whole matches; on a loaded machine `tests/kit.test.ts` ("ends on that
  build") and the objectives and pacing tests can exceed it in a full run and pass alone.
  Rerun the file by itself before blaming the change.
- **`does not provide an export named styleText`** at startup: wrong Node. Source the
  helper.
- **Architecture gate hits** name the file and the forbidden import or call
  (`Math.random`, `Date.now`, `Math.hypot`, trig, `**` under `src/sim/`): the fix is the
  `Rng` and `src/sim/exact.ts`, never an exemption.
- **Determinism or env parity red** after a sim change means the same seed no longer gives
  the same world on every host; look for iteration order over a `Map` or object, a float
  path outside `exact.ts`, or state kept outside the world.

## The stop gate

`.claude/hooks/qa-stop.sh` runs at the end of every turn and blocks on em or en dashes,
emojis, a stray `.only(`, a leftover `debugger`, or wall-clock calls under `src/sim/`.
It excludes `.claude/skills`, so keep the project's own skills clean by hand.
