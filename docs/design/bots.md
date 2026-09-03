# Bots: play with a bot instead of by hand

Status: design accepted (grill rounds 1 to 4, 2026-09-02), phases 0 to 8 built, then
redrawn after the second playtest round (grill rounds 5 to 7, the same day): the kit,
selling, the fight stance, and the reasoning bar. The why is ADR 0013 and ADR 0014; the
build order is `docs/plan-bots.md`; the terms are in `CONTEXT.md`: Bot, House bot,
Play, Playbook, Kit, Build, Variant, Stance, Lane opponent, Coach order, Academy,
Arena, Sparring, Briefing, Rating.

## The mode in one paragraph

An account can field a bot in its seat instead of playing by hand. The bot is the
account's own: a name, one champion, a playbook that decides what it does, and a record.
Its owner writes the playbook in the Academy by talking to a model and by editing the
play list directly, tests it in seconds against house bots, then sends it to play: in the
live queue, where the owner watches and coaches it in real time, or in the Arena, where
the server plays it at full speed against other accounts' bots whether the owner is
there or not. Three ladders rank the three ways an account can play: by hand, by its bot
live, by its bot in the Arena. Nobody needs to know anything about AI: the playbook is a
list of plain rules, and the model writes them for whoever would rather describe a style
than edit a list.

## Where the fun is

A twenty-minute match nobody plays is a match nobody feels. The genres that made AI-first
play work (autobattlers, bot-programming games, football managers, bots that play while
you sleep) each found the fun in one of four places, and this mode serves all four:

| Source of fun | What serves it here |
|---|---|
| Depth of what you compose | The playbook: ordered plays with real triggers, not eight dials on a shared brain. Two bots play visibly differently. |
| Seeing why it failed | The active play is visible in spectate and replay, and the post-match report counts time and deaths per play. You fix the rule that killed you. |
| Cadence | Local sparring at full speed while writing; "play now" Arena matches in ten seconds; hourly Arena rounds; the live queue at real speed when you want the real thing. |
| Stakes | A named bot with a record, three ladders, a Briefing every morning telling you how the night went. |

The asset no autobattler has: a match with no seat played by hand has no latency
constraint, so the server can play it at any speed. Measured on the maintainer's machine:
a full 5v5 house-bot match (about 18 minutes of sim) runs in 10 seconds of wall clock on
one core, about 100 times real time.

## Three ways of playing, three cadences

A seat is played one of three ways, and the way is what the ladders rank:

- **By hand**: today's game, unchanged. The hand ladder lists only people, because the
  hand rating moves only when the account itself played its seat.
- **Bot, live**: the owner queues with a bot in the ordinary public queue. The seat is
  in-sim, exactly like a house bot seat today; the owner stays connected as the coach and
  may close the tab, the bot plays on. Humans by hand, bots, and house bots share the same
  live matches; there is no separate bot queue, and no fourth queue to leave empty.
- **Bot, Arena**: deposited bots play server-run matches at full speed, no one present,
  no coaching ever.

Nobody waits for the night to play. From the moment a bot is ready:

- the **live queue** takes it, at real speed, coached;
- **play now** launches one rated Arena match on demand, played in about ten seconds,
  result and replay right away, from a daily allocation per account (order of magnitude:
  twenty), through a server queue with bounded concurrency so the live loop is never
  starved;
- **local sparring** plays a whole match against house bots inside the browser at full
  speed, free and unrated, with the replay and the active-play overlay. The offline
  practice match already runs the sim in the browser; sparring is the same sim without
  the renderer in the loop.

The night is for the Briefing and for server sparring, not for the right to play.

## A bot

- **Identity**: a name (word filter, unique within the account), one champion, two
  sigils, a skin, a playbook, a record. Another champion is another bot.
- **Unlimited** bots per account; at most three **deposited** in the Arena at once (a
  toggle), to bound server CPU.
- **Champion select** in the live queue offers the account's bots on their own tab
  beside the roster (a bot card wears its champion's face and a BOT badge; mixed into
  the grid it read as the same champion twice); picking a bot fixes the champion. In
  the Arena there is no select: the bot carries its pick. No duplicate champion within
  a team, in the Arena as in the live queue.
