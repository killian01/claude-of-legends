# Thornfray: one sim per bout, a ledger above them

> Proposed 2026-10-20. Builds on ADR 0031 (the Wanderseed and its two variants), ADR 0032
> (Grafts) and ADR 0030 (teams). The design is `docs/design/thornfray.md`, the build
> `docs/plan-thornfray.md`, the words `CONTEXT.md` (Thornfray, Bout, Final, Bushel, Thornyard,
> Lull, Lastwick, Starglean).

On 2026-10-20 the maintainer asked for a mode of short varied rounds where points add up: eight
seats with house bots filling, a reduced part of the Wanderseed, one champion per seat all match,
five rounds of 90 to 120 s drawn from a pool then a final at double points, places paying 5 down
to 0, a ten second interlude showing the standings and the next rule, the round's winner taking
a Graft into the next; first released with two rounds built from what exists, then one new round
a week added by an automated nightly loop. A round is called a bout here (CONTEXT.md: Bout;
"round" already names the Arena's rounds), the interlude a Lull, the points bushels, the reduced
part a Thornyard. This records where the bouts live and how they chain, which every later bout
rests on.

## Decision

- **One Sim per bout.** Each bout is a whole battle royale `Sim`, built by `buildBoutSim` in
  `src/net/replay.ts` beside `buildRoyaleSim` (the one file that builds a Sim), from a seed
  derived from the match's seed and the bout's index on a salt of its own. Its eight seats are
  dealt once for the match, never from a bout's seed: the server deals them with
  `royaleSeats(people, matchSeed, 8)` in `server/thornfray_match.ts` (names, champions, skins,
  sigils) and hands the same `RoyaleSeat[]` to every bout's `RoyaleMatch`, and `buildBoutSim`
  deals the bots' skills with `boutSeatSkills(record.bout.matchSeed, 8, guestsOnly)`. Nothing
  lives inside a Sim from one bout to the next: what carries (the seat's champion, its prize
  Graft or pending prize, its bushels) is data the next build reads.
- **A bout runs on an existing variant.** A bout kind names its death rule, One life or Respawn
  (`base`), and the Sim runs that variant. `RoyaleVariant` keeps its two values; the bout is an
  optional `RoyaleOptions.bout` read by the seams that read a variant's tables today: the Dusk's
  plan (`DuskPlan`: its closings, its first cap, its edge speed, `lightOutS`), the caches (how
  many, never more than the Thornyard's spots allow, when one returns), the Seedfalls (when, how
  many at once, called how far ahead, read how far past the impact, how far apart), the Graft
  triggers and levels, the Risings' times (`systems.risings`, read by the two lines of
  `src/sim/sim.ts` that set them today), the landing (inside the first cap), the systems a bout
  turns off (the Burr, the Last light, the marks, the Upstart, the pads), the end and the
  ranking. The camps, the rings and the Warden a bout leaves out never stand: `buildBoutSim`
  hands the Sim a `planetGameMap` filtered to what the kind runs, with no new seam in `sim.ts`.
  Without the option every seam reads exactly what it reads now.
- **The Dusk's phase numbers keep their meaning.** The wire (`SnapDusk.p`: 0 calm, 1 to 5
  closing, 6 dark), the HUD, the bots, the skills' sharpening, the Clamors, Second Breath and the
  music all read the phase number. A `DuskPlan` numbers a bout's closings from the end: its last
  closing is always 5, its dark always 6, whatever the number of closings. Both dark branches of
  `duskAt` count from the plan's `lightOutS` instead of `PLAY_S`.
- **A bout's count is its own.** A bout that counts something other than takedowns keeps its
  count beside the takedown score, never in it: the bots' sharpening, the Lodestar, the
  scoreboard and the points keep reading takedowns. The count is written by the kind's
  `BoutScorer`, whose `onEvents(events, sim)` the mode feeds with every tick's events, the
  `damage` events included. The counts live on the bout's state: snapshotted, restored, and
  mixed into `Sim.checksum()` when a bout is set.
- **The ledger is in the sim, the chain in the host.** A pure module,
  `src/sim/royale/bouts/ledger.ts`, draws the six kinds and their Thornyards from the match's
  seed as one sequence (a seeded shuffle with bounded rejection, then a deterministic
  construction that always holds, so the draw never dead-ends), pays the bushels, keeps the
  totals by seat index (never unit id: each Sim mints its own), settles a tie down to a total
  order, names each bout's winner and the next bout's prize. The server, the headless report
  and the tests chain bouts through it; the server only builds the next Sim and keeps its
  clients on their seats.
