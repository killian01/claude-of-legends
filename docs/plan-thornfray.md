# The Thornfray plan

Thornfray on the Wanderseed (ADR 0035), its design (`docs/design/thornfray.md`) and its words
(`CONTEXT.md`: Thornfray, Bout, Final, Bushel, Thornyard, Lull, Lastwick, Starglean). This file
keeps the choices in one place and tracks the build, slice by slice. Every slice lands on `main`
on its own, with its tests green, and changes nothing a player sees until slice 7 opens the door.

## The game

| Topic | Choice |
|---|---|
| Format | 8 champions, Solo. House bots fill; four gentle, three normal, one strong. |
| Entry | The landing's fourth way and a home tile; the quick pick without the Crew row; a gathering of up to 20 s (full, timed out, or the opener's Start now). A late person may take the fewest-bushels bot seat at the second Lull. |
| Seats | Dealt once for the match from its seed (`royaleSeats`, `royaleSeatSkills`); one champion, skin and pair of sigils per seat all match. |
| Bouts | Six: five drawn from the pool, then the Final, drawn too, bushels doubled. The six drawn at once as one sequence: never the kind just played, never a kind three times once the pool holds three, never the region just played unless the kind allows no other. |
| Length | Each bout 90 to 120 s from landing; the Lull 10 s; about 12 minutes a match. |
| Thornyard | A cap of chord radius 40 m around a region's heart, drawn per bout; the Dusk outside it from the first second. |
| Lull | The next bout's drop: the last bout's end beat (2 s), the table of bushels, the next rule in one line, the landing pick inside the Thornyard, the winner's Graft offer. |
| Bushels | 5, 4, 3, 2, 1, 0, 0, 0 by place; 10, 8, 6, 4, 2, 0, 0, 0 in the Final. Ties: bouts won, then the Final's place. |
| Arc | Every seat lands bout k (1 to 6) at level 5 + k with 2k pieces of its planet build. |
| Prize | The bout's winner: three Boughs over the next Lull, the pick held for the next bout only (`PRIZE_LASTS = 'next'`); never lost to a fall or a bout's end (carried as `pendingPrize`). No other Graft offer. |
| Ladder | Bout actions as the battle royale (takedown 10, assist 5, cache 1); the end 40 to the first, 20 to the second and third; bushels never banked. |
| Lastwick | One life; closings as phases 3, 4, 5, the Thornyard closed to 5 m by 82 s, dark (phase 6) at 92 s; 12 caches, never back; places by the order of the falls. |
| Starglean | Respawn; 105 s; one closing (phase 5), the light held to 120 s; up to 18 caches (the spots inside less six), back after 30 s; Seedfall bursts of three at 25, 55, 85 s called 12 s ahead, read 15 s past the impact, every seed 18 m from every other; a cache 1, golden 2, Seedfall 3, a takedown takes one. |
| Bots | The house brain with the bout's data; the drop inside the Thornyard; the planet's Respawn errand off; one errand per kind in `BOUT_CALLS`, asked after the fight block; fight on sight in every bout. |
| Versions | `ROYALE_RULES_VERSION` moves only if the golden checksums move. Each bout record carries its kind's `version`, its computed `boutFingerprint` and `BOUT_ENGINE_VERSION`; each released kind's end checksum, counts and ranking pinned. |

## The build

### 0. The design (this change)

`CONTEXT.md` (the eight terms; Battle royale, Graft and Win card touched), ADR 0035,
`docs/design/thornfray.md`, this plan. No code.

### 0.5. The golden checksums (before any seam moves)

- `tests/royale_golden.test.ts`: fifty house bots on the real Wanderseed, `sim.checksum()` at
  60 s after landing and at the match's end pinned as constants, captured on c456598: seed 7 in
  Respawn and in One life, Solo, and seed 5 in Trios, One life, fifty seats each. Its
  header says what a red run means: a seam moved the battle royale, so either the change is
  wrong or `ROYALE_RULES_VERSION` moves with a changelog line and the constants are captured
  again.
- Nothing else. Every later slice keeps it green; slice 1 rewrites `drawDusk`, `duskAt`,
  `seedfallSchedule`, the cache draw, the Graft triggers, the drop and the `Sim`'s constructor,
  and a changed order of random draws in any of them would otherwise change every fifty seat
  match unseen.
- As built: Trios seats forty-eight, not fifty (`crewSeats(3)`, `TRIO_SEATS`: sixteen crews of
  three), so seed 5 in Trios is pinned on its forty-eight seats. Each match is built the way the
  server builds one nobody has joined (`RoyaleMatch` with no person, over `royaleSeats` and
  `royaleFactory`, so through `buildRoyaleSim`), which also guards slice 5's pre-dealt seats in
  `RoyaleMatch` and its factory's bout argument. "60 s after landing" counts from the tick the
  drop ends and every seat lands. An extra random draw in `drawDusk` turns all three red at
  both points.

### 1. The engine: the bout seam, the contract and the ledger (the sim)

The engine every bout runs on, with the whole contract and no bout kind released: a test-only
kind in the fixtures, standing one goal of each primitive and counting with a scorer of its own
on the tick's `damage` events, plays the whole chain. The battle royale does not move
(`tests/royale_golden.test.ts`).

- **Content.** `src/sim/content/bouts/types.ts` (`BoutKind`, `BoutKindId`, `BoutDusk` with its
  closings counted from the end and `lightOutS`, `BoutSystems` with
  `risings?: { pyrefang?; voidmaul?; warden? }`, `BoutSeedfalls` with `forecastS` and `apartM`,
  `GoalShape`, `GoalPrimitive`, `BoutGoal`, `BoutScorer`), `src/sim/content/bouts/index.ts`
  (`BOUT_KINDS`, the released pool), `src/sim/content/bouts/match.ts` (`BOUT_SEATS` 8, `BOUTS`
  6, `BOUT_BUSHELS`, the Final's factor, the arc's levels and pieces, `PRIZE_LASTS = 'next'`,
  `BOUT_ENGINE_VERSION` 1). Planet rules, out of the content fingerprint
  (`src/sim/content/fingerprint.ts`).
