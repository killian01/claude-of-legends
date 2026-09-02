# Bots: play with a bot instead of by hand

Status: design accepted (grill rounds 1 to 4, 2026-09-02); nothing implemented yet.
The why is ADR 0013; the build order is `docs/plan-bots.md`; the terms are in
`CONTEXT.md`: Bot, House bot, Play, Playbook, Coach order, Academy, Arena, Sparring,
Briefing, Rating.

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

The split that keeps it playable without expertise:

- **The playbook owns the macro**: when to farm, poke, engage, retreat, recall, siege,
  rotate, contest the Warden, group. These are the decisions micro locks newcomers out of
  in a MOBA.
- **The engine owns the micro**: last hits, projectile and windup dodging, tower
  discipline, which key is the escape and which the engage (the per-champion hints of
  kits v2), predictive aim, orb walking. Every bot has the same hands; the ladder ranks
  decisions.

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
browser, then opens the replay with the active-play overlay; leaving the replay lands
back in the Academy on the same bot. The test drive into offline practice (the Forge's
pattern) stays available for watching at real speed.

A replay is for analysis, so it is a player, not a tape: pause, one to ten times speed,
thirty seconds back or forward, a scrub slider over the whole match and a time to type.
Seeking rides determinism: forward steps the sim silently to the tick; backward rebuilds
it from the record and steps from the start, chunked over frames so the page stays
responsive (a few seconds for a late minute, shown as seeking on the clock).

## Seeing what the bot thinks

The sim records the active play per bot as a deterministic sim event whenever it changes.
Spectate and replay show it as an overlay on the bot; the post-match report counts time
in each play, deaths by play, and results per opponent. This is the mechanism that turns
watching into learning: without it nobody can fix a rule, so nobody iterates.

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