- **A bout kind is data with references, over a closed engine.** `src/sim/content/bouts/<id>.ts`
  declares the contract (the design's table). What a kind brings of its own is a reference on
  it, never a case in a shared switch: its scorer (`count`, one module under
  `src/sim/royale/bouts/` when no shared scorer fits) and its goals (`goals`, each a module
  stepping goal primitives). The primitives are a closed set, `'circle' | 'carrier' | 'target'`
  (a position, a radius, a holder), observed (`ObsRoyale.bout.goals`, policy contract v0, ADR
  0002), wired (`tf.g`) and drawn (`src/render/planet_goals.ts`) by the engine for every kind.
  Its bots add one entry to `BOUT_CALLS` (`src/sim/royale/bot/bout_calls.ts`), asked after the
  fight block; in a bout the planet's Respawn errand never runs, so no errand walks a bot past a
  fight.
- **The Lull is the next bout's drop.** The ten seconds between two bouts are the next Sim's
  drop (ADR 0031's ten seconds over the globe): recorded and replayed like any drop, the landing
  pick inside the Thornyard a choice, the winner's Graft offered over the globe. The prize offer
  is exempt from `clearOffers` in a bout; one still unpicked when its bout ends is carried in the
  next record (`pendingPrize`) and offered again, unchanged. By default the prize lasts the next
  bout only (`PRIZE_LASTS = 'next'`).
- **The server hosts a Thornfray beside the battle royale, not inside it.**
  `server/thornfray_service.ts` gathers people, seats them, chains the bouts and ends the match;
  each bout is a `RoyaleMatch` of eight pre-dealt seats built by a `RoyaleSimFactory` that takes
  the bout, and the royale's snapshot, points and replay pieces are reused. The socket's
  dispatch asks it first for a client in one of its matches, then the royale's service. A
  Thornfray weighs one match on the server's capacity.
- **The wire.** Each bout's `match_start` carries the royale block as today (its `v` is the
  bout's variant, read again by the client at every bout) and a `tf` block:
  `{ b, k: kinds[], s: ownSeat, t: TableRow[8], p?: prizeSeat }` with
  `TableRow = [seat, unitId, name, championId, bot 0|1, bushels, last, won]`, sent at every
  bout's start and on a rejoin, so a client that rejoins during a Lull has the whole table.
  Each snapshot's royale block carries an optional `tf` (the seat's count and place, the best
  count, the goal primitives `g`), sent through `sentOnChange` and reset per bout. The match's
  end sends `thornfray_result` once, with the six bouts' replay ids. No `royale_result` is sent
  for a bout. A client that does not know `tf` ignores it.
- **Replays.** Each bout is saved as its own replay under a numeric id from
  `deps.newMatchId()`, served by the replay route and pruned by the store like any other; a
  running Thornfray's ids are passed with the held ids, so no bout's replay is pruned while its
  match plays.
- **Versions.** The engine lands without moving `ROYALE_RULES_VERSION`.
  `tests/royale_golden.test.ts`, written before any seam moves, pins the battle royale's
  `sim.checksum()` at 60 s and at the end (seed 7 in Respawn and in One life, Solo; seed 5 in
  Trios, One life) as captured on c456598, and the rules version moves only if those numbers
  move: a bout's record is refused by its own versions anyway, and a needless bump would throw
  away the forty kept replays. A bout's record (`RoyaleRecord.bout`) carries the match's seed,
  the bout's index, kind and Thornyard, the Graft each seat carries in, the pending prize, and
  three versions: the kind's own `version` (its modules), its computed `boutFingerprint`
  (`fingerprintOf` from `src/sim/content/fingerprint.ts` over the kind's data) and
  `BOUT_ENGINE_VERSION` (the seams, the ledger, the shared scorers, the brain's bout branch).
  `royaleReplayPlayable` checks all three. The fingerprint moves by itself with any data change;
  the code it cannot see (functions are left out of `canonical()`) is held by
  `tests/thornfray_bout_versions.test.ts`, which pins each released kind's first bout and its
  Final on seed 1 at their ends (checksum, counts, ranking, bushels, the prize's cards, the
  prizes left open, the Grafts picked) and the engine's shared data (the rising arc of every
  bout, the bushels, the prize), so any drift fails CI until the right version moves.
  `REPLAY_VERSION` and the content fingerprint do not move: the 5v5 runs none of this.

## Considered and rejected

- **One Sim for the whole match, reset between bouts.** The mode would have to revive the
  fallen and set back every level, item, status, score, cache, ring and objective, redraw the
  Dusk's schedule and the Seedfalls' calls (fixed for a match today and outside the
  checkpoint), and hold `sim.winner` unset until the Final. Each of those is a place a replay
  could drift from the match it recorded; a fresh Sim has none of them.
- **A third variant.** `RoyaleVariant` is read as a pair at some forty places across the sim,
  the server and the client (`=== 'respawn'`, `!== 'one_life'`, two-way ternaries): a third
  value would fall silently to one side of each. Only the typed tables would refuse it at
  compile time.
- **Bouts inside the royale's service.** It holds one Sim for a match's life (its ending, its
  linger, its places, its points' end latch), seats people straight into a running match with
  no gathering, and branches its end on the variant. A Thornfray's chain would have been
  threaded through all of it.
- **Scoring on the server alone.** The headless report, the replay and the tests would each
  have needed their own copy, and a bot could not read a bout's goal from its observation.
- **The Lull as a pause with no Sim, or a frozen one.** Neither is recorded, the frozen one
  ticks for nothing, and neither leaves the person a choice; the drop is all three.
- **Fifty seats.** A short bout needs contact in its first seconds and a table a person can read
  at a glance: eight seats on a Thornyard of about 5,000 m2 give both.
- **A goal module per kind with its own wire and drawing.** Each new goal would have touched the
  policy's goal union, the wire, the snapshot builder, the client's reader and three renderers:
  a week's work, not a night's. A closed set of primitives drawn and wired once keeps a kind to
  its own files.
- **Kind versions moved by hand alone.** Kinds share the counters, the end, the plan and the
  brain's branch; a hand-kept number misses a shared change. The computed fingerprint, the
  engine's version and the pinned end checksums catch what a hand would miss.
- **Moving `ROYALE_RULES_VERSION` for the engine on principle.** It would refuse every kept
  battle royale replay for a change the golden checksums show does not touch them.
- **Drawing the bouts one at a time.** A greedy draw dead-ends (two kinds taken twice and the
  third just played leave no sixth bout), and a kind held to one region has nowhere to go after
  a bout there.

## Consequences

- The battle royale's two variants are unchanged, match for match, in every crew size, and a
  test says so: `tests/royale_golden.test.ts` pins their checksums as captured before the
  engine, beside the seed 7 matches of `tests/royale_match.test.ts`, the replay of
  `tests/royale_contract.test.ts` and the checkpoint of `tests/royale_rules.test.ts`.
- A Thornfray's replay is its six bouts' records, each played on its own under its own numeric
  id; the Lull's table is rebuilt from them through the ledger. `Sim.checksum()` mixes a bout's
  per-seat counts, so a bout's replay notices a count drifting; a battle royale's checksum is
  unchanged.
- The fifty seat tunings a bout would break are read through the bout's data while a bout runs:
  One life's pace and calm nerve, the cornered distance, the Dusk margin, the escorts, the
  Seedfall spacing (now every seed of a burst against every other), the cache count,
  `placeReason`'s fifty places.
- The client reads a bout's rule set at every `match_start`: both match cameras exist for a
  Thornfray and run by the bout, and the HUD's rules move with `Hud.setBout`.
- `PointsReason` gains the Thornfray's two end awards; bushels are never banked.
- `CORE_ON_THE_PLANET` (`tests/architecture.test.ts`) reads every file under `src/sim/royale/`
  from the directory, so a new module is guarded without an edit.
- Forty kept replays hold fewer than seven Thornfrays; the keep is the maintainer's call.
- Remote and headless policies still cannot play on the planet (ADR 0032).
- A new bout built from the engine's pieces is a data file, at most two small modules, a bot
  entry and a test: the creator loop's one night, with no shared version to move. A bout that
  needs a new primitive, a new system on the planet or a combat change (a Strikepost gallery,
  duels) is engine work: `BOUT_ENGINE_VERSION`, the golden test, the maintainer's review.
