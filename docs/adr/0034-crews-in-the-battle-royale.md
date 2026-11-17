# Crews in the battle royale

> Amends ADR 0031 (a match is played Solo or in Crews) and ADR 0030 (a team may hold more than
> one champion on the planet).

The battle royale was fifty champions each for themself (ADR 0031): every champion its own team
(ADR 0030). On 2026-10-12 the maintainer asked for it to be playable in teams of three and of
five as well, and settled three choices: a person's crewmates are house bots, and the people
who enter the same crew size are put in the same crew while it has a bot's seat (no party, no
invitation); in One life a fallen champion is out for good and watches its crew, with no
knocked-down state to be lifted from; the crew size is chosen on the battle royale's quick pick
card, Solo, Trios or Fives, and Play now stays Respawn in Solo (its quick pick opens on Solo). This records the decisions the
code rests on (CONTEXT.md: Crew).

## Decision

- **Three crew sizes, either variant.** Solo is the mode as it was: fifty seats, each its own
  team. Fives: ten crews of five, fifty seats. Trios: sixteen crews of three, forty-eight seats
  (fifty does not divide by three; seventeen crews would crowd the planet's ground per
  champion). Seat i sits in crew floor(i / size), the people first (`src/sim/royale/crews.ts`
  crewOfSeat, crewSeats).
- **A crew is a team (ADR 0030).** It shares its sight, its champions never hurt one another,
  and the sim's own team rules (an attack's target, a spell's, an ally's spell and dash, an
  assist, the Wrath's and a favor's team) read it as they read the 5v5's teams. The
  free-for-all's isolation rule (`combat/effects.ts` targetIsolated) holds in Solo only.
- **The landing.** Each crew lands around its leader's pick (its first person who picked, else
  its first seat that picked, else beside a plain cache as a seat alone does), its other champions 3 to 6 m from it. Solo's
  escorts become a whole crew of house bots coming down 18 to 24 m from each crew with a person
  in it, the softest crew first for a crew with a newcomer. The others' picks show on the globe
  as before, the crewmates' apart in the ally's blue.
- **Coming back and arriving beside the crew.** A Respawn return with no pick of its own, and an
  Arrival, come down 3 to 6 m from a crewmate standing deep in the light with no enemy within
  12 m of it (`crews.ts` besideCrew), never one a launch pad carries; with none, the edge of the
  light, the fair first fight or
  the quiet spot as in Solo. In every crew size the clearance of a return and of an Arrival, the
  edge's distance, an Arrival's fair foe and its crowding read the other crews only (in Solo:
  every other champion, as before).
- **The score and the end.** Respawn: a crew scores every takedown its champions land, the Last
  light and the marks included (`RoyaleState.crewScores`, kept when a drop-in's own tally starts
  from zero), and the crew with the most wins, fewer deaths then the lower crew on a tie. One
  life: a fallen champion is out for good; a crew is out once its last champion fell, the crews
  falling on one tick placed by the most health one of their fallen had before it, and the last
  crew standing wins (`RoyaleState.crewsOut`, `winnerTeam`). The winner (`winnerId`) is the
  winning crew's best champion. Every champion of a crew out is told its crew's place then
  (`royale_out`), not at its own fall.
