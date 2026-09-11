# Two rings and the last creature

The Star Orchard had one neutral objective: the Warden at the center, rising at 10:00 and
every 2:30 after, whose Boon (a temporary team damage buff and a siege minion with every
wave) was the mid game's pivot. Its third export revision traced two more places to fight
over, a raised stone circle at the elbow of each side lane, 35 m from both teams' outer
towers, that nothing in the sim read. On 2026-09-11 the maintainer asked for two
creatures on those circles, rising before the Warden, each worth something permanent, on
timings that make a match interesting (`docs/plan-rings.md` holds the whole grill).

## Decision

Three creatures, in order, on a clock every player can read.

- **The rings are map content.** `GameMap.rings` (`RingSite`) is assembled from the
  export's `objectiveSites`; the launch map fixture has none, so two hundred sim tests
  keep their world and the ring tests play the export.
- **The Pyrefang on the bot ring at 4:00, the Voidmaul on the top ring at 6:30,** each
  back four minutes after its death; the Warden moves to 12:00 and keeps its 2:30, the
  last to rise. The bot ring goes first because two laners already stand beside it; the
  gap between the two rings makes a team choose between its lane and the crossing. The
  clocks drift with the deaths and end up crossing the Warden's on their own.
- **A creature is sized for a duo** (1600 hp, 55 damage, 30 resistances at 4:00, plus
  4 percent a minute like the Warden), fights champions only, ignores and is ignored by
  minions and towers, is always visible, and resets to full when pulled out of its ring
  or left alone five seconds. It pays no last-hit bounty: its xp is shared among the
  killing team present, and its death pays 150 gold to every member of that team, dead
  or alive.
- **Its aspect becomes the killing team's favor**, permanent, team-wide, surviving death,
  stacked per aspect up to four (`src/sim/favors.ts`, `src/sim/content/rings.ts`). Six
  aspects, in a fixed order per ring, the same in every match, each ring alternating
  offense and defense so neither is the boring one: the Pyrefang carries Might (+3
  percent attack damage and ability power a stack), Tide (2 percent of missing health
  every 5 s), Tempo (+5 percent attack speed); the Voidmaul carries Bulwark (+5 percent
  armor and magic resistance), Swiftness (+5 percent speed out of combat, 5 percent slow
  resistance), Resolve (6 percent tenacity and heal and shield power). The numbers follow
  the drake tiers the maintainer pointed at, and a fixed order brings an aspect back
  every third rise on its ring, so a median match sees the first tier of each. The
  Warden's Boon stays as it was: bigger, temporary, the match's prize.
- **The favors are read off the unit.** The sim's `Favors` record per team is the
  truth; every champion of the team mirrors it (`Unit.favors`), refreshed by
  `Sim.grantFavor`, because the stat recalculation, the effective speed and the effect
  seam are functions of the unit alone, and threading a team record through every
  caller of `recalcChampion` and `effectiveMoveSpeed` would touch more than it fixes.
  Out of combat means no damage taken or dealt for five seconds (`lastDealtDamageAt`
  beside `lastDamagedAt`). Tenacity shortens stuns, roots, taunts and slows at the effect
  seam, never a knockup.
- **Content, not code.** The creatures, their clocks, the aspects and their numbers are a
  table in `src/sim/content/`, hashed by the content fingerprint; `REPLAY_VERSION` moves
  to 5 for the Warden's clock and the new tick step. The replays recorded on the Orchard
  before this stop playing, as ADR 0021 said a rule change would.

## Consequences

- The bots contest the rings the way they contest the Warden, in the same change
  (`docs/design/bots.md`): the playbook language grows additively (a `creature` trigger,
  a `contestCreature` behavior, a coach order), the observation gains an additive field,
  every house style takes its stance, and the night coach's vocabulary says it.
- The wire carries the ring clocks and both teams' favors; the HUD shows an objective
  line with the three clocks and the aspect coming, and a chip per favor held, for both
  teams; the announcer gets four lines, pending their clips (`docs/design/sound.md`).
- Two procedural figures, colored by aspect; a Blender model can replace either later
  without touching the sim.
- `tests/rings.test.ts` plays the clocks, the leash, the visibility, the rewards and the
  fixed order on the export; `tests/favors.test.ts` measures every aspect on a champion
  and pins that a death keeps every stack; `tests/objectives.test.ts` moves the Warden to
  twelve minutes; `tests/replay_fingerprint.test.ts` pins that the table moves it.
