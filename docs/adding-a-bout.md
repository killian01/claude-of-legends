# Adding a bout

A bout kind is one short contest of a Thornfray (`CONTEXT.md`: Thornfray, Bout): its own rule,
its own Dusk, its own count, and either One life's death or Respawn's. The engine every kind runs
on is closed (ADR 0035): a kind built from its pieces is a data file, at most two small modules,
one bot entry, one test file and its words, and moves no shared version. This guide is the path
the nightly creator loop follows, one kind a night, and anyone else adding one. It was written
from the first kind, Lastwick, and every step shows what Lastwick did.

Read first: `CONTEXT.md` (the Thornfray words), ADR 0035
(`docs/adr/0035-thornfray-one-sim-per-bout.md`), the design (`docs/design/thornfray.md`, The bout
contract and Adding a bout) and the build plan (`docs/plan-thornfray.md`).

## What Lastwick touched

| File | What it holds |
|---|---|
| `src/sim/content/bouts/lastwick.ts` | The kind: every field of the contract, `version: 1`, `released: false`. |
| `src/sim/content/bouts/index.ts` | One import and one entry in `BOUT_KINDS`. |
| `tests/thornfray_bout_lastwick.test.ts` | The kind's own test. |
| `tests/thornfray_bout_versions.test.ts` | Its end checksum, length, counts and ranking on match seed 1. |
| `CONTEXT.md` | Its entry, written with the design before any code. |

No module of its own: its count is the shared survival scorer, it stands no goal, and its bots
have no errand. Nothing under `src/sim/royale/` moved, and neither did `BOUT_ENGINE_VERSION`
nor `ROYALE_RULES_VERSION`.

## The checklist

Do the steps in this order. The registry's gate (`tests/thornfray_bouts.test.ts`) fails a kind
that skips the name's entry, playable data, its bot entry, its pinned bout or its test file.

### 1. The name

An original compound or a plain word, in English, never borrowed and never one that recalls a
name from elsewhere (ADR 0004). Search it five ways and keep the results for the PR's body:

```
"Lastwick game"
"Lastwick game mode"
"Lastwick video game"
"Lastwick champion"
"Lastwick character"
```

A name (anything game text writes as a proper noun) passes only when no game, mode, champion,
hero or playable character carries it. A plain word kept lowercase in game text passes unless it
is a champion's or a hero's name somewhere. The PR never names the game a rejected name came
from.

Then its entry in `CONTEXT.md`, beside Lastwick and Starglean: `**Name**:`, what the bout is in a
sentence or two, and an `_Avoid_:` line with the words it must not be called. The gate looks for
the line that starts `**<name>**:`. Lastwick's:

```
**Lastwick**:
The Thornfray bout where a fall is out for the bout and the last champion standing wins, under a
Dusk that closes on its Thornyard in a minute and a half; the places are the order of the falls.
_Avoid_: last standing (the battle royale's award), last man standing, survival round
```

### 2. The data

`src/sim/content/bouts/<id>.ts`, exporting one `BoutKind` (`src/sim/content/bouts/types.ts`),
then one line in `src/sim/content/bouts/index.ts`. Planet rules: out of the content fingerprint;
the kind's own fingerprint is computed from this data (`boutFingerprint`), so any change to a
number or a word moves it by itself.

Field by field, with Lastwick's choices:

- `id`, lowercase letters only (`'lastwick'`); `name` (`'Lastwick'`).
- `rule`: one line under 40 characters (`'Last one standing wins'`). `card`: two or three short
  lines for the bout's card at the landing.
- `version: 1`, `released: false`. The version counts the kind's own modules (its scorer, its
  goals); it moves when they change after release.
- `base`: `'one_life'` or `'respawn'`. Lastwick is One life: a fall is out for the bout.
- `playS`: 90 to 120 seconds from landing to the clock's end. Every bout stops at its clock,
  and a One life bout also stops as soon as one champion stands. Lastwick's light goes out at
  92 s and the dark's burn (12 percent a second, more every 10 s) ends it by about 100 s, so its
  clock stands at 120 s as a backstop that never decides a bout the dark can.