- **The bots.** The observation's royale block names the crew's anchor (`ObsRoyale.anchor`: a
  person playing in the crew, else its first champion standing; the bot mark is public). A bot
  farther than 14 m from its anchor walks back to 5 m of it, unless the anchor stands in the
  dark, and a walk back goes on until it arrives (its destination still within 9 m of the
  anchor); within the leash it loots, takes camps and answers calls as alone. Its crewmates
  within 16 m (the odds' reach) weigh beside it in every fight's odds, the flight from a far
  stronger enemy included, and a crewmate's mark is nobody's hunt.
- **Entering.** The 'royale' message carries the crew size (`c`: 3 or 5, Solo when absent). A
  person joins the liveliest match of the variant and size asked, in a bot's seat of the crew
  with the most people first, then the champion picked as before (`server/royale_join.ts`). The
  match kept running for visitors is Solo Respawn's alone; a match of Crews starts with the
  person who asks. A Respawn drop-in in Crews is ranked with its crew from the drop; its end
  card counts its own takedowns and its time from its landing.
- **Points (ADR 0027).** A person on the same crew is no opponent: the weight doubles only for a
  person on another crew. One life's places are the crews', out of the crews: the last crew
  standing 50, the top tenth of the crews 25, the top fifth 15 (fifty seats in Solo give five and
  ten, as before). Respawn's 50 for the best score and One life's 50 go to every seat of the
  winning crew still playing, a fallen one too: a One life champion fallen while its crew
  stands can only watch, so it counts as still playing when it was at its fall.
- **The screens.** The quick pick card has a Crew choice (Solo, Trios, Fives) at the right of
  its head, remembered with the pick; Play now opens it on Solo, the tiles on the size last
  played. In Crews the top line counts crews ("Crew #3 of 16 · 12 takedowns · 2 behind #2", "5
  crews left · 7 takedowns"), the win line ("Top crew wins · 4:12 left · your crew is 3rd",
  "Last crew standing wins · 5 left") and the win card say what wins a crew, crewmates are
  drawn as allies (the health bar, the ring, the minimap) and named in the ally's blue in the
  kill feed, a One life champion out for good watches a crewmate standing
  (`src/game/crew_watch.ts`), and the end screen says the crew's place, what the seat and its
  crew scored, which crew won, and the top crews.
- **Rules 13.** The planet's rules version moves from 12 to 13; a replay records the crew size
  (`RoyaleRecord.crew`, absent for Solo) and rebuilds the crews from it.

## Measured

`node scripts/royale_crews.mjs --seeds 6`: seeds 1 to 6 of each variant and crew size, every
seat a house bot, no person (so no escort crew), rules 13 with the review's fixes (the walk
back that goes on until it arrives, the crew in the flight's odds). Solo's figures are the
same script's on the same seeds; nothing changed in Solo moves them.

- **One life** ends at 7:43 on average in Solo, 7:36 in Trios and 6:58 in Fives, with 49, 47
  and 47 takedowns. The winning crew ends with 1.3 of its three champions standing in Trios on
  average, 2.7 of its five in Fives. Crews still in by minute, Trios seed 1: 16 16 15 14 10 7
  6 4 2; Fives seed 1: 10 10 10 10 8 5 4.
- **Respawn** runs its ten minutes with 962 takedowns in Solo, 970 in Trios, 1030 in Fives. The
  best crew scores 210 against the second's 138 in Trios on average, 280 against 221 in Fives
  (the best champion in Solo: 143 against 82).
- **Together.** Of every standing champion's seconds, the share with a crewmate standing within
  the 14 m leash, a champion left alone counting as apart: 67 percent in Respawn Trios, 85 in
  Respawn Fives, 74 in One life Trios, 84 in One life Fives; the median distance to the
  nearest crewmate standing 6.0, 3.2, 4.4 and 2.2 m.
- **Beside a person.** A seat that gives no order after the landing, its crew's anchor, seeds 1
  to 4 of Respawn Trios and Fives, the first 90 s: its crewmates stand within 10 m of it for 34
  percent of their seconds, 12.3 m away at the median. Before the walk back went on until it
  arrived, 13 percent and 14.0 m: the bots stood at the leash, one step each way a slot
  (an ad hoc probe beside the script; a 10 m leash gave 49 percent and 10.2 m, but a quarter
  of the seconds past 57 m, and was left).
- **Left open.** A Respawn crew that pulls ahead stays ahead: Trios' best crew leads the second
  by half again on average (298 against 106 on seed 2), Fives' by a quarter. Nothing slows a
  leading crew yet but the Lodestar's mark on its best champion. No person played in these
  matches: a person's crew, its escort crew and a drop-in beside its crew are pinned by tests
  (`tests/royale_crews.test.ts`, `tests/royale_crew_bot.test.ts`) and browser runs, not
  measured.

## Consequences

- Solo is unchanged, match for match: every recorded and pinned royale test plays to the same
  state, and every rule that now reads "the other crews" reads every other champion there.
- The Wrath on the planet is its holder's team buff (ADR 0022's), so in Crews it strengthens the
  holder's whole crew while the holder carries it, and leaves with the holder. A ring creature's
  aspect, where one is in play, is the slayer's crew's favor.
- No crew chat, no pings and no knocked-down state; a crew of friends cannot enter together.
  Each would be its own decision.
