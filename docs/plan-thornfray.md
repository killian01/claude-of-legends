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