- `thornyard`: the chord radius (40 m, about 5,030 m2) and the regions it may stand in (absent
  for all six).
- `dusk`: the closings inside the Thornyard, first to last, each smaller than the light before
  and later than the one before (`radius`, `closeFrom`, `closeTo`, `holdTo`, `burn`), counted
  from the landing. They are numbered from the end: the last closing is always phase 5 and the
  dark always phase 6, so Lastwick's three are phases 3, 4 and 5. `edgeSpeed` (1.1 m/s for a
  bout's small caps), `burnBefore` (the outside of the Thornyard burns from the first second:
  3 percent), `lightOutS` (92). With Seedfalls the light is held at least to the clock plus their
  forecast whatever this says.
- `systems`: every system of the planet is off unless named (`pads`, `burr`, `lastLight`,
  `marks`, `clamors`, `upstart`, `camps`), and the Risings rise only at the times named in
  `risings`. Lastwick names the Clamors alone.
- `caches`: how many stand at landing (never more than the Thornyard's spots allow, less two per
  Seedfall seed) and when an opened one comes back (`null` for never). Lastwick: 12, never back.
- `seedfalls`, `goals`: absent when the kind has none, as in Lastwick.
- `count`: the scorer (step 3). `ties`: the tie-breaks after the count, in order, ending on
  `'seat'` (Lastwick: `['health', 'seat']`).
- `bots`: the errand's id in `BOUT_CALLS` or `null`, its health floor and reach, the Dusk margin
  as a share of the skill's, the cornered light in meters, the pace (`null` for none). Lastwick:
  no errand, half the Dusk margin, cornered under 8 m, no pace.
- `hud`: the count's word on the top line and whether the count reads as a place (Lastwick:
  `'left'`, a place).

### 3. The count

Use a shared scorer from `src/sim/royale/bouts/count.ts` when one fits:

- `survivalScorer`: the order of the falls, a same-tick pair placed by the health each had the
  tick before, as One life places its fallen (`score.ts` `placeFallen`). Lastwick's.
- `weightedScorer(id, weights)`: caches by kind, and a takedown's steal; its weights stand on
  the scorer as data, so the kind's fingerprint reads them. Starglean's `gleanedScorer` is one.
- `heldTimeScorer(id)`: the seconds a circle or a carrier is held.

Only when none fits: `src/sim/royale/bouts/score_<id>.ts`, a `BoutScorer` whose
`onEvents(events, bout)` the mode feeds every tick's events (the `damage` events included),
pure, writing only `bout.counts`. The test kind in `tests/thornfray_fixture.ts` counts damage
this way.

### 4. The goal

Only when the bout stands something on the planet: `src/sim/royale/bouts/goal_<id>.ts`, a
`BoutGoal` stepping primitives of the closed set (`'circle'`, `'carrier'`, `'target'`) on the
bout's stream, referenced from the kind's `goals`. The observation, the wire and the renderers
already carry every primitive; the kind touches none of them. Lastwick stands none.

### 5. The bots

A bot plays every rule a person plays, from the same signals, and fights on sight in every bout.
The kind's errand is one entry in `BOUT_CALLS` (`src/sim/royale/bot/bout_calls.ts`), answering
the goal from the observation alone and asked only after the fight block; its numbers go in
`src/sim/content/bots/bout_skills.ts`. A kind with no errand says `errand: null` in its data, as
Lastwick does: the fights and the light are the bout. Both files land with slice 4 of
`docs/plan-thornfray.md`; until then a bout's bots play the planet's brain.

### 6. The gates

- `tests/thornfray_bouts.test.ts` reads the registry: the `CONTEXT.md` entry, the `BOUT_CALLS`
  entry (or `errand: null`), the pinned bout, the test file, the rule's length, the card's lines,
  no dash in the words, and data the engine can play. It runs on every kind with no edit.