- **Versions**: every applied playbook change is a version. An edit applies from the next
  match; the replay embeds the version that played, the way it embeds forged definitions
  (ADR 0010), so what you rewatch is what ran.
- **Roster only in v1**: a bot plays a roster champion; forged champions come when the
  Forge has author-declared hints (plan-forge phase 2). Mastery stays derived from hand
  play only. Skins apply to bots as to any champion.

## The playbook

A playbook is a bot's whole decision policy as data: an ordered list of plays. Each
decision slot, the interpreter walks the list top down and the first play whose trigger
holds is the one that acts. The interpreter is one Policy in `src/sim/`, deterministic and
I/O free, so a bot seat is a house bot seat with different data: same slot schedule, same
decision budget, same team vision, replays for free.

The split that keeps it playable without expertise, on one rule (ADR 0014): everything
that is a choice is the playbook's, everything that is execution is the engine's.

- **The playbook owns every choice**: when to farm, poke, engage, retreat, recall, siege,
  rotate, contest the Warden, group; what to build and in which order; which spell to
  max; whom to fight and how to hold distance; where to lane. These are the decisions
  micro locks newcomers out of in a MOBA.
- **The engine owns the execution**: last hits, projectile and windup dodging, tower
  discipline, which key is the escape and which the engage (the per-champion hints of
  kits v2), predictive aim, the steps of a kite. Every bot has the same hands; the
  ladder ranks decisions.

**The kit** is the part of the playbook that says what the bot works toward rather than
what it does now: a build (an ordered list of items), a skill order (which of Q, W, E to
max first; R goes at its level gates), and variants, each a trigger with its own build
or skill order. The first variant whose trigger holds is the kit in force, decided again
at every purchase and every skill point; none holding, the defaults are. A kit that
names no build gets the role build the engine shipped with (damage for marksmen,
assassins and skirmishers; magic for mages; the defensive shell for the rest), so every
existing bot keeps its build until its owner writes one. Components are the engine's:
the build names finished items and the walker buys the pieces in recipe order, and an
item consumed into a later one still counts as owned.

**Selling** follows the human rule, at the fountain for seventy percent, through a new
action of the Policy contract. Three rules, all on by default: a leftover the build no
longer wants is sold first when the bag is full; a build may be longer than the bag,
and past six items the next target replaces the cheapest item once the gold covers the
difference; and a `sell` play sells a named item on the owner's own condition.

**The fight** takes three choices. The stance says how the bot holds distance: `kite`
attacks from the edge of its range and steps away from whoever closes, `front` walks
in, `poke` casts and steps back, and `auto` (the default) kites on a ranged champion
and walks in on a melee one. The target rule says whom: the nearest, the lowest in
health, the squishiest by role, or the coach's focus. A hard-controlled enemy in reach
beats the rule, because every cast against it lands. `alone` says what a walk-in does
with no allied champion beside it: `engage` (the default) walks in anyway, `hold`
strikes only what is already in reach and leaves the slot to the plays below (the
scout on the fill: the melee fed, diving alone).

**Triggers** (v1) are predicates over the observation and the static map, combinable
with and/or/not: own health, mana, level, gold, and time thresholds; enemy or ally
champions within a radius (count); an enemy champion missing (from the last-seen memory);
the lane wave ahead, behind, or under a tower; an enemy tower in reach; the Warden up,
spawning within N seconds, or down; an ability or sigil ready; a coach order active; own
lane assignment.

**Behaviors** (v1), each with its parameters: farm the lane, poke, engage, retreat, recall,
siege, rotate to a lane, contest the Warden, follow an ally, hold a position, obey the
coach order. A behavior is a macro intent the engine turns into movement, attacks, and
casts through the shared micro.

