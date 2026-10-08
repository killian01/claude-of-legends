# Battle royale on the Wanderseed

The 5v5 opens on a minute's walk to a lane before the first fight. On 2026-10-02
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

A drop-in usually comes down in the standing Respawn match while it runs, where no escort ever
lands. The quiet spot put a drop-in 25 m from every champion, so its first fight came late and
on nobody's terms. The seat itself ignored level: a seat taken minutes in could be level 3 with
nearly every champion above it, and a playthrough's first foe was a level 6 with 2572 health
against its 1487. And a
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

## Amended: a Grace that waits for the person, and assists that pay (2026-10-08)

After the fair first fight, only a takedown's last hit learned anything: a seat could make two
dozen assists and stay at level 3 all match, while about two Respawn
takedowns in five go to a champion who dealt under a quarter of the damage (the royale report's
steals). And the server began an Arrival's three second Grace as the seat was taken, while a slow
client keeps its joining card over the match until its first frame, up to four seconds
(`src/game/first_frame.ts` FIRST_FRAME_WAIT_MS): a slow client could first show the world with the
Grace over and its foe ten meters off. This overrides the Grace's length for a Respawn Arrival
and Respawn's experience; One life and every Respawn return are unchanged.

- **The Grace waits for the person.** A Respawn Arrival's Grace lasts three seconds at least,
  then until the seat's first order of any kind (a move, an attack-move, a Stop), six seconds
  at most; its own first attack, cast or sigil still ends it at once. Nothing the client says
  is trusted: the orders are the seat's own and recorded, so a replay re-simulates the Grace,
  and the 'loaded' message stays the seat report's. A bot orders on its first decision, so a
  bot playing the seat ends its Grace at three seconds and never waits on a load. The
  champions in sight read its latest end (`ObsRoyale.graced`) as the shimmer does
  (`src/sim/royale/grace.ts`).
- **Assists pay.** In Respawn every champion with an assist on a takedown (it hit the fallen
  within the sim's ten second assist window, `src/sim/rewards.ts` assistersOf, the 5v5's assist
  gold unchanged) learns 0.15 of what the takedown would have paid it, weighed by its own level
  as the last hit is, so about seven assists learn a takedown's worth; a fallen helper too, and
  the levels an assist passes offer their Grafts. A Respawn takedown has 3.8 assists on average,
  so the last hit's scale goes from 0.75 to 0.45 of the 5v5's bounty. One life pays the last
  hit alone (`src/sim/royale/assists.ts`, `levels.ts`).
- **Rules 6.** The planet's rules version moves from 5 to 6.
- **Measured** (`node scripts/royale_report.mjs --variant respawn --dropin 60,180,300,420`
  over seeds 1 to 24, split over processes with `--dump` and `--merge`, against the same report
  on rules 5). The final level median goes from 9 to 10, the tenth percentile from 5 to 8, the
  ninetieth stays 13; the seats with at most three takedowns end at level 8 against 4. The
  drop-in's first life is 36 s at the median against 34 s (39 s against 28 s on seeds 1 to 12,
  the seeds the tranche before was measured on), with 10 of 96 first lives under 16 s against
  15. The stand-in's median life is 18.3 s against 19.9 s, the bots fight 66.5 percent of the
  seconds an enemy is in reach against 65.9, the steals are 40.5 percent against 37.6. Four
  pairings of the two numbers were measured (0.35 and 0.2, 0.3 and 0.25, 0.5 and 0.1, 0.45 and
  0.15); every one held the level median at 9 or 10 and raised the drop-in's first life, and
  the last alone kept the stand-in's median life within a tenth of before (the others: 17.0 to
  17.3 s). A bootstrap over matches puts the drop-in's change between -8 and +9 s and the
  stand-in's between -4 and +1 s at 90 percent: the report's medians move that much from one
  set of seeds to the next.
- **A slow load** (`--load 4`: the drop-in gives no order for four seconds after its Arrival,
  seeds 1 to 12). On rules 5 the report's bots never struck in the second between the Grace's
  end and the first order (the first hurt came 12 s after the Arrival at the median), so the
  waiting Grace alone moves no number there (31 s against 33 s for the first life, within the
  noise): it closes a window the bots happen not to use and a person does see. The whole of
  rules 6 at that load: the first life 34 s against 33 s, the stand-in's median life 21.2 s
  against 17.0 s, the fighting share 66.4 percent on both. A local
  playthrough on a loaded box had the joining card come down 3.45 s after the Arrival with
  2.55 s of Grace left, where rules 5 had ended it half a second before the world showed.

## Amended: the Respawn wait picks the return (2026-10-08)

The 5 s Respawn wait held nothing but a count. A return set at the edge of the light came
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
- **The bots.** A dead Respawn seat is asked its decision once a wait, on its first decision
  slot after the fall (and on every slot while a Graft offer is open), through the same
  observation, which reads the pick back in its `drop` (`mode.ts` wantsDeadDecision). The house
  brain picks nothing and comes back at the edge, where a person who taps nothing comes back
  (`bot/brain.ts`): measured with the whole tranche (below), a pick beside a Seedfall landing
  within 20 s of the return, or across the light from the fall, crowded the returns into the
  fights and shortened every seat's lives; and asked on every slot until it picked, the dead
  seats cost some 15,000 observations a match for a pick the brain does not make.
- **Measured** over fifty house bots, seeds 1 to 3: 30 percent of the returns are picked (339 of
  1,069, 296 of 1,023, 331 of 1,094), none of them within 10 m of a champion (11 m at the
  median), none outside the light; the dead seats' decisions cost about 15,000 more
  observations a match, some 3 percent of the sim's time. Four stand-in seats played by the
  bots' brain among them, seeds 1 to 4, per life after a return: with no pick (the edge), 19 s
  at the median, the first hit after 5.9 s, 0.86 takedowns; picking where it fell, 12 s, 2.6 s,
  0.71; picking the far side of the light from its fall, 18.5 s, 4.0 s, 1.60. The pick is a real
  choice: back into the same fight is quick and short, a fresh side of the light pays.
- **Measured with the whole tranche** (the waiting Grace, the paid assists, the Burr, the pick;
  `node scripts/royale_report.mjs --variant respawn --dropin 60,180,300,420`, seeds 1 to 24, a
  Dain drop-in in both, against rules 5). With the house brain picking beside a Seedfall, the
  stand-in's median life fell from 17.9 s to 15.0 s and the steals rose from 37 to 45 percent;
  picking across the light from the fall, 13.7 s and 43 percent; picking nothing, 18.3 s and 41
  percent, the bots fighting 67.4 percent of the seconds an enemy is in reach (66.2 before), the
  final level median 10 (9), the drop-in's first life 31 s at the median (26). Left open: the
  drop-ins found a fair first fight 84 percent of the time (93 before), those joining at 7:00
  half the time (79 percent), and took their first takedown after 23 s at the median (18): the
  field's levels sit closer together and the Burr keeps more bots in a fight, so fewer soft bots
  out of combat stand at or under the drop-in's level (`grace.ts` fairFoes).