- `tests/thornfray_bout_versions.test.ts` pins the kind's first bout of match seed 1: add an
  entry with the kind's id, `version`, `engine` (`BOUT_ENGINE_VERSION`) and a region it allows,
  run the file, and copy the checksum, ticks, counts and ranking from the failure.
- `CORE_ON_THE_PLANET` (`tests/architecture.test.ts`) reads every file under `src/sim/royale/`,
  so a new module is guarded with no edit.

### 7. The test

`tests/thornfray_bout_<id>.test.ts`, on the shared harness (`tests/thornfray_fixture.ts`:
`buildBout`, `land`, `playOut`, `boutReplay`), built through `buildBoutSim` on the real
Wanderseed. Every kind's test covers at least:

- eight house bots on seeds 1 to 3 end the bout within its clock and fifteen seconds;
- the ranking is total and follows the count;
- the count counts what the rule says on a staged scene;
- the errand walks to the goal, and a bot in reach of an enemy still fights;
- a replay of the bout, loaded from the registry, matches its checksum and its counts.

Lastwick's adds its own rule: the Thornyard's cap and its three closings as phases 3, 4 and 5;
the light out at 92 s (phase 6); twelve caches inside it, none back; nobody landing outside it;
the outside burning 3 percent a second from the first tick; the places the order of the falls,
a same-tick pair by the health before; its clock a backstop that ranks those standing by
health; no Seedfall, Rising, camp, pad, mark, Burr or Upstart.

Run before the PR:

```
pnpm vitest run tests/thornfray_bout_<id>.test.ts tests/thornfray_bouts.test.ts \
  tests/thornfray_bout_versions.test.ts tests/royale_golden.test.ts \
  tests/architecture.test.ts tests/determinism.test.ts
pnpm check
pnpm lint
```

### 8. The measure

```
node scripts/thornfray_report.mjs --bout <id> --seeds 6
```

Its length against 90 to 120 s, whether its rule or its clock ended it, the spread of its
places, the fighting share against Lastwick's, its own counts; the numbers go in the PR. The
report lands with slice 8 of `docs/plan-thornfray.md`; until then the PR carries the test's own
figures. Lastwick's, with the planet's brain still playing its bots: on seeds 1 to 6 its rule
ended it at 87, 80, 94, 82, 92 and 85 s, seven takedowns each, five to nine caches opened.

### 9. Release

The maintainer's step: `released: true` puts the kind in the pool (`boutPool()`), with an entry
in the News (`src/ui/news_entries.ts`). A kind in progress stays registered and out of the pool.

## Rules that do not bend

- The sim is deterministic: every random draw through `Rng`, lengths and angles through
  `src/sim/exact.ts` and `src/sim/geo.ts`, never `Math.random`, `Date.now`, `performance.now`,
  `Math.hypot` or a trigonometric function under `src/sim/`.
- `src/sim/` imports nothing from `render/`, `ui/` or `net/`.
- Bots get every rule a person gets and fight on sight. One life's and Respawn's own rules are
  not a kind's to change.
- The battle royale stays identical match for match: `tests/royale_golden.test.ts` stays green.
- Original names only, and never a word about any other game in code, comments, docs or commits.
  No em or en dashes and no emojis anywhere.
- Every behavior is tested in the change that brings it.

## Engine work is not the loop's

A kind that needs what the engine lacks is engine work, never one night's: a new goal primitive,
a new system on the planet (a gallery of Strikeposts), a change to combat (duels), to a seam, to
the ledger, to a shared scorer or to the brain's bout branch. It moves `BOUT_ENGINE_VERSION`
(`src/sim/content/bouts/match.ts`), keeps `tests/royale_golden.test.ts` green or moves
`ROYALE_RULES_VERSION` with its changelog line, captures every pinned bout again, and is reviewed
by the maintainer before it lands.
