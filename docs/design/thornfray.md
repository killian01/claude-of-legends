# Thornfray, eight champions in six bouts

Status: built, and opened with its first two bouts, Lastwick and Starglean (slice 7 of the
plan). The decision record is ADR 0035; the build is `docs/plan-thornfray.md`; the words are in
`CONTEXT.md` (Thornfray, Bout, Final, Bushel, Thornyard, Lull, Lastwick, Starglean). Every number
below is a first pass, measured and tuned by the slices that land it.

## What it is

A match of short bouts on the Wanderseed. Eight champions, house bots on every seat no person
takes, land on a Thornyard (a small cap of the planet around one region's heart) and play a bout
of 90 to 120 seconds to its own rule: the last one standing, the most caches gleaned, and one
new kind each week. Each bout pays bushels by place, five to the first down to none for the last
three. Five bouts, then the Final, where the bushels count double. The most bushels wins the
Thornfray.

Each seat keeps one champion, skin and pair of sigils for the whole match. Between two bouts a
ten second Lull over the globe shows everyone's bushels and the next bout's rule in one line,
and the last bout's winner picks a Graft it plays the next bout with.

It is the fourth way to play on the landing, beside Respawn, One life and the 5v5.

## Why it plays well

- **Nothing is lost for long.** A bad bout costs at most five bushels (ten in the Final), and a
  minute and a half later a new one starts with everyone level again: the same level, the same
  number of pieces, full health, and one Graft at most among the eight. A battle royale lost in
  its second minute is a match lost; a bout lost in its second minute is a sixth of one.
- **The end stays open.** The Final pays ten to its winner and nothing to the last three, so a
  seat nine bushels behind the leader after five bouts still wins by taking the Final while the
  leader falls sixth or lower. The table at every Lull says exactly what is still possible.
- **One champion, many asks.** Lastwick asks for fights, Starglean for routes and contests, the
  bouts that follow for holding ground, hitting a creature, carrying, aiming and dueling. The
  same kit read six ways is how a champion is learned, and two Thornfrays on the same champion
  never play alike.
- **Contact in seconds.** Eight champions on a Thornyard of about 5,000 m2 have some 630 m2 of
  ground each, and a champion crosses the Thornyard in about twenty seconds: the first fight of
  a bout comes within its first quarter, where fifty champions land over the whole planet.
- **A champion that grows with the match.** Every seat lands each bout at the level and with the
  pieces the bout's number gives (level 6 and the ultimate in the first, level 11 in the Final),
  so the story of a battle royale's build is told across the bouts, with nobody fed ahead of
  the others by the bout before.
- **Rivals with names.** Eight seats, the same eight all match: by the third Lull a person
  knows who took the last bout, who is two bushels behind, and which bot plays the Fenn that
  keeps winning the fights.
- **A prize that shows at once, and only once.** The bout's winner chooses its Graft over the
  very next globe and plays the next bout with it; the bout after, it lands level again, so a
  run of wins never compounds.

## Names

Every name was searched on 2026-10-20 five ways, as ADR 0004 asks: "<name> game", "<name> game
mode", "<name> video game", "<name> champion" and "<name> character". The last two catch what
the first three cannot: a champion's or a hero's name in another game. The rule the searches
apply:

- **A name** (a mode, a bout, a place, anything game text writes as a proper noun) passes only
  with no match a player could know: no game, mode, champion, hero or playable character by it.
  Thornfray, Thornyard, Lastwick and Starglean are original compounds with no match.
- **A plain word** kept lowercase in game text, as a count or a span, passes unless it is a
  champion's or a hero's name in a game, which is how it would recall one. Bout, Final, bushel
  and Lull passed.

The maintainer's working names (rounds, Last Standing, Seed Race) were left: "round" already
means the Arena's hourly rounds and a jungler's round of the camps, and the other two are plain
descriptions rather than names.

- **Thornfray**: thorn and fray, a fight among the thickets; the planet is a seed of the Star
  Orchard, its fights grow in its hedges.
- **Bout**: one short contest of the match.
- **Thornyard**: the yard the Dusk hedges in for a bout, thorns all round.
- **Bushel**: what a place pays, the measure an orchard's harvest is counted in.
- **Lull**: the breath between two bouts.
- **Lastwick**: the last wick still burning as the Dusk snuffs the others.
- **Starglean**: gleaning what falls from the Star Orchard.

## The match

### Entering

A person presses Thornfray on the landing (a Guest, ADR 0024) or on the home's battle royale
tiles (an account). The quick pick opens as for the battle royale (ADR 0031: champion, skin,
two sigils, Random) with no Crew row: a Thornfray is played Solo. Play sends the person to a
**gathering**.

The gathering is the planet's first wait: a card that says "Thornfray · 2 of 8 people ·
starts in 14 s". The first person to enter opens one; whoever enters while it gathers joins it.
It starts when eight people are in, when its 20 seconds run out, or when its opener presses
Start now. The eight seats are then dealt once for the whole match from the match's seed, as
the battle royale deals its seats (`royaleSeats`, `server/royale_seats.ts`: the house bots'
names, champions, skins and sigils), and the bots' skills once from the same seed
(`royaleSeatSkills`, `src/sim/royale/fill.ts`): four gentle, three normal, one strong, softer
when only Guests play. No bout deals them again.

A person who enters while a Thornfray runs can still take a bot's seat at the Lull before the
second bout: the seat with the fewest bushels (the lower seat on a tie), its bushels kept, its
champion replaced by the person's from then on. After that a Thornfray takes nobody new. A
person who leaves is played by the seat's bot (its skill) until they come back, at any moment,
to the same seat.

### Six bouts, each a Lull and a play

```
gathering (up to 20 s)
Lull 1 (10 s) -> bout 1 (90 to 120 s)
Lull 2 (10 s) -> bout 2
...
Lull 6 (10 s) -> the Final (bushels x2)
end screen
```

A Thornfray lasts about twelve minutes, about as long as a battle royale.

The six kinds and their Thornyards are drawn together at the start, from the match's seed on a
stream of their own, as one sequence that holds three rules: never the kind just played; once
the pool holds three kinds or more, never a kind three times in a match; each Thornyard around
the heart of a region the kind allows, never the region just played unless the kind allows no
other. The draw shuffles the whole sequence and retries a bounded number of times, then falls
back to a construction that always holds (the shuffled pool in a cycle, each kind on the first
of its regions that is not the last one played), so it never dead-ends: drawn one bout at a
time, two kinds taken twice each and a third just played would have left no sixth bout. With
the first release's two kinds the bouts alternate, Lastwick or Starglean first by the seed;
every kind added widens the draw.

### The Lull

The ten seconds before each bout are that bout's drop (ADR 0031): over the globe, the Thornyard
lit on it and the rest of the planet in the Dusk. From the second Lull on, its first two seconds
are the last bout's end beat (its spotlight call, "LASTWICK · Wren"); then the Lull's card
stands beside the globe:

- its head: "Bout 3 of 6 · Starglean", the bout's rule in one line ("Most gleaned wins: a
  Seedfall cache counts three"), and the clock ("Lands in 7");
- the table: the seats in order of bushels, each with its place, portrait, name (a bot with
  its bot mark), the bushels the last bout paid it ("+4") and its total; all eight on a
  desktop, five on a phone (The HUD and the phone);
- the prize line: "Wren took Lastwick and picks a Graft".

A tap or a click on the globe picks where the champion lands inside the Thornyard, as the drop's
pick does; no pick lands somewhere quiet inside it. The bots pick too, inside it. The first
Lull's table is everyone at nothing; the sixth says "The Final: every place pays double".

### The bout

Every seat lands together at the Lull's end, fresh: full health and mana, the bout's level and
pieces, the prize Graft if it won the bout before. The bout runs to its own rule and ends by it
(the last one standing, or its clock). The first tick a bout ends the next Lull begins; nothing
waits between them.

The Dusk's burn reaches health past every shield in a bout. It leaves the clock of the last hit
alone, as on the planet, so a shield that comes back after a calm (Korrath's Shieldskin) came
back every tick under it and held it off for good: a Korrath standing in the dark won Lastwick.

### Bushels

| Place | 1st | 2nd | 3rd | 4th | 5th | 6th to 8th |
|---|---|---|---|---|---|---|
| A bout | 5 | 4 | 3 | 2 | 1 | 0 |
| The Final | 10 | 8 | 6 | 4 | 2 | 0 |

Every bout ranks all eight seats, ties settled by the bout's own tie-breaks down to the seat's
index, so every place is paid once. After the Final the most bushels wins; on a tie, more bouts
won, then the better place in the Final (always distinct). The most a seat can reach is 35.

### The prize

A bout's winner is offered three Boughs (ADR 0032's draw: distinct, its role's twice as likely,
never one it holds) over the next Lull's globe. They are drawn on a stream of their own from the
bout's seed, so what the seats decide never moves them: a Lull built again for a late person
offers the same three. The offer waits until it picks and folds into a chip in a fight like
every offer. The Graft lasts the next bout only (`PRIZE_LASTS = 'next'` in
`src/sim/content/bouts/match.ts`): the bout after, the seat lands without it, so one Graft at
most stands among the eight, and a run of wins earns a new edge each time rather than a
growing one. The Final's winner has no next bout and gets no prize.

The prize is never lost to timing. In a bout the prize offer is exempt from `clearOffers`
(One life's elimination clears every other offer), so a winner who falls before picking keeps
it open. An offer still unpicked when its bout ends is carried in the next bout's record
(`RoyaleRecord.bout.pendingPrize`: the seat and its three cards) and offered again, unchanged,
at the next Lull; the Graft picked from it then lasts that bout. No other Graft offer comes in a
Thornfray: no drop Bough, no level, cache or takedown trigger. A bot picks by the house rule
(`src/sim/royale/bot/graft_pick.ts`).

### The rising arc

Each bout seats every champion at the same level, its points spent and its ultimate ranked by
the usual rule, with the same number of pieces of its own planet build (`grantPieces`):

| Bout | 1 | 2 | 3 | 4 | 5 | Final |
|---|---|---|---|---|---|---|
| Level | 6 | 7 | 8 | 9 | 10 | 11 |
| Pieces | 2 | 4 | 6 | 8 | 10 | 12 |

A bout's own takedowns, assists and caches still give experience and pieces as on the planet,
so a bout's fights still grow the champion while it lasts; the next bout sets everyone level
again. Landing at level 3 with no ultimate, as the battle royale does, would give every bout
the opening minutes of a battle royale and none of its fights.

### The end

After the Final the end screen (the battle royale's, `src/ui/end_screen.ts`) says the place
("2nd of 8"), the bushels and bouts won, the ladder points the match banked, and the table:
every seat's place, portrait, name, bushels and bouts won, and on a desktop each bout's place
for the person's seat ("Lastwick 1st +5", "Starglean 4th +2"). Its buttons: Play again (a new
gathering, the same pick), Battle royale (the Respawn quick pick), Home.

### Points to the ladder

Thornfray scores on the ladder like the battle royale (ADR 0027, ADR 0031), at the same weight
(another person in the match doubles it): during each bout, a takedown 10, an assist 5, a cache
1; at the end, to a seat still playing that gave an order in the last three minutes, 40 to the
Thornfray's first and 20 to its second and third (two new reasons, `thornfray_first` and
`thornfray_top_three`). Bushels are never banked: they decide the match, the points are the
ladder's. One life pays its 50 to one seat in fifty; a Thornfray's first is one in eight, and
pays less.

## The bout contract

A bout kind is one data file, `src/sim/content/bouts/<id>.ts`, registered in one line of
`src/sim/content/bouts/index.ts`. Everything a bout needs is declared there, and what a kind
brings of its own (a scorer, a goal) is a reference on it, so no shared switch is edited for a
new kind. The engine (slice 1) ships the whole contract: every field below is read by a seam
that already exists when the first kind lands.

| Field | What it declares |
|---|---|
| `id` | The kind's id, the record's and the wire's (`'lastwick'`). |
| `name` | Its name in game text (`'Lastwick'`), searched for IP and in `CONTEXT.md`. |
| `rule` | The rule in one line, under 40 characters: the Lull's head and the win line. |
| `card` | Two or three short lines for the bout's card at the landing. |
| `version` | The version of the kind's own modules (its scorer, its goals), recorded with each bout it plays. Its data is fingerprinted on its own (ADR 0035, Versions). |
| `released` | In the pool or not; a kind in progress stays out. |
| `base` | The death rule: `'one_life'` (out for the bout) or `'respawn'` (back in five seconds). |
| `playS` | Seconds from landing to the bout's clock end, 90 to 120. |
| `thornyard` | Its chord radius and the regions it may stand in (all six when absent). |
| `dusk` | Its closings inside the Thornyard (radius, closing, hold, burn), numbered from the end; its edge speed; the burn outside the Thornyard before the first closing; when the light goes out (`lightOutS`). |
| `systems` | Which of the planet's systems run (caches, pads, Seedfalls, the Burr, the Last light, the marks, the Clamors, the Upstart), off unless named; and the Risings with their times, `risings: { pyrefang?: atS; voidmaul?: atS; warden?: atS }`, none when absent. |
| `caches` | How many stand at landing inside the Thornyard (golden spot first), never more than its spots allow, and when an opened one returns (never, or seconds). |
| `seedfalls` | When they land (`at`), how many seeds at once (`seeds`), how far ahead they are called (`warnS`), how far past the impact the light is read for placing them (`forecastS`), how far every seed of a burst stands from every other (`apartM`) and how deep inside the light (`depthM`). |
| `goals` | The goals the kind stands on the planet, each a module stepping goal primitives (a circle, a carrier, a target); absent when none. |
| `count` | The kind's scorer: a shared one (survival, gleaned, held time) or its own module, fed every tick's events. |
| `ties` | The tie-breaks after the count, in order, ending on the lower seat. |
| `bots` | The data its bots read: the errand's id (one entry of `BOUT_CALLS`), the call's health floor and reach, the Dusk margin, the cornered light, the pace (none, or a curve over eight seats). |
| `hud` | The count's word for the top line (`'gleaned'`, `'left'`) and whether the count is a place or a number. |

What every bout shares and no kind declares: eight Solo seats dealt once, the drop as its Lull,
the rising arc, the prize, the bushels, the planet's tuning, the house build, the bots' brain.

The sketch the first slice writes (names may move in review):

```ts
export interface BoutKind {
  id: BoutKindId;
  name: string;
  rule: string;
  card: readonly string[];
  version: number;
  released: boolean;
  base: RoyaleVariant;
  playS: number;
  thornyard: { radius: number; regions?: readonly RegionId[] };
  dusk: BoutDusk; // closings from the end, edgeSpeed, burnBefore, lightOutS
  systems: BoutSystems; // risings?: { pyrefang?: number; voidmaul?: number; warden?: number }
  caches: { count: number; backS: number | null };
  seedfalls?: BoutSeedfalls; // at, seeds, warnS, forecastS, apartM, depthM
  goals?: readonly BoutGoal[];
  count: BoutScorer;
  ties: readonly BoutTie[];
  bots: BoutBots;
  hud: { word: string; place: boolean };
}

// The closed set of goal primitives: observed, wired and drawn by the engine.
export type GoalShape = 'circle' | 'carrier' | 'target';
export interface GoalPrimitive {
  shape: GoalShape;
  at: Vec3;
  radius: number;
  holder: number | null; // a seat index
}

// A kind's goal: steps its primitives on the bout's stream.
export interface BoutGoal {
  id: string;
  start(bout: BoutView, rng: Rng): void;
  step(bout: BoutView, events: readonly SimEvent[]): void;
  primitives(bout: BoutView): readonly GoalPrimitive[];
}

// A kind's count: fed every tick's events by the mode, writing the bout's counts.
export interface BoutScorer {
  id: string;
  onEvents(events: readonly SimEvent[], sim: BoutView): void;
}
```

The bout's counts and its goals' state live on the bout's state in the royale mode, so they are
snapshotted, restored and mixed into `Sim.checksum()` with the rest. A scorer reads every event
the tick emits, the `damage` events included, which is what a damage race needs.

### How a bout numbers the Dusk's phases

The phase number is a contract the whole game reads: the wire says "0 calm, 1 to 5 closing, 6
dark" (`SnapDusk.p`), the HUD reads `p >= 6` and `p === 0`, the bots read phase 0 as the calm,
and the skills' sharpening, the Clamors, Second Breath's offer and the music read thresholds on
it. A bout keeps that meaning by numbering its closings from the end: its last closing is
always phase 5 and its dark always 6, so Lastwick's three closings are phases 3, 4 and 5, and
Starglean's one closing is phase 5. Every threshold then reads how near the end the light is,
which is what each of them means. The dark's end and burn count from the plan's `lightOutS`,
never the planet's `PLAY_S`. During a bout's phase 0 the outside of the Thornyard already burns,
so the HUD's Dusk line says so ("Outside burns · Dusk in 0:14") when the phase is 0 and the burn
is above nothing.

## Lastwick

The last one standing, fast. One life's death: a fall is out for the bout.

| | |
|---|---|
| Base | One life |
| Thornyard | Chord radius 40 m (about 5,030 m2, a sixteenth of the planet), any region |
| Clock | The light goes out 92 s after landing (`lightOutS`); the bout ends when one champion stands, about 100 s at the latest; its clock (`playS`) at 120 s only a backstop |
| Dusk | Calm to 20 s (outside the Thornyard burns 3 percent of maximum health a second). Phase 3 closes to 26 m from 20 to 35 s, holds to 45 (4 percent); phase 4 to 14 m from 45 to 60, holds to 70 (7 percent); phase 5 to 5 m from 70 to 82, holds to 92 (12 percent); then phase 6, dark, 12 percent a second and 12 more every 10 s. Edge speed 1.1 m/s, against the planet's 0.74 |
| Caches | 12 at landing (the golden spot inside first), never back; every region has at least 16 spots within 40 m of its heart |
| Off | Seedfalls, Risings, camps, pads, the marks, the Reprieve |
| On | The Clamors, the Dusk's burn, One life's placing |
| Count | Survival: the order of the falls, champions falling on one tick placed by the health they had the tick before (`placeFallen`), the last standing first |
| Ties | Health before the fall, then the lower seat |
| HUD | "Lastwick · 0:41 · 5 left", win line "Last one standing wins · Bout 2 of 6" |
| Card | "Last one standing wins", "A fall is out until the next bout", "The light closes fast: keep inside it" |

The Dusk's first cap is the Thornyard itself instead of the whole planet, and its caps are drawn
forward from the Thornyard's heart toward a final point inside it (`src/sim/royale/dusk.ts`
`drawPlannedDusk`), each slide within what the edge speed allows. Each closing shrinks about a
meter a second; a champion walks 3.7 m/s, so the light is outrun easily and fought over always.
Its data is `src/sim/content/bouts/lastwick.ts`.

