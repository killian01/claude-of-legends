# Battle royale on the Wanderseed

The seat reports say it plainly: a visitor walks a minute to a lane and leaves. On 2026-10-02
the maintainer asked for a battle royale, a big one, fifty players, and settled every choice
of it in one sitting (`docs/plan-royale.md` holds them all). This records the decisions the
code rests on.

## Decision

- **Fifty champions, each for themself.** A free-for-all (ADR 0030); house bots fill every seat
  and a person takes a bot's seat (ADR 0025's drop in): the champion as the bot left it, a bot
  playing the champion the person picked when there is one.
- **The Wanderseed.** A planet of radius 80 m walked all the way round (ADR 0029), about
  1,100 m2 of ground per champion. Six regions like the faces of a die (the Sanctuary, the
  Ruins, the Cypress groves, the Lakes, the Cliffs, the Open ground), the Sanctuary opposite the
  Open ground; the eight points where three regions meet are crossroads with a launch pad and a
  beacon. Built by a Blender script from one seeded layout (`docs/planet.md`), in the Star
  Orchard's style.
- **Two variants, one planet, one Dusk.** Respawn: a death costs five seconds and nothing else,
  the champion comes back at the edge of the light, and the most takedowns when the last light
  goes out wins; a person can join until two minutes from the end, and the next match starts at
  once. One life: one life, the last champion standing wins; a person can join during the calm
  first minute and a half. Play now launches Respawn.
- **Ten minutes, the Dusk closing.** A minute and a half of calm, then the lit cap shrinks in
  five phases to a point drawn each match, a fifth of a champion's speed; outside it the Dusk
  burns from 1 to 12 percent of maximum health a second. The next cap is always drawn.
- **The drop.** Ten seconds over the globe to pick where to land; bots pick too; no pick lands
  somewhere quiet.
- **Loot is the build.** No shop, no gold, no recall. A cache (about 150 drawn among 250 spots,
  golden ones in the Sanctuary and at every region's heart, opened by standing 1.5 s beside it),
  a camp and a takedown each give the next piece of the champion's house build
  (`nextKitStep`), equipped at once. Levels come from takedowns and camps, spells rank
  themselves, every champion lands at level 3 with Q, W and E. A takedown also gives 30 percent
  of maximum health.
- **Moving.** Five seconds out of combat give 40 percent more speed; about ten launch pads
  throw a champion 50 m along a fixed great circle. Bushes hide, solid things block sight.
- **Creatures.** About twenty camps back after 90 s, the Pyrefang and the Voidmaul at 3:00 at
  the Ruins' and the Cliffs' hearts, the Warden at 6:00 in the Sanctuary; the last hit takes
  their reward.
- **Bots are bots.** Each has its own name and a bot mark; the match says how many people are
  in it. Their skill is a mix (about half gentle, a third normal, a few strong), softer when
  only Guests play.
- **Points.** The same ladder and rules as ADR 0027, plus the end: One life pays 50 to the last
  standing, 25 to the top five, 15 to the top ten; Respawn pays 50 to the best score.

## Consequences

- The 5v5 on the Star Orchard is unchanged and stays a tile.
- The sim gains a mode module (`src/sim/royale/`) that the 5v5 never runs; the systems only the
  5v5 has never run on the planet.
- The bots gain a battle royale style under the same decision budget and the same vision as a
  person: a champion sees what its own sight shows.

## Amended: the Risings and the hunted (2026-10-04)

Nine measured matches left the three big creatures untouched, and fifty champions had nothing
to steer by but the nearest fight. This overrides **Creatures** above for the big ones:

- **Risings.** The Pyrefang and the Voidmaul still rise at 3:00 on their rings, and again
  150 s after each death; the Warden rises once, at 4:30 in One life and 6:00 in Respawn, at the
  walkable point nearest the center of the light as it will stand 30 s later, never in the
  Sanctuary's pit and never a second time. Each is called 30 s ahead. On the planet a champion
  fights them alone, so their bodies rise at a share of the 5v5's (a big creature at 0.35 of its
  health, the Warden at 0.22, both at 0.7 of the strike): a level 6 champion with four pieces
  takes a big creature in about 20 s, the Warden in about half a minute.
- **What they pay.** A big creature's last hit pays three pieces (two and a Heartwood Graft
  once Grafts ship), all the health and mana, and shows the slayer to everyone for 4 s. The
  Warden's last hit carries the Wrath instead of the Boon: one champion's, not a team's, for
  60 s in One life and 120 s in Respawn, passed to whoever takes its holder down with what was
  left and at least 45 s, lost to a fall the world dealt.
- **The hunted.** The Lodestar (Respawn's leader from five takedowns, One life's from two once
  the second closing starts), an Ablaze run (three in One life, five in Respawn, the three
  longest) and the Wrath's holder are shown to everyone where they stand, every 20, 15 and 10 s,
  each show 4 s long. A takedown on the Lodestar counts double and pays a piece; snuffing out a
  run pays up to three pieces. The 30 s leader show it replaces is gone.
- **Bots answer them** from the same public signals a person reads (`src/sim/royale/bot/calls.ts`).

## Amended: an Arrival meets a fair first fight (2026-10-08)

The seat reports since 2026-10-03: 16 of the 18 visitors outside the maintainer's own testing
dropped into the standing Respawn match while it ran, where no escort ever lands. Of the 13
drop-ins without a takedown, 12 left by 75 s; the only two who stayed to the end had a takedown
about 10 s after first contact. The quiet spot put a drop-in 25 m from every champion: its first
damage came 12 to 35 s after landing, and 6 of 12 left alive, 3 of them never attacking. The
seat itself ignored level: one visitor arrived at level 3 at 7:26 with 46 of the 49 champions
above it, and the playthrough's first foe was a level 6 with 2572 health against its 1487. And a
Respawn return set 4 m inside an edge still closing came back burning; one Arrival landed 1 m
inside a closing edge with a foe 1.3 m away. This overrides the Arrival's quiet spot in Respawn;
One life's Arrival and every One life rule are unchanged.