- **The seams**, each reading the bout's plan when one is set and today's table when not:
  - `src/sim/royale/dusk.ts`: `drawDusk` and `duskAt` over a `DuskPlan` (its closings, its first
    cap, its edge speed, the burn before the first closing, `lightOutS`); a bout's closings
    numbered from the end, the last always 5 and the dark always 6; `PLAY_S` replaced by
    `plan.lightOutS` in both dark branches (the phase's end and the burn); `maxShift` over the
    plan; the final point drawn inside the first cap.
  - `src/sim/royale/caches.ts`: the spots inside the Thornyard, the count held to
    `min(count, spots inside - 2 x seeds per burst)`, the return.
  - `src/sim/royale/seedfall.ts`: `seedfallSchedule` over the bout's times, seeds and call;
    `seedfallCap` reading the bout's `forecastS`; `drawSeedfallPoints` generalized to N seeds,
    `apartM` measured against every seed drawn before (not the first alone, as
    `farthestPoint` measures for a pair), free spots first, then walkable ground on a seeded ring
    inside the forecast light.
  - `src/sim/royale/grafts.ts`: no drop Bough, no trigger, no level offer in a bout; the prize
    offer at the drop, exempt from `clearOffers`; a `pendingPrize` offered again unchanged.
  - `src/sim/royale/drop.ts`: landings and the quiet spot inside the first cap.
  - `src/sim/sim.ts`: the two lines that set the Risings' times read them from the mode (today's
    `WARDEN_RISE_AT_S` and `RING_RISE_AT_S`, or the bout's `systems.risings`); `checksum()`
    mixes the bout's per-seat counts when a bout is set. No other seam: the camps, the rings
    and the Warden a bout leaves out are never on its map (the build, below).
  - `src/sim/royale/last_light.ts`, `burr.ts`, `marks.ts`, `upstart.ts`, `pads.ts`: off when the
    bout's systems leave them out.
- **The bout itself**, new modules: `src/sim/royale/bouts/plan.ts` (a kind and a Thornyard to
  the seams' plans; the light held at least to `playS + forecastS` when the kind has
  Seedfalls), `bouts/ledger.ts` (the six kinds and Thornyards drawn as one sequence on the
  match's seed with a salt of its own, by seeded shuffle with bounded rejection and a
  deterministic constructive fallback; a kind's region list overrides "never the region just
  played"; the bout seed, the bushels, the totals by seat, the tie-breaks, the winner, the
  prize), `bouts/arc.ts` (a seat at a bout: level, points spent, pieces, the prize Graft it
  carries), `bouts/count.ts` (the shared scorers: survival, weighted events with a steal on
  takedown, held time), `bouts/goals.ts` (starts and steps the kind's goals, gathers their
  primitives), `bouts/end.ts` (when a bout ends, its ranking), `bouts/observe.ts`
  (`ObsRoyale.bout`, the primitives included).
- **The mode.** `src/sim/royale/mode.ts`: `RoyaleOptions.bout`; every tick's events handed to
  the kind's `count.onEvents` and its goals' `step`; the end and the ranking handed to
  `bouts/end.ts` when set; the counts and the goals' state in `snapshot()` and `restore()`;
  `observeBout` spread into `observe` like `observeBurr`. `src/sim/royale/types.ts`: the bout's
  state on `RoyaleState`; `ROYALE_RULES_VERSION` unchanged. `src/sim/policy.ts`: `ObsBout`,
  `ObsGoal` and the additive `ObsRoyale.bout`.
- **The build.** `src/net/replay.ts`: `buildBoutSim(planet, record)` beside `buildRoyaleSim`:
  a `planetGameMap` filtered to the camps, rings and Warden the kind runs; the champions from
  the record's picks; the skills from `royaleSeatSkills(record.bout.matchSeed, 8, guestsOnly)`,
  never from the bout's seed. `RoyaleRecord.bout` (the match's seed, the bout's index, kind and
  Thornyard, the Graft each seat carries in, `pendingPrize`, the kind's `version`,
  `boutFingerprint`, `BOUT_ENGINE_VERSION`); `royaleReplayPlayable` checks the three versions
  and `loadRoyaleReplay` threads the record.
- **The gate.** `tests/architecture.test.ts`: `CORE_ON_THE_PLANET` reads every file under
  `src/sim/royale/` (and its folders) from the directory instead of a hand-kept list.
- **Tests.**
  - `tests/thornfray_ledger.test.ts`: the bushels; a total order on every tie; the draw's rules
    on seeds 1 to 10000 with pools of 2, 3 and 4 kinds and one single-region kind, never a
    dead end, never a broken rule; the bout seed; the prize.
  - `tests/thornfray_seams.test.ts`: a plan's Dusk inside the Thornyard and burning outside it
    from the first tick; the closings numbered from the end (one, two and three closings: the
    last is 5, the dark 6) and the dark's end and burn counted from `lightOutS`; the caches
    inside it and their count held under the spots; the Seedfalls on the plan's clock, three
    distinct points at least 18 m apart in every region on seeds 1 to 20, and no `seedfallCap`
    of radius 0 before the clock; every landing and return inside the Thornyard; no Graft but the
    prize; the Risings only by `systems.risings`, at their times; no camp, ring or Warden on a
    filtered map.
  - `tests/thornfray_fixture.ts`: the test kind (one goal of each primitive, a scorer on
    `damage` events) and an eight bot harness.
  - `tests/thornfray_replay.test.ts`: a bout replayed matches its checksum and its counts; a
    count changed by hand moves the checksum; refused under another kind version, fingerprint
    or engine version.
  - `tests/thornfray_bouts.test.ts`: the registry's gate (each kind's term, errand, pinned end
    checksum, test file, rule length).
  - The contract test's additive `bout` block (`tests/royale_contract.test.ts`).
  - Unchanged and green: `tests/royale_golden.test.ts`, `tests/royale_match.test.ts` (seed 7,
    both variants), `tests/royale_contract.test.ts`, `tests/royale_rules.test.ts`,
    `tests/royale_dusk.test.ts`, `tests/royale_crews.test.ts`, `tests/fixed_match.test.ts`.