**The Laner is the default playbook.** The scripted Laner is already structured as
priorities (survive, avoid dives, fight, farm, push with the wave, prepare the Warden,
regroup at twelve minutes); written in this language it becomes the playbook every new
bot starts as, on the champion its owner chose. That is also how the language is proven:
phase 1 of the plan is the Laner as a playbook, pinned tick for tick to the code Laner by a
parity test before anything else moves.

**Versioned, additive.** The playbook format carries a version like the Policy contract;
new triggers and behaviors are added, never changed, so an old playbook keeps playing when
the language grows.

## Coach orders

During a live match the owner can give the bot one order: go to a lane or a point, take
the Warden, focus a target, back off, group on an ally, hold, free. One order is active at
a time, persistent until released or accomplished, free like a movement intention (ADR
0003), sent as a typed ping over the existing ping channel. A bot obeys only its owner.
Whether the order wins over the rest of the playbook is the owner's choice: "obey the
coach" is itself a play, placed wherever the owner wants it in the list.

In the sim the active order is an additive optional field of the bot's observation (ADR
0005 keeps contract v0 intact) and each order is a recorded replay event, so a coached
match replays exactly. House bots ignore orders in v1; the same mechanism lets them obey
their team's pings later, which is a large quality-of-life gain for today's mostly
house-bot matches and is scheduled as the first follow-up.

## The Academy

The place where an account writes and tests a bot. Conversation first, the play list
always visible and editable beside it (reorder, edit parameters, enable and disable):
the conversation is the door for people who would rather describe a style; the list is
the truth everyone ends up touching. Every bot starts as the Laner on its champion.
The conversation is kept with the bot on the server, session after session, so the
coach remembers what was done: the model reads the newest turns (the thread cap), the
store keeps a hundred exchanges, and Start over forgets the thread, never the plays.

The conversation must be reactive, and reactive is measured: on a short request, the first
changed play appears in under two seconds. Four rules make that true:

1. **Answers are patches, not whole playbooks**: add, remove, reorder, edit a play. A
   small request is a small answer, so a short one.
2. **The list moves while the answer streams**: each patch operation applies on screen as
   soon as it is read; validation is local because the interpreter and the validator live
   in `src/sim/` and run in the browser.
3. **No hidden retries**: an invalid operation is shown and refused, the rest applies, and
   the model is told on the next turn.
4. **Model size follows the request**: a fast model for patches, the large one for "rewrite
   everything"; the exact choice is made at implementation time against the current API
   reference, never from memory.

Sparring in the Academy runs a whole match against house bots at full speed in the
browser, then lands on the bot's Record (below): the newest entry at the head of the
Sparring panel, its line and its build first, the play table in its sheet; leaving a
replay lands back in the Academy on the same bot. The test drive into offline practice (the Forge's
pattern) stays available for watching at real speed.

The series is the same sparring five seeds at a time, with the previous version of the
bot on the other side of the table: the current playbook (the unsaved edit, or the saved
version) on one team, the version before it on the other, both on the bot's champion,
house bots around each, the side alternating from seed to seed so the map favors
neither. It answers "v4 against v3: three won, two lost" in a minute, with the plays
summed over the five matches and a replay per seed; a bot with no previous version spars
its series against house bots alone. Five seeds is a reading, not a proof: ten seeds
move a rate by fifteen points, so a change that looks like a coin flip is one.

House bots do not all play the same brain. Each seat the fill hands out draws a house
style from the match seed: the Laner; the Brawler (the fight first: front stance on any
champion, engaging with nobody beside it, joining a fight from across the map, retreating
late, no camps, the group push at eight minutes); the Sieger (the wave and the towers: a
structure in reach with any escort before the wave, a fight that holds alone, the Warden
only when healthy and close to its spawn, the group push at ten); the Objective player
(the Warden and the camps: at the pit forty-five seconds early, ground given under the
tower when outnumbered alone, the camps before the wave). Each is one playbook file under
`src/sim/content/playbooks/`, readable and copyable by any owner, and the draw runs on
every host, so the server's backfill, the Arena, sparring, the series, offline practice
and the environment vary the same way: two sparrings on different seeds meet different
lineups played differently. The scoreboard says the style ("House sieger").