- **The seat.** A drop-in still takes a bot playing the champion it picked first, a standing
  one before one down, never one out for good; within that, in Respawn, the seat whose level is
  nearest the field's (the lower median of every champion's, the fallen too), then the higher
  level, then the lowest unit id (`server/royale_join.ts`).
- **The level.** A Respawn drop-in comes down at least one level under the field's lower median
  (every other seat's, the fallen too), its points spent and its ultimate ranked from level 6 by
  the usual rule, never below its own level. The levels lifted offer no Graft: the Arrival's
  Bough stays the one offer (`src/sim/royale/levels.ts`).
- **The spot.** A Respawn drop-in comes down 9 to 11 m (inside a champion's 12 m sight) from a
  bot's seat that is standing, out of its Grace and off any pad, out of combat, no higher in
  level than the drop-in, and deep enough inside the light, the softest first: the skill it plays
  now (its sharpening included), then its health share, its level, the lower id. A foe with
  anyone else within 12 m is passed over, six foes are weighed, eight draws each, and a draw is
  kept deep enough inside the light, in the foe's sight both ways (no bush between them, no rock
  on the line, `src/sim/vision.ts` inMutualSight), with nobody but the foe within 12 m of it.
  With none, the quiet spot as before (`src/sim/royale/drop.ts`). The foe holds its fire only
  while the Grace lasts, so the person strikes first; the bot fights on sight after that, as
  every bot does.
- **The light it stands in.** While the Dusk closes, a Respawn return and an Arrival are set
  down in the cap it closes to, which lies inside the closing one, so a fresh champion is not
  overtaken before the phase ends; while it holds, the light now (`src/sim/royale/score.ts`
  returnCap). This holds for every seat, the bots' too.
- **Rules 5.** The planet's rules version moves from 4 to 5; a replay records the seat taken as
  before ('bot_off') and re-simulates the Arrival from the match's stream.
- **Measured** (`node scripts/royale_report.mjs --seeds 4 --variant respawn --dropin
  60,180,300,420`, against the same report on the rules before): a fair foe for 14 of the 16
  drop-ins (all of those at 1:00 and 3:00), the nearest enemy at landing 10 m against 28 m, the
  first hit 4 s after landing at the median against 10 s, a takedown within the first minute for
  9 of 16 against 5 of 16. The first life is shorter at the median, 25 s against 33 s (31.5 s
  against 35 s over seeds 1 to 12, 50 s against 42 s on average): on seeds 1 to 4 the fair foe
  ended none of them, the champions drawn to the fight from just past 12 m did.
- **In sight** (the same day, on merging the tranche). Over seeds 1 to 12, 7 of the 43 fair
  landings saw no enemy at all, the foe in a bush or behind a rock; a playthrough's drop-ins met
  nobody. The spot now asks for the foe's sight both ways: 43 of the 48 drop-ins see an enemy
  on landing (36 before, none on the quiet spot), a takedown within the first minute for 28 of
  48 (26 on the quiet spot), the first life 28 s at the median and 47 s on average (35 s and 42 s
  on the quiet spot).

## Amended: the Respawn wait picks the return (2026-10-08)

The seat reports: 4 of the 10 visitors who died in the standing Respawn match left during the
5 s wait, a wait with nothing in it but a count. A return set at the edge of the light came
back within 10 m of a champion 41 percent of the time (over seeds 1 and 2 of fifty house bots,
415 of 1,014 returns and 389 of 980). This gives the wait a choice; One life is unchanged.

- **The globe in the wait.** A second after a Respawn champion falls, the camera rises to the
  drop's globe, faced to the light it comes back in (the cap the Dusk closes to while it
  closes, score.ts returnCap), the fall marked on it. A tap or a click on it picks where it
  comes back (the death wash says "Tap the globe to choose where you come back" on a phone,
  "Click the globe..." on a desktop); the last pick wins. The globe sits right of the middle and
  the wash's lines move left of it, its recap and life lines whole, clear of the Graft cards and,
  on a phone, standing on the folded Graft chip; the thumb controls stand down meanwhile. When
  the champion stands again the camera dives down to it as after the drop
  (`src/ui/royale_return.ts`, `src/render/planet_stage.ts`).
- **The rule.** The pick is the 'drop' command and action, taken while dead in Respawn's play
  (Sim.pickDrop), recorded and replayed like the drop's. The return is set down at the pick
  brought inside that light at an Arrival's depth, on walkable ground, and at least 10 m from
  every champion standing; when the pick is not such a point, the nearest of eight rings 3 m
  apart around it that holds one gives its point farthest from everyone, and with none the edge
  of the light as before. Each wait picks afresh; no pick, the return is as before
  (`src/sim/royale/return_pick.ts`). The return keeps its Grace.
- **The bots.** A dead Respawn seat is asked its decision until it picked (the dead decision a
  Graft offer already asks), through the same observation, which reads the pick back in its
  `drop`; the brain picks beside a Seedfall landing within 20 s of its return
  (`bot/brain.ts` respawnPick), else picks nothing and comes back at the edge.
- **Measured** over fifty house bots, seeds 1 to 3: 30 percent of the returns are picked (339 of
  1,069, 296 of 1,023, 331 of 1,094), none of them within 10 m of a champion (11 m at the
  median), none outside the light; the dead seats' decisions cost about 15,000 more
  observations a match, some 3 percent of the sim's time.