## Starglean

The most gleaned, in bursts. Respawn's death: a fall costs five seconds, the champion back at
the edge of the light or where a tap on the globe picked (ADR 0031), in its Grace.

| | |
|---|---|
| Base | Respawn |
| Thornyard | Chord radius 40 m, any region |
| Clock | 105 s from landing; the most gleaned then wins |
| Dusk | Calm to 60 s (outside the Thornyard burns 4 percent a second). Phase 5 closes to 26 m from 60 to 75 s and holds past the clock, to 120 s (`lightOutS`: the clock and the Seedfalls' forecast), at 6 percent. Edge speed 1.1 m/s |
| Caches | Up to 18 at landing, never more than the spots inside the Thornyard less six kept free for the Seedfalls: 18 in the Ruins and the Sanctuary, 14 in the Lakes, 13 in the Cliffs, 12 on the Open ground, 10 in the Cypress groves. The golden spot first; opened in 1.5 s as on the planet, back 30 s after opened |
| Seedfalls | Bursts of three seeds landing 25, 55 and 85 s after landing, each called 12 s ahead, placed in the light as it will stand 15 s past the impact (`forecastS`), every seed at least 18 m from every other of its burst and 8 m inside the light; the impact and the Seedfall cache as on the planet (3 s to open, Respawn's held opening) |
| Off | Risings, camps, pads, the Burr, the Last light, the marks, the Upstart |
| On | The Clamors, the globe's return pick, the Grace |
| Count | Gleaned: a cache 1, a golden cache 2, a Seedfall cache 3; a takedown moves 1 from the fallen to its taker (none from a fallen at 0) |
| Ties | More Seedfall caches opened, then fewer falls, then the earlier tick its count was reached, then the lower seat |
| HUD | "Starglean · 0:48 · 7 gleaned, 2nd", win line "Most gleaned wins · Bout 3 of 6" |
| Card | "Most gleaned wins", "A cache counts 1, golden 2, a Seedfall 3", "A takedown takes one from the fallen" |

The gleaned count is the bout's own, kept beside the takedowns: the takedowns still move a
seat's level and loot, and the bots' sharpening still reads takedowns. A Seedfall burst draws
its three points from the sim's stream on its call tick, as the planet's Seedfalls do, with
`drawSeedfallPoints` generalized to N seeds: each seed comes from the free cache spots deep
enough inside the forecast light and at least `apartM` from every seed drawn before it, and
when those run out, from walkable ground on a seeded ring inside the same light, so a burst
never stacks two seeds on one point. Expected per bout, to be measured: 30 to 40 caches and 9
Seedfall caches opened in all, the winner near 12 to 15. Its data is
`src/sim/content/bouts/starglean.ts`, its count the shared `gleanedScorer`
(`src/sim/royale/bouts/count.ts`).

## How a person plays a bout

- **Lastwick.** The Lull: read the table, see the Thornyard on the globe, tap a landing (near a
  golden cache, or away from the crowd). Land at level 6 or more with an ultimate; open a cache
  or two in the calm; the light starts closing at 20 s and the burn outside is real from the
  first second. Fight or wait out the fights of others; a fall is out for the bout, and the
  fallen watch their killer (the One life Death beat) until the bout ends, their place already
  paid on the table. The last one standing takes five bushels and the Graft.
- **Starglean.** Land near caches; open them while the Seedfalls are called (the globe's call
  and the minimap mark, 12 s ahead, three at once). A Seedfall cache takes 3 s and is worth
  three; the crowd that comes for it is the bout's fight. A fall costs five seconds and one
  gleaned; the globe's tap picks the return. The top line always says the seat's count and
  place.
- **Every bout.** The bout's card at the left says the rule for a few seconds at the landing;
  the win line keeps it said. The x2 pill stands beside the count in the Final.

## How a bot plays a bout

A bot plays every rule a person plays, from the same public signals (ADR 0031: the
observation's royale block), and fights on sight in every bout.

- **The observation.** An additive block, `ObsRoyale.bout` (policy contract v0): the kind, the
  bout's index and count, the double flag, the seat's own count and place, the best count, and
  the kind's goal primitives (`goals`, absent when none). Nothing in it is hidden from a person:
  the HUD reads the same numbers.
- **The landing.** In a bout `pickDropPoint` (`src/sim/royale/bot/drop_pick.ts`) picks inside
  the phase 0 cap the observation shows, the Thornyard, spread around its center; never across
  the planet's regions.
- **The fight comes first, always.** On the planet, Respawn's Seedfall errand (`seedfallErrand`,
  open from 35 percent health) walks a bot past fights it did not strike in (`errandPast`,
  asked before the fight block) and on past a fight it passed on (`errandWalk`). In a bout
  neither runs: both return null when `r.bout` is set. The bout's own errand,
  `BOUT_CALLS[kind]` in `src/sim/royale/bot/bout_calls.ts`, is asked only after the whole fight
  block, where the planet's calls are asked: a bot with an enemy in sight decides that fight by
  its odds first, every time, and only a bot that passed on it by those odds walks on.
- **Lastwick's bots** play One life's brain with the bout's data in place of the fifty seat
  tunings: no calm nerve and no pace (the pace's curve counts fifty seats; held against eight
  it would ask for odds no fight shows, and nobody would fight), a Dusk margin of half the
  skill's (the Dusk closes faster), a cornered light of 8 m (under the planet's 20 m a bot
  stops fleeing and takes any fight, which would hold from the bout's second closing, half the
  bout). Its errand is none: the fights and the light are the bout.
- **Starglean's bots** glean: their errand (`glean`) walks to a called Seedfall anywhere in the
  Thornyard for a bot at 40 percent health and more, takes a cache in sight before a roam, and
  holds a Seedfall cache's opening as the held opening allows. A bot at 45 percent health on a
  called Seedfall with an enemy within 6 m fights it first; a bot under its floor fights or
  flees by the brain's odds as ever. Once a seed has landed, a bot nobody is striking steps into
  its cache from a step away and begins the held opening, the one rule asked before the fight
  block; the seed it walks to is the one it would reach first as far as it sees (as built,
  `docs/plan-thornfray.md` slice 4).
- **The prize** is answered by the Graft pick already in the chain's first step.

## The HUD and the phone

New words come from pure modules beside `src/ui/royale_text.ts` (`bout_text.ts`,
`bout_card.ts`, `bout_rules.ts`, `lull_model.ts`, `thornfray_end.ts`), each tested; the HUD
coordinator only places them.

- **One match layer, a rule set per bout.** A Thornfray is one guarded layer across every bout
  (Back during a Lull or a bout opens the pause menu), but its bouts switch between One life
  and Respawn. The client reads the variant from each bout's `match_start` (`royale.v`), never
  once for the match: both cameras (Respawn's Death beat, `BeatCamera`, and One life's watch,
  `CrewCamera`) are built, each running only in a bout of its rule, and the HUD's rule set moves
  with `Hud.setBout(variant, kind)`, read from the pure `src/ui/bout_rules.ts` (the return globe
  and its pick, the wash, the Death beat, the count's word). Starglean after Lastwick has its
  return globe; Lastwick after Starglean has none.
- **The top line** (`.br-head`): the bout's name, its clock, and its count ("Lastwick · 0:41 ·
  5 left", "Starglean · 0:48 · 7 gleaned, 2nd"). On a phone held sideways the compact line keeps
  inside its 380 by 52 px box at the center (`COMPACT_TOP_LINE_HALF_W_PX`): the count drops its
  word before the box overflows.
- **The win line** (`.br-sub`): the rule and the bout's number ("Most gleaned wins · Bout 3 of
  6"); in the Final, "· the Final" and the x2 pill (`doubleBadge`).
- **The bushels chip**: "17 bushels · 2nd" in the leader badge's slot.
- **The bout's card**: the win card (`src/ui/royale_win_card.ts`) with the kind's title and
  lines, restarted at each bout's landing, its clock counted from that landing.
- **The bout's end**: a spotlight call ("LASTWICK · Wren") held two seconds at the start of the
  next Lull. The next bout's `match_start` has reset the world by then, so the call is read from
  the table's last winner, never from the ended bout's units.
- **The Lull's card**, on a phone at 844 by 390, stands inside the free column the Respawn wait
  already keeps (`returnWashPhoneBox`, `src/ui/royale_return.ts`): from x 84 (right of the
  thumbs bar, x 8 to 76) to x 305 (where the globe's column starts, `returnWashColumnPx`), from
  y 44 to y 226 (the bottom 164 px are the notices' and the touch bar's,
  `RETURN_WASH_PHONE_BOTTOM_PX`), 182 px tall. It holds a 40 px head, five rows of 22 px (the
  top three, then the seat above the person's and the person's own; the 4th and 5th when the
  person is in the top four) and an 18 px prize line, 168 px in all. While the prize winner's
  Graft cards are open (x 81 to 763, y 62 to 222) the card folds to its head: `.lull` joins
  `CARDS_ASIDE` (`src/ui/royale_grafts.ts`). On a desktop the full table of eight rows of 28 px
  stands left of the globe. No buttons: the Lull ends by itself. It never sets the page's
  overlay state (the touch controls stay for the globe's tap) and never unguards the match's
  layer.
- **The end screen**: the battle royale's, three buttons 44 px tall on a phone.
- **The landing**: a fourth row under "Four ways to play", with its own emblem; the gold Play
  now button stays on the first screen at 844 by 390 (`.dev/phone_measure.mjs`).

The Lull card's box is pinned by a `lullBox` overlap test beside
`tests/royale_cards_room.test.ts`, at 844 by 390 and the four desktop sizes (960 by 540, 1280
by 720, 1366 by 768, 1920 by 1080), then checked with `.dev/phone_measure.mjs` and
`.dev/phone_feedback.mjs` at 844 by 390 with touch, and `DESKTOP=1` that the desktop did not
move, one browser at a time.

## Adding a bout

The guide the creator loop follows, step by step with Lastwick's choices, is
`docs/adding-a-bout.md`; this is its outline.

A kind built from the engine's pieces (a Dusk plan, the systems and the Risings' times, the goal
primitives, a scorer over the tick's events) is one night's change for the creator loop: a data
file, at most two small modules, one bot entry, one test file, and the words. Nothing shared
moves, so neither the planet's rules version nor the engine's does. The checklist, in the order
the work goes:

1. **The name.** An original compound or a plain word, searched five ways ("<name> game",
   "<name> game mode", "<name> video game", "<name> champion", "<name> character") with the
   checks in the PR's body. A name passes only with no game, mode, champion, hero or playable
   character by it; a plain word kept lowercase passes unless it is a champion's or a hero's
   name. Never a borrowed name, nor one that recalls one (ADR 0004); the PR never names the game
   a rejected name came from. Its `CONTEXT.md` entry beside Lastwick and Starglean, with its
   `_Avoid_` line.
2. **The data.** `src/sim/content/bouts/<id>.ts` with every field of the contract and
   `version: 1`, `released: false` until its last step; one line in
   `src/sim/content/bouts/index.ts`. Planet rules: out of the content fingerprint, like
   `royale_tuning.ts`; the kind's own fingerprint is computed from it.
3. **The count**, only when no shared scorer fits: `src/sim/royale/bouts/score_<id>.ts`, a
   `BoutScorer` whose `onEvents(events, sim)` the mode feeds every tick, pure, writing only the
   bout's counts; referenced from the kind's `count`.
4. **The goal**, only when the bout stands something on the planet:
   `src/sim/royale/bouts/goal_<id>.ts`, a `BoutGoal` stepping primitives (`'circle'`,
   `'carrier'`, `'target'`) on the bout's stream; referenced from the kind's `goals`. The
   observation (`ObsRoyale.bout.goals`), the wire (`tf.g`) and the renderers
   (`src/render/planet_goals.ts`: the planet, the globe, the minimap) already carry every
   primitive; the kind touches none of them.
5. **The bots.** One entry in `BOUT_CALLS` (`src/sim/royale/bot/bout_calls.ts`) answering the
   goal from the observation alone, asked after the fight block; its numbers in
   `src/sim/content/bots/bout_skills.ts`.
6. **The gates.** `CORE_ON_THE_PLANET` (`tests/architecture.test.ts`) reads every file under
   `src/sim/royale/` from the directory, so a new module is guarded with no edit; the kind's end
   checksum, counts and ranking on seed 1 are pinned in `tests/thornfray_bout_versions.test.ts`.
7. **The test**, `tests/thornfray_bout_<id>.test.ts`, on the shared bout harness
   (`tests/thornfray_fixture.ts`): eight house bots on seeds 1 to 3 end the bout within its
   clock and fifteen seconds; the ranking is total and follows the count; the count counts what
   the rule says on a staged scene; the errand walks to the goal and a bot in reach of an enemy
   still fights; a replay of the bout matches its checksum and its counts.
8. **The measure.** `node scripts/thornfray_report.mjs --bout <id> --seeds 6`: its length
   against 90 to 120 s, the spread of its places, the fighting share against Lastwick's, its own
   counts; the numbers in the PR.
9. **Release.** `released: true`, a News entry (`src/ui/news_entries.ts`).

The registry's own test (`tests/thornfray_bouts.test.ts`) fails a kind missing any of these:
a `CONTEXT.md` entry by its name, a `BOUT_CALLS` entry (or `errand: null` said in its data), a
pinned end checksum, its test file, a rule line under 40 characters, card lines that fit the win
card at 844 by 390 (`tests/royale_win_layout.test.ts` reads every kind).

**Engine work is not the loop's.** A kind that needs what the engine lacks (a new goal
primitive, a new system on the planet, a change to combat, to a seam, to the ledger, to a
shared scorer or to the brain's bout branch) moves `BOUT_ENGINE_VERSION`, keeps
`tests/royale_golden.test.ts` green or moves `ROYALE_RULES_VERSION`, and is reviewed by the
maintainer before it lands.

The bouts the maintainer has named for the weeks after:

- **A moving circle to hold**: a `'circle'` goal and a held-time scorer (the loop).
- **A damage race on the Voidmaul**: `systems.risings.voidmaul` with its time and a scorer on
  the tick's `damage` events against it (the loop).
- **Carrying the Burr**: a `'carrier'` goal and a held-time scorer (the loop).
- **A gallery of Strikeposts**: engine work. Strikeposts stand only on the 5v5 map, through the
  Range's `options.range`; standing them on the planet is a new system, with a rules bump and
  the maintainer's review.
- **Duels**: engine work. Pairing seats needs hostility per pair, a combat change, with a rules
  bump and the maintainer's review.

## Out of scope

- Crews, parties and friends entering together: a Thornfray is Solo.
- Watching a Thornfray as a spectator, and replaying a whole Thornfray as one: each bout is its
  own replay under a numeric id of its own, the six listed in the match's result.
- Remote and headless policies: `src/net/policy_wire.ts` parses neither `drop` nor `graft`,
  and the environment offers the 5v5 only (ADR 0032).
- A ladder of its own, a rating, or a weekly Thornfray table.
- Bouts chosen by the players, a vote at the Lull, or a pool the person filters.
- Joining after the second bout's landing.
- Offline play: a Thornfray runs on the server like the battle royale.

## Open for the maintainer

- **The prize Graft kept all match**, against the next bout only (the default): the first is
  what a Graft is everywhere else (a lasting gift), the second keeps a run of wins from
  compounding and keeps everyone level again. `PRIZE_LASTS` switches it; the report's "a
  bout's winner wins the next" measure decides.
- **The rising arc**: level 6 to 11 and 2 to 12 pieces, or another curve, or the planet's level
  3 landing kept.
- **The gathering's 20 s** and its Start now, against starting at once as the battle royale does.
- **The ladder's two end awards**, 40 and 20.
- **Where the Final's kind comes from**: drawn like the others (proposed), or always Lastwick.
- **The replays kept**: forty files (`REPLAY_KEEP`) hold fewer than seven Thornfrays; raise the
  keep, or count a Thornfray's six as one.
- **Starglean in the Cypress groves**: 10 caches there against 18 in the Ruins, or Starglean
  kept to the regions with room for 18.