A replay is for analysis, so it is a player, not a tape: pause, playback at one to ten
times, playback backward at one to four times, five seconds back or forward (thirty with
shift), one tick either way while paused, a scrub slider over the whole match and a time
to type; J, K and L, the arrows, comma, period and space do the same from the keyboard.
Seeking rides determinism and the world checkpoint: the sim can hand its whole state out
as plain data and take it back in place, so a worker plays the match once ahead of the
viewer and ships a checkpoint every ten seconds of match time. Any tick is then the
nearest checkpoint restored plus at most ten seconds stepped, forward or back, about a
tenth of a second; reverse playback walks a denser ring of snapshots built on demand
around the current window. Until the worker has covered a tick, a backward seek falls
back to rebuilding from the start. The first playtest of the viewer had every backward
seek rebuild from tick zero with the slider crawling back up: the checkpoint is what
turned "find the fight, stop, move a few seconds" into a gesture.

Under the slider, the marks (the same pass finds them): a density strip of the kills per
ten seconds tinted by the side that scored, ticks for the structures and the Warden, the
followed seat's own deaths in red, each slice listing its moments on hover and seeking
on click. What lets a reader find the action without sweeping.

## The fill and the home lanes

A match is seated by role before anyone plays it. The roster promises two top (the tank
and the fighter), a mid (the mage, the assassin, the battlemage), a marksman and a support
in bot, and one flex skirmisher (`docs/design/roster.md`); until the fill landed no host
kept that promise. House bots took the first free roster champions in order, so an all-bot
match was Korrath, Dain, Sylra, Fenn and Elowen on both sides, without a marksman or a
support, and lanes went by seat order, the first seat mid whoever sat there (a sparring
Vesk played mid). Two rules now hold on every host, the live queue, the Arena, sparring,
offline practice and the environment alike:

- **The fill** completes a team around what it holds, drawn from the match seed: a lone
  marksman gets a support beside them, a held support gets a marksman, a forged champion
  counts by its role, the flex and an unknown champion take the first seat open, and two
  sparrings on different seeds meet different lineups (`src/sim/fill.ts`).
- **The home lane** is the sim's call, from creation: a champion sits in its role's lane
  while a seat is open there, the flex and the overflow take the lane with the most seats
  open, and a human's seat counts like a bot's, so the fill's support lands in bot lane
  beside a human marksman (`src/sim/lanes.ts`).

Composition is therefore a fact of the match a playbook can read (both rosters go in the
observation in plan-bots phase 12), not a constant the default Laner was tuned against.

## Adapting to the opponent

A player reads both teams before the first fight; a bot needs the same facts in its
observation, all of them things a viewer reads off the screen: the match's seats, both
teams' champions and roles (public from champion select, with the assigned lane for the
own team), the items on a visible champion, and the lane opponents (per lane, the enemy
champion the team has seen the most inside it over the last three minutes, a memory
the sim keeps from what the team saw). Triggers over them make variants and plays
situational, on either side: a champion is in the match, a side fields so many of a
role ("no tank on my side", "two mages across"), the enemy deals mostly magic or
physical damage (by roles, supports counting on neither side), a visible enemy wears an
item, the lane opponent or the lane partner is a given champion. A bot also states the
lanes it asks for, in order, seated ahead of its champion's home lane; rotation stays a
play. Additive contract growth, like every observation field since v0 (ADR 0005).

## The bar

The maintainer set the bar as four questions, and each has a measure:

1. **Breadth**: how much the language lets an owner express. The measure is a list of
   player intents ("kite and focus the carry", "roam mid after the first tower", "build
   against magic when three mages are across") that the coach must be able to write and
   that show in a sparring replay; the list grows with every phase and is pinned by tests.
2. **Fun to optimize over time**: every change must show its effect, or the owner edits
   blind and stops. Sparring is therefore a series, not one match: five seeds, the win
   rate and the stats per play, compared with the previous version of the bot ("v4
   against v3: four wins to two"). The post-match report per play is the other half.
3. **Variety**: within a match, through the phases (time, level, items owned, the Warden
   clock) and the kit changing variant; between matches, through the fill (another
   lineup on both sides every seed) and several house styles drawn by seed (a brawler, a
   sieger, an objective player, beside the Laner) instead of one brain on every seat,
   then through the Arena population as other owners iterate.
4. **Winning against the other bots**: an iterated bot climbs the Arena ladder, and beats
   the default Laner most of the time, the Laner being the floor.

Underneath, an internal guard: a changed default Laner ships only if it wins at least
seventy percent of twenty sparring matches against the previous version over fixed
seeds, on the fill, each seed played from both sides so the lineups drawn favor nobody
(`scripts/laner_gate.mjs --mirror`). Ten seeds move the rate by fifteen points either
way, so a candidate is confirmed on seeds the search never saw. It keeps engine changes
honest and blocks regressions; it is not the bar. The scouting report that opens every reasoning phase measures, per
bot and per minute of a sparring, what a player would have done differently: fights
taken outnumbered, deaths under towers, gold unspent, time far from the team, objectives
given away.

## Seeing what the bot thinks

The sim records the active play per bot as a deterministic sim event whenever it changes.
Spectate and replay show it as an overlay on the bot; the post-match report counts time
in each play, deaths by play, and results per opponent. This is the mechanism that turns
watching into learning: without it nobody can fix a rule, so nobody iterates.

## The ladder alive

The meta matrix (`scripts/meta_matrix.mjs`) plays every house style against every other,
mirrored over fixed seeds, and reads the result: a cycle (A beats B beats C beats A) is a
ladder with depth, a dominant style is a ladder one playbook solves. Ten seeds on
2026-09-03: no cycle; the Laner beats the Brawler 70%, the Sieger 55% and the Objective
player 60%, the order transitive Laner, Objective player, Sieger, Brawler, and most pairs
split (the seed's lineups decide more than the brain). The default bot is the dominant
style: the ladder is flat by construction until a lever creates counterplay. That lever
is the next round's work, guided by this matrix; what follows makes the ladder live
meanwhile.

**Ranked** is the owner's one switch: a ranked bot plays the Arena's rounds and play now,
and takes an empty seat of a live match before a house bot (the fill, above), rated on the
account's live way. Every human match moves several bot ratings, and a human meets other
people's bots without waiting for anyone. Play now is the Sparring panel's first action,
with the day's allowance, the pool's size and the next round beside it; the hourly rounds
stay as the heartbeat that converges the ratings when nobody is around.

The pool is public: the ladder's Arena tab opens on every ranked bot, placed or not, each
with its **Bot page**: owner, champion, rated tally, ratings by **Tier**, rated matches
with lines, builds and replays, and the playbook when the owner opened it. From the page,
a **Challenge**: the reader's bot against this one, now, unrated, from the same daily
allowance, on both Records. Reading an opponent before playing it, and adapting through
the lineup triggers and the variants, is where two good players separate.

Tiers name the bands of a rating (Recruit, Regular, Veteran, Elite, Legend, by hundreds
from the base rating) so a number reads as a place; a seasonal reset is a follow-up.

## The Record and the Match sheet

A bot has a Record (CONTEXT.md): every match it played, newest first, sparring and series
from the Academy, Arena matches, and live matches where the account fielded it, fifty per
bot, the oldest leaving first. Each entry carries its kind, its result, the ten seats'
lines and builds, the plays, the deaths dated with the play that held and the killer, the
playbook version that played, and its replay. Unrated does not mean unrecorded: the
Academy posts a sparring's result to the server (bounded, the playbooks through the
validator, only a bot-only replay record accepted, never re-simulated) and the server
writes Arena and live entries itself at match end, so the Record survives a reload and a
change of machine and feeds the Briefing and the night coach. Replays live in the one
replay store: a bot's replay weighs a few kilobytes (the seed and the picks; the bots
decide the rest), and one a living entry references is held out of the global prune and
leaves with its entry; live replays with humans stay under the global window, and a
sheet whose replay has gone says so.

In the Academy the Record's head sits in the Sparring panel (the newest entry: kind,
result, duration, the line, the build as icons, Sheet and Watch; a series adds its
summed line) and the tally beside each bot in the rail. The Record itself opens over
the center and side columns: the list filtered by kind on the left (kind, result,
K/D/A, build, version, when), the Match sheet of the selected entry on the right: both
teams' scoreboard with their builds, time and deaths per play, and the deaths, each with
its Death card (the scene: the spot, allies and enemies within reach, the tower over it,
drawn as a thumbnail of the map) and a link that opens the replay five seconds before.
Nothing is dismissed: an entry stays.

