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
  or left alone five seconds (since round two: pulled off its platform, stairs included;
  left alone it heals 3 percent a second instead of snapping, the Warden too). It pays no last-hit bounty: its xp is shared among the
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

## Round two (2026-09-11): the bodies, the Ascendant and the Wrath

The first round shipped and the maintainer played it: the creatures were too easy to
kill, a lone champion took one without thinking, and the match still had no big late
creature the way the genre has one. The measurement (`scripts/creature_report.ts`, each
champion alone against a body at the level and with the items a laner holds at that
clock) said how far off it was: every one of the ten champions soloed a ring creature at
4:00, in 9 to 32 seconds; a duo took it in 6 to 8; six of the ten soloed the Warden at
12:00. The cause was the growth: the bodies grew 4 percent a minute while a laner's
damage output against a body multiplied by about five between 4:00 and 12:00.

### Decision

- **A standard, not a number.** A ring creature is sized so that a lone champion takes
  a minute or more and leaves under 30 percent of its health (a tank or a support does
  not take it at all), a duo about thirty seconds, five about twelve; the Warden so that
  a lone champion dies first, a strong duo takes about a minute and leaves bleeding,
  five 20 to 30 seconds; the Ascendant so that a duo dies first and five take about
  forty seconds. `scripts/creature_report.ts` measures the
  three bodies at 4:00, 6:30, 12:00 and 20:00 against that standard and prints a
  verdict per clock; the numbers in `src/sim/content/rings.ts` and
  `src/sim/content/warden.ts` are whatever the measurement settled on, and a tuning
  reruns it.
- **The lever is the body.** Health several times higher, resistances a little, and a bite:
  every strike takes a share of the target's max health on top of its flat damage, true
  damage (`CreatureBody.bitePct`, `Unit.bitePct`, read by the auto-attack strike the way
  a tower's heated shot is), so a tank does not shrug a creature off and a fight twice as
  long costs twice as much. No new mechanic beyond that.
- **The growth is the champions' own, the sustained one.** Every neutral body is written
  at the 4:00 mark and carried to its rise by two piecewise-linear curves (`BODY_GROWTH`
  for health, following a laner's measured sustained damage against a body, about twice
  by 12:00; `BITE_GROWTH` for the flat strike, following a laner's health), flat past
  their last anchor, plain arithmetic so every engine reads the same body (ADR 0019).
  The resistances stay as written. Two things the calibration taught: a body sized to a
  laner's burst (five times by 12:00, the number the measurement above quotes) was one
  nobody could take, because a fight that lasts a minute is paid in mana and cooldowns
  and not in one rotation; and resistances grown with the health double-count, five
  champions were slower at 12:00 than at 4:00. The Warden's body moves from the unit
  factory into content and follows the same curves.
- **The fourth rise of a ring is its Ascendant** (`isAscendantRise`), and so is every
  later one: the Pyrefang Ascendant, the Voidmaul Ascendant, the same silhouette grown
  into a body a team fights, no aspect, back five minutes after each death. The
  creatures return three minutes after theirs (was four), so the first Ascendant lands
  around 16:00 on the bot ring and 18:30 on the top one in a match where the creatures
  fall on time. The aspect order no longer loops: each favor comes once a match
  (`FAVOR_MAX_STACKS` is 1).
- **The Wrath.** An Ascendant's death hands the killing team the Wrath for 150 s beside
  the Boon (`TeamBuffs.grantWrath`, `wrathUntil`): team-wide, surviving death,
  refreshed by a second Ascendant and never stacked. In the one damage pipeline, a
  champion of the team that holds it finishes any enemy champion it brings under a
  fifth of its max health (the kill credited to that champion, an `execute` event for
  the presentation), and every attack or ability hit burns 3 percent of the target's max
  health over 3 s as true damage, one burn per victim, refreshed by a hit and never by its
  own ticks (`tag: 'wrath'` on the dot). Towers and minions execute nobody; nothing but a
  champion is executed. Its death pays the same 150 gold to every member.
- **The wire and the world.** A creature's identity block says `asc: 1` for an Ascendant,
  the ring clocks carry `ascendant` and a null aspect for its rise, the self block carries
  `wrathUntil` and `enemyWrathUntil`, `IWorld.teamWrath(team)` is pinned by the parity
  test, and `REPLAY_VERSION` moves to 6.

### Alternatives rejected

- A rage that ramps on the one target the creature keeps hitting, reset when it switches:
  it punishes the solo squarely, but it asks the bots to swap aggro, and a fix for the
  human lands for the bots in the same change or not at all.
- A signature attack per creature (a telegraphed cone for the Pyrefang, a slam for the
  Voidmaul): more fun, and a plan of its own (creature abilities, telegraphs, effects,
  bots that dodge). Out of scope here, not refused.
- The genre's soul gate (the Ascendant once a team holds four favors, the rings going
  quiet): it rewards dominating the rings, but in a 17-minute median match a team must
  take nearly every creature to see it, so most matches never would.
- A fixed clock (both rings turning Ascendant at 15:00): the simplest, but it cuts the
  aspect table short (Tempo and Resolve would never come) and rewards nothing.
- For the Wrath's name, Verdict (an execute spell named in another work), Dread (near a
  named ability elsewhere) and Ascendancy (a named system of another game) were searched
  and excluded; for the form, Elder is free but is the word another game uses for the
  same role.

### Consequences

- The aspects no longer loop: a team holds each favor at most once; the favor chips and
  the wire keep their stack shape with a cap of one.
- The return clocks move to 3:00 (creature) and 5:00 (Ascendant); the Warden keeps
  12:00 and 2:30, its Boon unchanged.
- The bots contest an Ascendant the way they contest the Warden, in the same change:
  `which: 'ascendant'` on the `creature` trigger and the `contestCreature` behavior,
  `ObsCreature.ascendant` and a nullable aspect, every house style rallying to it.
- The HUD's objective line names the Ascendant and counts down to it, a chip says what
  the Wrath does for both teams, an enemy under the line wears a mark, the announcer
  gets four more lines pending their clips (`docs/design/sound.md`), and the Ascendant
  wears the Wrath's color over its creature's figure.
- The replays recorded under version 5 refuse to play, as ADR 0021 said a rule change
  would; `tests/rings.test.ts`, `tests/wrath.test.ts`, `tests/objectives.test.ts` and the
  fingerprint test pin the new rules.