- As built:
  - The Dusk's caps in a bout are drawn forward, not backwards: the first cap is the
    Thornyard, fixed on its region's heart, and a backward chain from a final point cannot be
    made to meet a fixed first cap within the edge speed. The final point is drawn inside the
    Thornyard within the closings' whole slide budget (walkable, with room, at least
    `POLE_CLEARANCE_M` from a pole: the Sanctuary's and the Open ground's hearts are the
    poles), and each closing's center stands on the way from the heart to it, its share of the
    way its share of the budget, jittered within the rest, so every slide stays within
    `maxShift` and every cap holds the final point (`dusk.ts drawPlannedDusk`).
  - `sim.ts` gains one more line than the plan names: `Sim.tickEvents()`, a read of the
    tick's events so far, which the mode hands the count and the goals after the deaths.
  - `RoyaleRecord.bout` carries `prize` (the seat offered fresh cards, the last bout's winner)
    beside `pendingPrize`, and `pendingPrize` is a list: a prize left unpicked and a fresh one
    can both be open at the next Lull. Its Thornyard is its region (`thornyard`), the radius
    the kind's. `BoutResult.pendingPrize` and `nextBout` carry the list.
  - `BoutSystems` names the camps too (Lastwick's "Off: camps"); the caches run by
    `caches.count`, the Seedfalls by `seedfalls`. The pads are off by the mode seating no site.
  - A bout deals no escorts: eight seats in a Thornyard find each other. A pick outside the
    Thornyard is brought toward its heart to 2 m inside the edge (`drop.ts landingIn`).
  - Every kind's bout ends at its clock (landing plus `playS`), and a bout of One life's death
    as soon as one champion stands.
  - A Seedfall burst draws its seeds greedily, free spots first then the seeded ring, starting
    again up to twelve times, then keeps the most spread draw: it never stacks two seeds.
  - The ledger's table, before the Final, breaks the last ties on the latest bout's place (the
    Final's once played), then the lower seat: a Lull's table needs a total order too.
  - `BOUT_KINDS` is the registry, every kind released or not; `boutPool()` is the pool.
  - `CORE_ON_THE_PLANET` read from the directory brought `royale/layout.ts` and
    `royale/return_pick.ts` under the scan: their three square roots go through `geo.norm` and
    a new `exact.root` (a sine from its cosine), bit for bit as before.
  - One more test file: `tests/thornfray_count.test.ts` (the shared scorers, the ranking's
    ties, the observation). The rising arc is tested in `tests/thornfray_seams.test.ts`. The
    gate's "card lines that fit the win card at 844 by 390" waits for slice 6
    (`tests/royale_win_layout.test.ts` reads every kind).

### 2. Lastwick

- `src/sim/content/bouts/lastwick.ts` (the design's numbers, `version: 1`, `released: false`),
  its line in `index.ts`; its `count` the shared survival scorer over One life's `placeFallen`
  and `oneLifeRanking`.
- `docs/adding-a-bout.md`: the design's checklist as the guide the creator loop follows,
  written from this first kind (the files it touched, the tests it added, the report's line,
  the five name searches, and what is engine work).
- **Tests.** `tests/thornfray_bout_lastwick.test.ts`: the Thornyard's cap and its three closings
  as phases 3, 4 and 5; nobody lands outside; a champion left outside burns 3 percent a second
  from the first tick; the light goes out at 92 s (phase 6); eight house bots on seeds 1 to 3
  end the bout by 115 s; the places are the falls' order, a same-tick pair placed by health
  before; no Seedfall, Rising, camp or pad; a replay matches. The end checksum, counts and
  ranking on seed 1 pinned in `tests/thornfray_bout_versions.test.ts`.
- As built:
  - `playS` is 120, the most a bout may have: the design gives Lastwick no clock of its own
    ("about 100 s at the latest"), and every bout stops at its clock, so the clock stands past
    the dark (92 s, 12 percent a second and more every 10 s, about 100 s from full health) as a
    backstop. The test checks the bout ends by its rule, not its clock, by 115 s, and that the
    clock, when it does end one (the champions kept standing by hand), ranks those standing by
    health.
  - The kind's `systems` names the Clamors alone. The Reprieve the design turns off has no rule
    in the sim yet (`RoyaleState.reprieveUsed` is never written), so nothing turns it off.
  - The kind's `bots` data is `{ errand: null, floor: 0, reach: 0, duskMargin: 0.5, cornered: 8,
    pace: null }`; nothing reads it until slice 4, and a bout's bots play the planet's brain.
    With that brain, on seeds 1 to 6 (bout 1 of the match, its region by the ledger's draw over
    a pool of Lastwick alone) the rule
    ended the bout at 87, 80, 94, 82, 92 and 85 s, seven takedowns each, five to nine caches
    opened, the first fall mostly past 60 s (the 14 m light): slice 4's fight on sight moves it.
  - The pinned bout in `tests/thornfray_bout_versions.test.ts` is the first bout of match seed 1
    (its seed `boutSeed(1, 0)`, eight house seats from `boutPicks(1)`), its region named in the
    entry (`'groves'`, that same draw for match seed 1) so a later kind in the registry never
    moves it; each entry also names the kind's version and the engine's it was captured under.
  - Its tests also cover the twelve caches inside the Thornyard and never back (every region has
    16 spots or more within 40 m of its heart) and run no Burr, Last light or Upstart besides the
    plan's list; the replay loads from the registry's default kinds.
  - `docs/design/thornfray.md`'s Lastwick section now says the Dusk is drawn forward (slice 1's
    change) and names its data file; its Adding a bout section points to the guide.

### 3. Starglean

- `src/sim/content/bouts/starglean.ts` (`forecastS` 15, `apartM` 18, `depthM` 8, the light held
  to 120 s); the gleaned weights and the takedown's steal as a shared scorer in
  `bouts/count.ts`; the bursts through slice 1's Seedfall plan; the 30 s return through the
  cache plan.
- **Tests.** `tests/thornfray_bout_starglean.test.ts`: the caches at landing, golden first, by
  region (18 in the Ruins and the Sanctuary, 14, 13, 12 and 10 in the Lakes, the Cliffs, the
  Open ground and the Cypress groves); a cache counts 1, a golden 2, a Seedfall cache 3 (a staged
  opening of each); a takedown moves one from the fallen to the taker and none from a fallen at
  nothing; three seeds at 25, 55 and 85 s, called 12 s ahead, each at least 18 m from the two
  others, inside the light, the 85 s burst included; the held opening; the bout ends at 105 s;
  the tie-breaks in order; the takedown score untouched by the count; a replay matches. The end
  checksum, counts and ranking pinned.
- As built:
  - `src/sim/content/bouts/starglean.ts` holds the design's numbers: Respawn, `playS` 105, a
    Thornyard of 40 m in any region, one closing to 26 m from 60 to 75 s at 6 percent (phase 5)
    held to 120 s (`lightOutS`, also the clock plus the forecast), 4 percent outside before it,
    edge speed 1.1; up to 18 caches back after 30 s; bursts of three at 25, 55 and 85 s, called
    12 s ahead, `forecastS` 15, `apartM` 18, `depthM` 8; the Clamors alone among the systems;
    ties `['seedfalls', 'falls', 'reached', 'seat']`; `hud` `'gleaned'`, a number. The Grace,
    the return pick and the held opening are Respawn's own and need no switch.
  - The count is `gleanedScorer` in `bouts/count.ts`, `weightedScorer('gleaned', GLEANED)` with
    `GLEANED = { plain: 1, golden: 2, seedfall: 3, steal: 1 }`. A weighted scorer now carries its
    weights as data (`weights` beside `id`), so the kind's fingerprint moves with them; before,
    they hid in a closure the fingerprint cannot read. No play moves: Lastwick's pinned bout and
    the golden checksums are unchanged, and `BOUT_ENGINE_VERSION` stays 1 (no kind is released).
  - `bots.errand` is `null`, not `'glean'`: the registry's gate asks a named errand for its entry
    in `BOUT_CALLS`, which lands with slice 4, and slice 4 names it there. The rest of the bots'
    data stands: `floor` 0.4, `reach` 80 (the Thornyard's width), `duskMargin` 0.5, `cornered` 8,
    no pace.
  - The caches at landing come out as the design says on every region's spots: 18 in the Ruins
    (25 spots inside) and the Sanctuary (45), 14 in the Lakes (20), 13 in the Cliffs (19), 12 on
    the Open ground (18), 10 in the Cypress groves (16).
  - The pinned bout in `tests/thornfray_bout_versions.test.ts` stands in the Ruins, not in the
    region the ledger draws for match seed 1 (the Cypress groves, as for Lastwick): the full
    eighteen caches, and a region the kind keeps whatever the maintainer decides on the groves.
  - Its test also covers the Dusk (one closing as phase 5, dark only at 120 s), a cache back 30 s
    after opened, a fall back in five seconds inside the light at its globe pick and in its
    Grace, no Rising, camp, pad, mark, Burr, Last light, Upstart or Graft (the Seedfall cache's
    Heartwood and the golden cache's Bough stay off in a bout), and a count moved by hand moving
    the checksum. The held opening is staged with a hit every tick for two seconds after the
    opening begins: it never changes hands and opens in about 4.5 s where a calm one takes 3.
  - With the planet's brain still playing (slice 4 brings `glean`), 24 bouts (every region,
    match seeds 1 to 4) all ended at the clock, 105 s: plain and golden caches opened 4 to 18 a
    bout (about 9), Seedfall caches 6 to 9 of the 9 (mostly 8), the winner at 7 to 18 (about
    12), 10 to 24 takedowns. The design's 30 to 40 caches wait on the errand's "a cache in sight
    before a roam".

### 4. The bots in a bout

- `src/sim/royale/bot/bout_calls.ts` (`BOUT_CALLS`: none for Lastwick, `glean` for Starglean),
  `src/sim/content/bots/bout_skills.ts` (each kind's floor, reach, Dusk margin, pace, cornered
  distance), `src/sim/royale/bot/brain.ts` (when `r.bout` is set, `errandPast` and `errandWalk`
  return null and the bout's errand is asked only after the fight block, where `royaleCall` is;
  the pace, the calm nerve and `LAST_LIGHT_M` read from the bout's data),
  `src/sim/royale/bot/drop_pick.ts` (in a bout, the pick inside the phase 0 cap the observation
  shows), `src/sim/royale/bot/travel.ts` (the Dusk margin scaled). `seedfallErrand`
  (`src/sim/royale/bot/calls.ts`) is unchanged: the planet's errand simply never runs in a bout.
- Nothing a fifty seat match runs changes: every new read is behind `r.bout`, and
  `tests/royale_golden.test.ts` stays green. Lastwick's and Starglean's pinned end checksums are
  captured again (both unreleased, so no version moves).
- **Tests.** `tests/thornfray_bots.test.ts`, on the `tests/royale_burr_bot.test.ts` pattern (a
  faked `ObsRoyale.bout`, then `decide`): a Starglean bot at 45 percent health, on a called
  Seedfall, with an enemy within 6 m, fights; a Lastwick bot strikes at its skill's odds from the
  landing; it still flees a far stronger enemy in a 14 m light (cornered only under 8 m); a
  Starglean bot with no enemy in sight walks to a Seedfall across the Thornyard and opens a cache
  in sight before it roams; a bot's drop pick lands inside the Thornyard on seeds 1 to 100. A
  whole bout of eight house bots on seeds 1 to 3: Lastwick lands at least four takedowns and
  mostly ends before the light goes out; Starglean opens every burst's three caches.
  `tests/royale_bot.test.ts` and its siblings are unchanged.
- As built:
  - Each kind's numbers stand in `src/sim/content/bots/bout_skills.ts` (`LASTWICK_BOTS`,
    `STARGLEAN_BOTS`) and the kind's `bots` is that entry, so its fingerprint still reads them.
    `BoutBots` gains `calm` (the nerve One life's calm adds, 0 in both kinds): the plan reads the
    calm nerve from the bout's data, and the contract had no field for it. `BOUT_BOTS` is what a
    bout's bots read when the policy is handed none.
  - The brain reads the kind's numbers from its policy, as it reads the seat's skill:
    `royaleBotPolicy` hands `mode.bout.kind.bots` to `royalePolicy`, and `decide` takes them as
    its last argument; the bout branch runs only while the observation shows a bout
    (`sense.bout`, `BOUT_BOTS` when none was handed). The test kind's numbers reach its bots the
    same way, with no registry lookup. `calmOf`, `paceOf` and `corneredLightOf` in `brain.ts`,
    `duskMarginOf` in `travel.ts`; `paceAlive` and `paceNerve` take the curve.
  - `BOUT_CALLS` maps an errand's id to a `BoutCall`, `(sense, bots) => { why, action } | null`;
    the registry gate (`tests/thornfray_bouts.test.ts`) now reads `BOUT_CALLS` itself instead
    of the file's text, and bites on an errand with no entry.
  - The glean errand, from the kind's floor (under it the brain's own loot and odds decide, as
    the design says): the called Seedfall the bot would reach first as far as it sees (fewest
    enemies in sight nearer, then the nearest), else the nearest cache in reach weighed by what
    it counts, raced for against an enemy farther off but never one an enemy stands within 8 m
    of. Its goals ask the light to hold them for the walk, the opening and 4 s (`litFor`, over a
    new `travel.ts secondsToDarkAt`, `secondsToDark` its call at the bot's own point), not the
    planet's safe ground: that asks the next cap of every goal from 25 s before a closing, and a
    first burst's seed placed past the next cap was walked to by nobody for a minute.
  - One rule is asked before the fight block, beside the held opening it begins
    (`bout_calls.ts beginHeldOpening`): in a bout, a bot no enemy struck in the last two seconds,
    within 6 m of a landed Seedfall's cache whose opening is held (Respawn's) and that nobody
    else opens as far as it sees, steps into its reach and holds still to begin it; begun, it is
    the planet's held opening, which already comes before the fight block and hits back from
    the cache. A struck bot answers first, a called seed not yet landed is fought over first
    (the plan's 45 percent case), and nothing is walked to past a fight. Without it the bots at
    a landed seed fought and chased each other around it, and nine bouts in twelve left a seed
    unopened at the clock; with it, none (match seeds 1 to 12, bout 1 of a pool of Starglean
    alone). The race to the seed took two in twelve to none, the light that holds two to none.
  - The drop's pick in a bout is uniform over the Thornyard short of its edge by 4 m, away from
    the poles when six draws allow it (the landing snaps the rest off the spire).
  - Measured on the house bots (bout 1, a pool of the kind alone): Lastwick on seeds 1 to 6 ends
    by its rule at 50, 52, 50, 63, 66 and 61 s, seven takedowns each, the first fall at 10 to
    15 s, never by the dark (with the planet's brain: 80 to 94 s, the first fall mostly past
    60 s). Starglean on seeds 1 to 12 opens all nine Seedfall caches in every bout, 3 to 16
    plain and golden caches (about 8), the winner at 6 to 22 gleaned, 15 to 24 takedowns.
  - Both pinned bouts are captured again (Lastwick now 1202 ticks, Starglean 2301); no version
    moves, both kinds unreleased, and `BOUT_ENGINE_VERSION` stays 1. `tests/royale_golden.test.ts`
    is green: every new read stands behind `r.bout` or `sense.bout`.
  - Open for the maintainer: fought on sight, a Lastwick bout lasts about a minute, under the
    design's 90 s floor for a bout (a calm or a pace in `LASTWICK_BOTS` is the dial); Starglean's
    fights take most of its seconds, and about 17 caches are opened in all against the design's
    30 to 40.

### 5. The server and the wire

- **Hosting.**
  - `server/thornfray_gather.ts` (pure: who is in, when it starts, Start now).
  - `server/thornfray_match.ts` (pure: the seats dealt once with
    `royaleSeats(people, matchSeed, 8)`, the ledger, the next bout's build arguments, the prize
    and the pending prize carried, the seat a late person takes, reservations by seat index).
  - `server/royale_match.ts`: `RoyaleMatch` takes optional pre-dealt `RoyaleSeat[]` and deals
    none when given.
  - `server/royale_sim.ts` and `tests/royale_fake.ts`: `RoyaleSimFactory` gains a bout argument
    (and any new member, in both); `server/royale_build.ts`: the factory over `buildBoutSim`
    when a bout is given.
  - `server/thornfray_service.ts` (the gathering, a `RoyaleMatch` of the eight dealt seats per
    bout, the clients moved onto each new Sim's unit ids with `client.matchId` kept through the
    Lull, the end; each bout's replay saved under a numeric id from `deps.newMatchId()`; a
    running Thornfray's ids handed to the store's prune as held).
  - `server/main.ts` (the deps beside the royale's, the dispatch asking the Thornfray service
    first, a weight of one on the capacity, the tick, disconnects, the presence count, the held
    replay ids).
- **Points.** `server/thornfray_points.ts` (a `RoyalePoints` per bout with its end awards off;
  the match's end paying `thornfray_first` 40 and `thornfray_top_three` 20 to a seat still
  playing), `server/points.ts` (`POINTS`), `src/net/protocol.ts` (`PointsReason`).
- **The wire.**
  - `src/net/protocol.ts`: the client's `thornfray` (enter, with the quick pick's champion,
    skin and sigils) and `thornfray_start` (Start now); the server's `thornfray_gather` and
    `thornfray_result` (the places, the bushels, the six bouts' replay ids);
    `match_start.royale.tf = { b, k: kinds[], s: ownSeat, t: TableRow[8], p?: prizeSeat }` at
    every bout's start and on a rejoin, with
    `TableRow = [seat, unitId, name, championId, bot 0|1, bushels, last, won]`.
  - `src/net/royale_wire.ts`: `SnapRoyale.tf` (the seat's count and place, the best count, the
    goal primitives `g`).
  - `server/thornfray_snapshot.ts`: its builder, through `sentOnChange` with the memory reset at
    each bout.
  - `server/seat_report.ts`: the `'thornfray'` queue, with the six replay ids.
- **Tests.** `tests/thornfray_gather.test.ts`; `tests/thornfray_match.test.ts` (six bouts
  chained on a seed; bouts 1 and 2 match on every seat's name, champion, sigils, skin and skill;
  the prize's Graft on the next build and gone from the one after; a winner who falls before
  picking keeps the offer; an offer unpicked at its bout's end carried as `pendingPrize` and
  offered again unchanged); `tests/thornfray_service.test.ts` on fake sims (a gathering to a
  result; Start now; a rejoin during a Lull gets the whole table, and during a bout; the second
  Lull's late seat; a leave played by the bot; no `royale_result` before the end; six numeric
  replay ids saved, listed in the result and held from pruning while the match runs);
  `tests/thornfray_points.test.ts`; `tests/thornfray_wire.test.ts` (the `tf` block of eight rows
  at a bout's start and on a rejoin, the snapshot's `tf`, every primitive round trip); `tf` added
  to `NEW_BLOCK_KEYS` (`tests/royale_contract.test.ts`); the reset in
  `tests/royale_snapshot.test.ts`.
- As built:
  - The factory's new member is `RoyaleBuild.bout`, a `BoutHost` (`server/royale_sim.ts`): the
    bout's ranking, its goal primitives, its result for the ledger and the kind's Seedfalls,
    read through `bouts/end.ts` and `bouts/goals.ts` on the real build and from counts, goals
    and prizes a test sets on the fake. The bout argument is `RoyaleBoutArgs` (the ledger's
    `NextBout` and the match's `guestsOnly`): the bots' softening is decided once, when the
    seats are dealt, so every bout deals each seat the same skill whoever holds the other
    seats. A bout runs its kind's death rule, and the service hands the kind's `base` as the
    variant. `RoyaleMatch` takes `{ seats, bout }` as an options argument, keeps `unitIds` by
    seat, and gains `reserve` (a bot seat held for its away person from a bout's start) and
    `replayFrom` (below). `RoyalePoints` gains an `endAwards` switch, off in a bout.
  - A seat stays its person's for the whole match, as the design's "until they come back, at
    any moment" says, not for the battle royale's minute: a dropped connection is brought back
    by the socket's hello or by entering again, a menu Leave only by entering again (a reload
    after a Leave lands on the home, not back in the match). A Thornfray nobody is connected to
    for a minute is closed.
  - Entering asks, in order: a seat the person owns in a running Thornfray, the gathering open
    (joined before any late seat, so the people waiting for company get it), the fewest-bushels
    bot seat of a Thornfray in its second Lull, then a new gathering. The late seat is taken
    only during that Lull (the second bout's drop): someone entering during the first bout's
    play opens a gathering rather than waiting a bout and a half. The Lull is then built again
    under the same bout id with the person's champion on the seat and played up to where it
    stood (`RoyaleMatch.replayFrom`: the old build's recorded events applied and recorded again
    tick by tick), and everyone in it gets a fresh `match_start` with the new table; the old
    build is dropped with nothing saved. One line holds one seat in a match.
  - The wire's shapes: `match_start.royale.tf` is a `BoutStart` (`{ b, k, s, t, p? }`, rows
    `BoutTableRow` best first); the snapshot's `tf` a `SnapBout` (`{ c, pl, bc, g? }`, the
    count and the best rounded to hundredths, each goal a `SnapGoal`
    `[shape, x, y, z, radius, holder unit id | null]`); `thornfray_gather`
    `{ people, of, startsIn, opener }`, sent on a change and each second;
    `thornfray_result` `{ place, of, seat, bushels, won, points, table, bouts, replays }` (the
    ladder points the person banked over the match, each bout's kind, place and pay for their
    seat), then `match_end`. A goal's wire form is one small module both ends share,
    `src/net/goal_wire.ts` (`goalOnWire`, `goalOffWire`), and the client mirror keeps the last
    `tf` between sends like the other blocks sent on change (`src/net/client_world.ts`, one
    line): the wire's other half, so slice 6 only reads it.
  - The snapshot's `tf` goes through `sentOnChange` keyed on the seat's record, which every bout
    and every rejoin makes afresh: the memory resets by itself, with no reset call.
    `seedfallsBlock` now hands the bout's Seedfalls to `firstSeedfallCallAt` (slice 1's open
    item): a bout that calls none never sends the block.
  - Points: the match's end pays a seat whose last order is within three minutes of the match's
    clock (every bout's ticks summed, the Lulls included), not the last bout's. The two reasons
    have words in `src/ui/points_text.ts` ('Thornfray won', 'top three'), which its typed table
    asks for.
  - The seat report writes one line per person per Thornfray (`queue: 'thornfray'`,
    `replays`), `SEAT_REPORT_VERSION` 4: each stint of a seat (a bout, or the part of one
    before a leave) is folded onto the match's clock by a new pure module,
    `server/thornfray_seat.ts`, the champion's counters counted from where each stint began.
  - `server/main.ts`: the pool is `boutPool()`, empty until slice 7 releases the kinds, so the
    mode answers "Thornfray is not open yet." and nothing a player sees changes. The prune's
    held ids are the bots' Records' and every running Thornfray's bouts (`heldReplayIds()` in
    every prune call), `/api/public/presence` gains `thornfray: { playing, gathering }` and
    `/healthz` the count of Thornfrays.
  - Two more test files: `tests/thornfray_seat.test.ts` (the fold) and
    `tests/thornfray_server.test.ts`, the whole path on the real Wanderseed: one person and
    seven house bots through six bouts, a second person taking the late seat, every bout's
    replay played back to the very checksum its live sim ended on (the rebuilt Lull included,
    its landing picked before the rebuild kept in its record). The fake service tests share
    `tests/thornfray_harness.ts`. Checked by breaking the code: the end awards in a bout, the
    three minutes, the late seat's choice, the catch-up and its recording, the reservations and
    the replay ids each turn a test red.

### 6. The client: the HUD, the bout's card, the Lull, the end

- **Pure words and models.** `src/ui/bout_text.ts` (the top line, the win line, the bushels
  chip), `src/ui/bout_card.ts` (the bout's card words from its kind), `src/ui/bout_rules.ts`
  (a variant and a kind to the rules the HUD and the cameras run: the return globe and its pick,
  the wash, the Death beat, the count's word), `src/ui/lull_model.ts` (the Lull's head, table and
  prize line from `tf`; the phone's five rows), `src/ui/thornfray_end.ts` (the end screen's
  parts), `src/ui/royale_text.ts` (`duskLine` says the outside burns when `p === 0 && b > 0`).
  `src/net/thornfray_client.ts` (the enter message, tolerant `isThornfray*` readers on the
  pattern of `src/net/royale_client.ts`).
- **Views and flow.**
  - `src/game/boot.ts`: the variant read from `world.royaleMatch.v` at each `match_start`; both
    `BeatCamera` and `CrewCamera` built for a Thornfray, each run only in a bout of its rule.
  - `src/ui/hud.ts`: the variant no longer fixed at construction; `Hud.setBout(variant, kind)`
    over `bout_rules.ts`.
  - `src/ui/lull_view.ts` (the card: inside `returnWashPhoneBox` on a phone, the full table on a
    desktop; folded to its head while the Graft cards are open, `.lull` added to `CARDS_ASIDE`
    in `src/ui/royale_grafts.ts`); the bout's end beat, two seconds at the Lull's start, read from
    the table's last winner.
  - The win card's words and a restart per bout (`src/ui/royale_win_view.ts`), the HUD's slots
    (`src/ui/royale_hud.ts`: placing only), the Lull's card kind (`src/ui/end_layout.ts`).
  - `src/render/planet_goals.ts`: the goal primitives on the planet, the globe and the minimap,
    drawn from the shape alone.
  - `src/game/thornfray_flow.ts` (the gathering card, one guarded match layer across every bout,
    the result), `src/main.ts` (`runThornfray`), the demo scenes `bout`, `lull` and
    `thornfray_end` (`src/game/royale_demo.ts`).
- **Tests.** `tests/bout_text.test.ts` (every kind's lines within the compact top line's width),
  `tests/bout_rules.test.ts`, `tests/lull_model.test.ts`, `tests/thornfray_client.test.ts`,
  `tests/royale_text.test.ts` (the burning calm), every kind's words in
  `tests/royale_win_layout.test.ts`, the Lull's card kind in `tests/end_layout.test.ts`, and
  `tests/lull_room.test.ts` beside `tests/royale_cards_room.test.ts`: `lullBox` clear of the
  thumbs bar, the globe's column, the bottom 164 px and the Graft cards' row at 844 by 390, and
  clear of its neighbors at 960 by 540, 1280 by 720, 1366 by 768 and 1920 by 1080.
- **In a browser.** `.dev/phone_measure.mjs` and `.dev/phone_feedback.mjs` at 844 by 390 with
  touch, `DESKTOP=1` after; `scripts/e2e_nav.mjs` presses Back in a Lull (the pause menu opens);
  `scripts/e2e_thornfray.mjs` plays Lastwick then Starglean on one socket and checks the return
  globe shows after a fall in Starglean; before and after screenshots under `docs/screenshots`
  on a seeded state directory.
- As built:
  - The pure modules stand as planned: `src/ui/bout_text.ts` (the top line, the win line, the
    bushels chip, the Final's x2, the end beat's words, the out wash, the gathering's line and
    the mode's words), `bout_card.ts`, `bout_rules.ts`, `lull_model.ts` (the model, `lullBox`
    and its sizes), `thornfray_end.ts`, `src/net/thornfray_client.ts` (the enter and Start now
    messages; `isThornfrayGather`, `boutStartOf`, `boutLineOf` and `thornfrayResultOf`, rows
    that cannot be read left out) and `src/game/thornfray_flow.ts` (the flow's decisions alone:
    `boutArrival` and `thornfrayNext`). The views beside them: `src/ui/lull_view.ts`,
    `src/ui/royale_hud_bout.ts` (the bout's part of the battle royale's layer: its words, the
    chips, the Lull's card and the end beat), `src/ui/thornfray_end_view.ts`,
    `src/ui/thornfray_gather.ts` (the gathering's card, in the joining card's dress, beside the
    quick pick rather than in the flow module) and `src/render/planet_goals.ts` (the
    primitives as rings and columns on the planet and the globe, `goalDots` on the minimap,
    colored by holder: the viewer gold, another seat red, nobody pale blue).
  - One screen across the bouts: the battle royale's layer of the HUD (`RoyaleHud`) is built
    afresh at each bout (`Hud.setBout`, through `Presentation.setBout` at every bout's
    `match_start`), on the bout's variant and kind, which also restarts the win card at the
    landing and lets the feed and the notices of the last bout go; the HUD around it, the
    renderer and its planet stay. Each bout builds the camera of its rule (`BeatCamera` in
    Respawn, `CrewCamera` in One life), the last one's let go, rather than both built once.
    The return globe, the pick and the wash already read the snapshot's variant, the bout's.
    The music starts again with each bout (a bout's end fades it).
  - A seat keeps its unit id in every bout (`buildBoutSim` seats the eight in seat order on a
    map no bout adds a unit to before them; `tests/thornfray_client.test.ts` checks every
    registered kind on every region), so the screen follows the same champion; a start naming
    another builds the screen again on it (`boutArrival` 'rebuild').
  - The Lull: the drop's banner stands down through it (`.br-lull`): the card's head counts the
    seconds ("Lands in 7", "7 s" on a phone) and its foot asks for the tap ("Tap the globe to
    land", the prize line taking the phone's one foot line when there is one). From the second
    Lull the end beat ("STARGLEAN · Wren", "· You" for the viewer) plays as a spotlight call
    held two seconds, said on the announcement's line while the winner's Graft cards are open,
    and the card waits for its word to have gone (`br-spotting`), which stands where the card
    would at 960 by 540, a second past the beat at most (the word's fade runs on the page's
    clock, which a starved page runs late). The Lull's globe faces the bout's Thornyard, near
    enough to tap inside it, and holds still until a drag turns it
    (`render/planet_drop.ts thornyardFacing`, faced again each frame in
    `render/planet_stage.ts`: the chart moves under the globe as the champion is set down to
    wait at the Thornyard's heart); a battle royale's drop, whose first cap is the whole
    planet, keeps its turning orbit. Facing the default orbit, the Thornyard stood at the
    globe's rim or on its far side. In the Final its line stands in the head and the ask goes,
    the card no taller. The card folds by a rule of its own, its body `display: none` to its head's
    first row (16 px on a phone, above the cards' title at 62), not through `CARDS_ASIDE`,
    whose `visibility` rule would have left an empty card standing. The prize line is short
    on a phone ("Wren picks a Graft") and may take two lines on a desktop. The Graft cards'
    line under their title says the prize lasts the next bout (`prizeSubtitle(PRIZE_LASTS)`).
  - The top line on a phone, measured at 844 by 390: the burning calm's "Outside burns" is a
    desktop's (on a phone the Dusk's pill says the burn to a champion standing in it), and in
    play the count drops the bout's name as well as its word ("0:48 · 7, 2nd"): with the
    closing Dusk's line the name ran the row to 381 px of its 380. The win line on a phone is
    "Most gleaned wins · 3 of 6" ("· the Final" in the Final), beside the bushels chip, which
    stands there rather than in the head's row and gives way to the Dusk's pill. The chip is
    hidden in the first bout, everyone at nothing.
  - The Final's card at the landing keeps the kind's lines: a fourth line ("The Final: every
    place pays double") pushed Starglean's card into a phone's notices with the thumbs; the
    Lull's card, the win line and the x2 pill say what the Final pays.
  - The end screen is the battle royale's 'royale' card: the result and its three ways on, the
    seat bout by bout ("2. Starglean 4th +2", two columns of three) under it on a desktop
    (`EndContent.bouts`, `EndMetrics.boutsH`, none on a phone), the table of eight with each
    seat's bouts won ("1 won" on a phone, where the champion's name stands down). The match
    counts as its own mode for the audience counter (`MatchMode` 'thornfray').
  - Before slice 7 gives it a door, the dev server enters a Thornfray at `/?thornfray` (a
    Guest when signed out; `import.meta.env.DEV` keeps it out of a build), and a server opens
    the kinds in progress with `THORNFRAY_UNRELEASED=1` (`server/thornfray_pool.ts`, tested;
    `.env.example`'s prose and `docs/dev-local.md`), which production never sets: compose
    never passes it, and `tests/env_wiring.test.ts` counts it among the names a developer
    sets, beside `GENERATION_PROVIDER`.
  - Checked in a browser on the local stack, one browser at a time: a whole Thornfray at
    1280 by 800 and at 844 by 390 with touch (thumbs, and taps on the demo's scenes), the
    demo's scenes at 1920 by 1080, the measures of the phone's top line taken in Chrome
    (`tests/bout_text.test.ts` holds them). `.dev/phone_measure.mjs` and
    `.dev/phone_feedback.mjs` were not run: they measure the landing's Play now and the
    feedback box, which this slice leaves alone (slice 7 opens the landing's door).
  - `scripts/e2e_thornfray.mjs` presses Back in a Lull itself (the pause menu opens, a second
    Back resumes) and leaves `scripts/e2e_nav.mjs` as it was: the nav script runs on any
    stack, the Thornfray needs the knob until slice 7. On software WebGL the page falls behind
    the snapshots and a poll from outside missed whole Lulls, so the page records what it
    shows itself (a `MutationObserver`) and presses Back from inside the moment the first
    card stands. The stills under `docs/screenshots/thornfray-*.webp` were taken on the local
    stack with the socket's messages held while a frame was drawn. The demo's scenes `bout`,
    `lull`, `lull-prize`, `lull-final` and `thornfray_end` run their HUD on the wall clock.
  - Open: the design's "the fallen watch their killer" in a One life bout. The server sends
    the killer to watch (`wa`, `server/royale_snapshot_blocks.ts watchBlock`) in Respawn alone,
    read through the Burr, which a bout leaves off, and the planet's One life sends none
    either (its `watch` message is answered by nothing yet): a fallen Lastwick seat keeps the
    view where it fell, nothing in sight (a dead champion sees nothing), under the OUT wash
    with its place, until the Lull. It needs a One life watch on the server and the wire.

### 7. The landing, the home, the News

- `src/ui/landing_modes.ts` (`'thornfray'` among `LandingWay.id`, `{ to: 'thornfray' }` in
  `LandingPlay`, the fourth row, `WAYS_LABEL` "Four ways to play"), `src/ui/landing.ts` and
  `src/ui/planet_emblem.ts` (its emblem), `src/main.ts` (`playAsGuest` routes it; no `to` may
  fall through to the 5v5 queue), `src/ui/royale_tiles.ts` and `src/ui/home_screen.ts` (its home
  tile), `src/ui/landing_presence.ts` (the presence count), `src/ui/news_entries.ts` (the News).
  The kinds turn `released: true`. ADR 0031 gains an amendment pointing to ADR 0035, and the
  canonical docs list in `CLAUDE.md` names this plan (the maintainer's edit).
- **Tests.** `tests/landing_modes.test.ts` (four ids, the words, the door), a pure route test
  for every `LandingPlay`, the presence reader's. In a browser: the gold Play now button still on
  the first screen at 844 by 390, the four rows readable, the desktop unchanged.
- As built:
  - The landing's ways in: `'thornfray'` among `LandingWay.id`, `{ to: 'thornfray' }` in
    `LandingPlay`, `WAYS_LABEL` "Four ways to play". The Thornfray's row stands third, after
    Respawn and One life and before the 5v5: the three on the Wanderseed wear the planet
    together and the 5v5 keeps its painting at the foot. Its words are the quick pick's
    (`ui/bout_text.ts`: the kicker "Wanderseed", the name, the line) and its call the new
    `THORNFRAY_CALL` "Play Thornfray", which the home's tile says too.
  - The emblem (`ui/planet_emblem.ts`, `PlanetEmblemKind`, `emblemArt`) is made from the
    pictures the planet already ships, no new file: the globe in the Dusk, the daylight globe
    cut to a Thornyard cap around its round plaza over it (`THORNYARD_EMBLEM`), the cap's rim
    burning orange where the Dusk begins and its next closing a thin gold ring inside, as the
    Lull's globe shows a bout's Thornyard. The drawn planet behind it stays the fallback. The
    quick pick in a Thornfray and the gathering's card wear it now (they wore Respawn's).
  - The route: `src/game/guest_route.ts` (`guestLoop`), pure, an exhaustive switch over
    `LandingPlay` whose default is a compile error and a throw, so no way in falls through to
    the 5v5's queue; `playAsGuest` in `src/main.ts` runs the loop it names
    (`thornfrayLoop(true)` for the Thornfray). `tests/guest_route.test.ts` walks every way in.
  - The home: a third tile in the battle royale's row (`ui/royale_tiles.ts`, `RoyaleWay`), a
    band across the row under Respawn and One life rather than a third column, which squeezed
    every name; `HomeChoice.mode` and `GameMode` gain `'thornfray'`, which `src/main.ts` runs
    as `thornfrayLoop(false)` and `nextStep` sends home once its loop is over, as the battle
    royale's.
  - The presence count stands on the Thornfray's own row, not on the line over the gold
    button, which plays Respawn and never leads to a Thornfray: `thornfrayLine` says the open
    gathering first ("Gathering now: 3 of 8. Join in."), then the people in one under way ("3
    people are playing one now."), nothing when nobody is in either, read from the same poll
    (`mountPresence(presence, thornfrayLive)`); a block it cannot trust is left out. Short
    enough for one line in a phone's column held upright (a longer first wording left "in."
    alone on a second line at 390 by 844), and cut with an ellipsis on a short screen, as the
    5v5's week.
  - Released: `released: true` on Lastwick and Starglean, so `boutPool()` and a server's pool
    hold both with no knob (`tests/thornfray_release.test.ts`). Their fingerprints move with
    the flag, which is data; no bout replay of either was ever kept, and the pinned end
    checksums do not read it. `THORNFRAY_UNRELEASED` stays, for the kinds in progress the loop
    lands `released: false`.
  - The dev server's `/?thornfray` door is gone: the landing and the home are the doors, and
    `scripts/e2e_thornfray.mjs` enters through the landing's row on any stack.
    `docs/dev-local.md` says so.
  - ADR 0031 has its amendment pointing to ADR 0035; the design's status line says the mode is
    open with its first two bouts. The canonical docs list in `CLAUDE.md` is the maintainer's
    edit and is left to him. The quick pick keeps the Thornfray as an option of
    `ui/royale_pick.ts` (its words, its emblem, no Crew row): one card for both modes.
  - The News: "Thornfray: eight champions, six bouts" on 2026-10-20, its picture the Lull
    before a second bout (the table of bushels, Starglean's Thornyard on the globe), taken on
    the local stack from a Thornfray entered through the landing's row
    (`src/ui/news_art/thornfray.webp`).
  - In a browser, on a seeded local stack, one browser at a time: the gold button stands where
    it stood at every size (1280 by 720: 627 to 675 px before and after; 844 by 390 with touch:
    337 to 385; 390 by 844: 781 to 827), no page scrolls sideways, the four rows whole inside
    the card at 11.5 px (a phone held sideways) and 12 px, with the gathering's line on one
    line; `scripts/e2e_landing.mjs` measures the four rows on every state at its three sizes
    (with `PRESENCE=1`, the Thornfray's count). The home at 1280 by 800, 1920 by 1080 and 844
    by 390 with touch: the band under the two, nothing clipped; its tile opens the quick pick
    (the Thornfray's words and emblem, no Crew row) and the gathering, whose Cancel comes back
    home. A Guest pressed the landing's row, Started now and played three bouts on one
    socket; `scripts/e2e_thornfray.mjs`, now entering by that row, saw the Lulls before a
    Lastwick and a Starglean and Back in a Lull resumed, and ran out of time once before a
    fall in Starglean raised the return globe (the walk out of the light it presses is
    slice 6's, unchanged; not run again). In the stills a Lastwick bout's start still showed
    "Three Seedfalls have landed" from the Starglean before it: `Hud.setBout` builds the
    battle royale's layer afresh but leaves the HUD's own announcement line and its queue,
    which a page behind its snapshots fills in bulk (left open, for slice 6's owner).
    `.dev/phone_measure.mjs` and `.dev/phone_feedback.mjs` were not run: both predate
    the battle royale's Play now (they wait for the 5v5's champion select and its Lock in),
    so the landing was measured by `scripts/e2e_landing.mjs` and a throwaway beside it.
    The stills: `docs/screenshots/thornfray-landing-before.webp` and
    `thornfray-landing.webp` (the ways at 1280 by 720, before and after, a gathering on),
    `thornfray-landing-phone.webp` (844 by 390) and `thornfray-home.webp` (1280 by 800).

### 8. The headless report

- `scripts/thornfray_report.ts` and `scripts/thornfray_report.mjs` (bundled to `dist-server/`
  like `scripts/royale_crews.mjs`): `--seeds`, `--from`, `--bout <id>` (one kind alone), `--dump`
  and `--merge` across processes, `--standin` (a seat that gives no order), `--prize all|next`
  (the prize's length, for the open question).
- **It prints**, per kind and over whole matches of eight house bots: the bout's length and
  whether its rule or its clock ended it; the spread of places and bushels; how often the leader
  before the Final wins, and how often a bout's winner wins the next (the Graft's weight, under
  each `PRIZE_LASTS`); the share of seconds with an enemy in reach spent fighting (the planet's
  figure beside it); takedowns, falls to the Dusk, caches gleaned per seat and per region; the
  stand-in's bushels; the cost of a tick.
- `scripts/*.ts` is outside `pnpm check`: the slice runs the report once on seeds 1 to 6 and
  puts the numbers in the PR. Slices 2 to 4 measure with it once it lands; until then their PRs
  carry the tests' figures.

## After the first release

One bout a week by the nightly creator loop, each by `docs/adding-a-bout.md` and each built from
the engine's pieces: a moving circle to hold (a `'circle'` goal, a held-time scorer), a damage
race on the Voidmaul (`systems.risings.voidmaul`, a scorer on `damage` events), carrying the Burr
(a `'carrier'` goal, a held-time scorer). Each lands `released: false`, its report numbers in its
PR, and is released by the maintainer.

Engine work, not the loop's, each with `BOUT_ENGINE_VERSION`, the golden test (or a rules bump)
and the maintainer's review: a gallery of Strikeposts (Strikeposts stand only on the 5v5 map,
through the Range's `options.range`; standing them on the planet is a new system) and duels
(hostility per pair is a combat change).

## Open for the maintainer

The design's list (`docs/design/thornfray.md`, Open for the maintainer): the prize kept all
match against the next bout only (the default), the rising arc's curve, the gathering's length
and Start now, the ladder's two awards, the Final's kind, the replays kept, Starglean in the
Cypress groves.
