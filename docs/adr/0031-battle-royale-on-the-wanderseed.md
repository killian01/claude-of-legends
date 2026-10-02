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