## Ladders and rating

Three rules replace the current "rated only with a human on each side":

1. **A match counts** when each team holds at least one seat that belongs to an account,
   played by hand or by its bot. A house bot never counts, for itself or for anyone.
2. **An account holds three ratings**, and a match moves only the one for the way that
   account played it: by hand, its bot live, its bot in the Arena. You play by hand
   against three other accounts' bots: your hand rating moves, their live bot ratings
   move, the six house bots move nothing.
3. **The more owned seats, the more the match weighs**: the existing K scaling from humans
   extends to owned seats. Elo expectation takes the team average over each seat's own
   rating. Leaving costs only a seat played by hand; a coach closing the tab is not a
   leaver.

Three ladders follow, one per rating, each with the existing minimum of rated games. The
Forge queue keeps its own rating pair and is untouched.

## The Arena

- Deposited bots play **hourly rounds**: one match per bot per hour, opponents matched by
  Arena rating, house bots filling the seats when fewer than ten bots are deposited (a
  young server), rated whenever an owned bot stands on each side. A hundred bots at one
  match an hour is a hundred matches a day, about seventeen minutes of CPU a day.
- **Play now** adds on-demand rounds from the daily allocation.
- Matches run at full speed off the live loop (a worker thread; `node:worker_threads` is
  built in, no dependency), one process one port as before (`docs/deploy.md`).
- No live spectating of the Arena at a hundred times real time; the replay is saved for
  every match and the Briefing links it.

## How a bot improves

Four mechanisms were weighed; the mode uses three, in order, and excludes the fourth:

1. **The owner iterates** (v1, inherent): the report says six deaths on one play; the
   owner edits that play.
2. **The night coach** (with the Arena): the same model that writes plays reads the
   structured report of the day's Arena matches and proposes a patch. The owner reads it
   in the Briefing and applies it, or has opted in to automatic application; every applied
   change is a version they can undo. One model call per bot per day, on the agent quota.
3. **Sparring decides** (with the Arena): a proposal is played in a handful of unrated
   sparring matches against the same opponents before it is applied, and applies only if
   it wins more. Six sparring matches are about a minute of CPU per bot per night. Every
   bot gets the same sparring allocation, in the spirit of ADR 0003. This is what makes
   the night coach honest, and the only sense in which "the bot improves as it plays" is
   literally true.
4. **Learning proper** (reinforcement learning, imitation of the owner's own replays) is
   excluded: it is the server-side inference ADR 0002 defers, and it is not for the
   audience this mode serves. Trained bots keep their own road: the environment and the
   remote policy wire.

## Out of scope for v1, recorded as follow-ups

- House bots obeying their team's pings (same mechanism as coach orders).
- Sharing bots: a playbook gallery, playing another account's bot, remix.
- Bots on forged champions (needs the Forge's author-declared hints).
- Style presets measured from the owner's own hand-play replays.
- Seasons and ladder resets.

## Risks

- **The Laner rewrite** is the load-bearing engineering step: the playbook Laner must be
  tick-identical to the code Laner across seeds before the code Laner goes.
- **Language expressiveness**: if the v1 triggers and behaviors cannot express what
  players ask the model for, the conversation disappoints. The play list stays visible so
  the limit is never hidden, and the format grows additively.
- **CPU on a single-process deploy**: Arena and sparring live in a worker thread with a
  bounded queue; the allocations are server configuration.
- **Ranked integrity**: on-demand Arena matches are matched by rating and capped per day;
  sparring never rates; house bots never rate.
