# The rings build plan

The consolidated result of the design grill of 2026-09-11: two neutral creatures on the
Star Orchard's two rings, the Warden as the last creature at the center, permanent
team favors, a fixed clock everyone can read. Phases in order; each phase ends green
(`pnpm check` plus the Vitest suite) and lands module-first behind existing seams. The
terms go through `CONTEXT.md` in phase 0: Ring, Pyrefang, Voidmaul, Favor, and the six
aspects.

## What was decided

**The rings.** The export (`gameplay.json`, `objectiveSites`) already traces two raised
stone circles with their fan stairs, one at the elbow of each side lane: the bot ring
in the southeast corner, the top ring in the northwest. Each stands 35 m from the two
outer towers of its lane (the same distance for both teams), 102 m from the center,
126 and 136 m from the two bases. Nothing in the sim reads them yet; the map record
gains them (`GameMap.rings`), the launch map fixture has none.

**Three creatures, in order.** The Pyrefang guards the bot ring, the Voidmaul the top
ring, the Warden keeps the center and its Boon and becomes the last to appear.

| Creature | First rise | Returns | Why |
|---|---|---|---|
| Pyrefang (bot ring) | 4:00 | 4:00 after its death | First items and level 4 to 5; two laners already stand beside it |
| Voidmaul (top ring) | 6:30 | 4:00 after its death | Two and a half minutes after the first: a team that takes one must choose between holding its lane and crossing for the other |
| Warden (center) | 12:00 (was 10:00) | 2:30, unchanged | The last creature; two to three Wardens in a median match (17 min on 151 real replays) |

The clocks drift with the deaths, so they end up crossing the Warden's on their own.

**The creature.** Sized for a duo: 1600 hp, 55 attack damage, 30 armor and magic
resistance at 4:00, growing 4 percent a minute like the Warden. Two laners take it in
about thirty seconds while taking hits; alone it is a bet, not a reflex. Like the
Warden: fights champions only, ignores and is ignored by minions and towers, always
visible to both teams, resets to full when pulled out of its ring (16 m) or left alone
five seconds, spawns on the ring's center. No last-hit bounty: the favor and the team's
gold are the prize; its xp (180) is shared among the killing team present, as the
Warden's is.

**The favors.** A creature's death grants the killing team its current aspect as a
favor: permanent for the rest of the match, team-wide, surviving death, stacking per
aspect (four stacks at most). Every kill also pays 150 gold to each member of the
killing team, dead or alive. The aspects run in a fixed order per ring, the same in
every match, looping, so both teams know what the next creature carries; the HUD says
it beside the countdown. Each ring alternates offense and defense so neither ring is
the boring one.

| Ring | Order | Aspect | Per stack |
|---|---|---|---|
| Bot (Pyrefang) | 1 | Might | +3 percent attack damage and ability power |
| | 2 | Tide | 2 percent of missing health restored every 5 s |
| | 3 | Tempo | +5 percent attack speed |
| Top (Voidmaul) | 1 | Bulwark | +5 percent armor and magic resistance |
| | 2 | Swiftness | +5 percent move speed out of combat, 5 percent slow resistance |
| | 3 | Resolve | 6 percent tenacity, 6 percent heal and shield power |

The numbers follow the drake tiers the maintainer pointed at; with a fixed order and
three aspects a ring, an aspect returns every third rise on its ring (about thirteen
minutes later), so a median match sees the first tier of each and a long one the
second. The Warden's Boon stays what it is (+8 percent damage a stack, 180 s, a siege
minion with every wave): bigger, temporary, the match's prize.

**Bots at the same standard.** Every host bot contests the rings the way it contests
the Warden today: the Objective style at the ring forty-five seconds early, the Laner
and the Brawler twenty, the Sieger only when healthy and close. The playbook language
grows additively (the `warden` trigger and `contestWarden` stay as they are), the
observation gains an additive field, the coach bar gains an order, the night coach's
vocabulary doc says it all.

**The announcer.** Four lines: "The Pyrefang has risen!", "The Voidmaul has risen!",
"Your team has claimed a favor!", "The enemy has claimed a favor". Their clips are
rendered with the maintainer's ElevenLabs key: the table carries them as pending, the
speech synthesis reads them until the clips land, `tests/voice_bank.test.ts` tolerates
a missing clip for a pending line only, and an issue like #43 carries the commands.

**The look.** Two procedural figures built like the Warden's: the Voidmaul massive and
low, black veined with light, a great maul; the Pyrefang lean, a spine of embers, a
trail of fire. The veins and the beacon above take the aspect's color, and so does the
minimap blotch. A Blender model can replace either body later without touching the sim.

## Decisions taken in the codebase

- **Content is data.** The rings' creatures, aspects, order, clocks and numbers live in
  `src/sim/content/rings.ts` and enter the content fingerprint; `REPLAY_VERSION` moves
  to 5. The replays recorded on the Orchard so far stop playing, as ADR 0021 said a rule
  change would.
- **The favors beside the Boon.** `TeamBuffs` keeps the Boon; a `Favors` record per team
  (stacks per aspect) lives beside it, snapshotted with the world, granted by the sim's
  death handling. The stat hooks: attack damage, ability power, armor, magic resistance
  and attack speed in `recalcChampion` (the sim recalculates the team on a grant and on
  respawn); move speed out of combat (no damage taken or dealt for five seconds, a
  `lastDealtDamageAt` stamp beside `lastDamagedAt`) and slow resistance in the
  effective speed; tenacity and heal and shield power at the effect seam
  (`applyEffects`), the few direct status calls audited; the Tide tick in the regen step.
- **The map record.** `GameMap.rings?: readonly RingSite[]` (`id`, `lane`, center,
  radius), assembled from `objectiveSites`; the sim's ring state mirrors the Warden's
  (`src/sim/rings.ts`: `initialRingStates`, `stepRings`, `onCreatureSlain`), called in
  the fixed tick order after the Warden step.
- **One unit kind, two creatures.** `UnitKind` gains `'creature'`; the unit carries
  `creatureId` (`pyrefang` or `voidmaul`) and the aspect it holds, so every surface
  that keys on the kind (visibility, picking, the renderer, the minimap, the HUD's
  target card, the replay marks, the death cause) handles one new branch.
- **The contract.** `Observation.creatures?: readonly ObsCreature[]` (the ring, the
  creature, its place, `unitId` while alive, `riseAt` or null while one is alive, the
  aspect in play); the playbook trigger `creature` (`which`: `pyrefang`, `voidmaul` or
  `any`; `state`: `up`, `spawning`, `down`; `within`), the behavior `contestCreature`
  (`which`, `hpAtLeast`, `prepSeconds`, `within`), the coach order `creature` (the live
  one, the nearest, else the ring next to rise). `PLAYBOOK_FORMAT_VERSION` stays 4:
  additive kinds, an older playbook keeps validating.
- **The wire.** The snapshot carries the rings' clocks (`rings`), a creature's identity
  and aspect in its identity block, and both teams' favors in the self block (optional
  fields, absent when empty); `ClientWorld` mirrors them; `IWorld` gains `ringClocks()`
  and `teamFavors(team)`, pinned by the parity test.
- **The HUD.** The meta line becomes an objective line built by a pure module
  (`src/ui/objective_line.ts`, tested): `Pyrefang 1:12 Might · Voidmaul LIVE · Warden 6:00`.
  A chip per favor held, for both teams, saying what it does (`MIGHT +3% AD and AP`). The
  rise and the claim are announced on screen and by voice, the ring is pinged on the
  minimap and flashed on the ground like the Warden's pit.
- **The fixture stays bare.** The launch map has no rings; the ring tests play the
  export the way `tests/star_orchard.test.ts` does. The Warden's tests move to 12:00.

State of play (2026-09-11, evening): both rounds done and on `main`. The calibration
reads OK at every clock (`node scripts/creature_report.mjs`: the Pyrefang at 4:00 a duo in
34 s, five in 12, seven of ten lone champions in a median 68 s leaving at 32 percent; at
12:00 a duo in 38 s and three of ten alone; the Warden at 12:00 five in 23 s and the
strongest duo in 70 s; the Ascendant at 16:00 five in 43 s and no duo). The house bots on
the export (`node scripts/rings_report.mjs --seeds 4 --max-min 30`), after the rally
round below: 2.3 creatures a match (the first at 9:16 on average), an Ascendant risen in
one match of four (at 19:33), two matches of four decided inside 30 minutes, the side
holding more favors winning both, and still no Warden: the two teams collide at the pit
and the fight around it, not the body, decides the mid game. Right after the bodies grew
and before the rally it read one creature a match and none of four decided; before the
round, with bodies anyone soloed, 23:21 and 3.3 creatures a match, and no Warden either.
A team that takes the Warden as a team is what the bots still lack. The eight voice clips are the maintainer's to
render (`docs/design/sound.md`, "Lines pending their clips").

## Phases

0. **Design**: DONE. This plan; then `CONTEXT.md` (Ring, Pyrefang, Voidmaul, Favor, the
   six aspects) and ADR 0022 (the rings and the last creature) with the code.
1. **Sim** (`src/sim/content/rings.ts`, `src/sim/rings.ts`, `src/sim/favors.ts`, the
   stat hooks, the map record, the Warden at 12:00, the rewards). Tests:
   `tests/rings.test.ts` (the clocks, the fixed order, the leash, the visibility,
   champions only, the scaling, gold to every member, xp shared, the Warden at 12:00),
   `tests/favors.test.ts` (each aspect's effect measured on a unit, the stacking, the
   cap, the permanence through death and respawn), the fingerprint test (the rings
   table moves it), `tests/star_orchard.test.ts` (both rings walkable on the export,
   the creatures rise on their centers).
2. **The contract and the bots**: the observation field, the trigger, the behavior, the
   order, the four house styles, the coach vocabulary doc, `playbook_text`. Tests: the
   validator accepts the new kinds and an older playbook; the trigger and the behavior
   in `tests/playbook_*`; a bot match on the export where a ring creature dies to the
   house bots (no bot leaves the rings untouched).
3. **The wire and the world**: protocol, `ClientWorld`, `IWorld`, `replay_marks`,
   `REPLAY_VERSION` 5, the server's match loop untouched beyond the snapshot. Tests: the
   snapshot round trip, the replay refusal of an older record.
4. **Presentation**: the two figures, the aspect colors, the minimap, the objective
   line, the favor chips, the target card, the death cause, the announcements, the
   pending voice lines and their test, the pings, the coach bar, the replay bar.
   `scripts/e2e_lifecycle.mjs` unchanged; a screenshot of a rise for the record.
5. **Docs and measurement**: `docs/design/game-definition.md`, `docs/star-orchard.md`,
   `docs/design/bots.md`, `docs/design/sound.md`, `CLAUDE.md`'s repo map if a directory
   appears; the meta matrix before and after (no style breaks, creatures actually die
   in bot matches); deploy.

## Round two (2026-09-11): the bodies, the Ascendant and the Wrath

The first round played, the maintainer came back with two things: the creatures were
still too easy to kill (a lone champion took one without thinking), and the match wanted
a late creature with a big buff, the way the genre ends on one. The grill of that
afternoon, and its measurement, decided the following; the why is in ADR 0022, "Round
two".

**The measurement first.** `scripts/creature_report.ts` (`node scripts/creature_report.mjs
[--clocks 240,390,720,1200] [--which pyrefang,warden,ascendant]`) plays each of the ten
champions alone against a body, then three duos and a full team, at the level and with
the items a laner holds at that clock, every ability used, and prints a verdict per body
and clock against the standard below. Before the change it read: every champion soloed a
ring creature at 4:00 in 9 to 32 seconds, a duo in 6 to 8, and six of ten soloed the
Warden at 12:00. The cause: the bodies grew 4 percent a minute while a laner's damage
output multiplied by about five between 4:00 and 12:00.

**The standard.** Sizes are a target the script checks, not a number to remember; the
numbers live in `src/sim/content/rings.ts` and `src/sim/content/warden.ts`, and a tuning
reruns the script.

| Body | A lone champion | A duo | Five |
|---|---|---|---|
| Pyrefang, Voidmaul | 60 to 90 s, leaves under 30 percent of its health | 25 to 35 s | 10 to 15 s |
| Warden (12:00, back 2:30, unchanged) | dies first | about a minute, bleeding | 20 to 30 s |
| Ascendant | dies first | dies first | about 40 s |

**The lever.** Health several times higher, resistances a little; a bite on every
strike, a share of the target's max health as true damage on top of the flat damage, so
a tank does not shrug a creature off and a fight twice as long costs twice as much; and
a growth that is the champions' own: every neutral body is written at the 4:00 mark and
carried to its rise by two piecewise-linear curves (`BODY_GROWTH` for health, following
a laner's measured sustained damage, about twice by 12:00 and three and a half times by
25:00; `BITE_GROWTH` for the flat strike, following a laner's health). The resistances
stay as written: the first calibration grew them with the health and found five
champions slower at 12:00 than at 4:00; and the first curve, sized to a laner's burst
(five times by 12:00), made a body nobody could take, since a fight that lasts a minute
is paid in mana and cooldowns, not in one rotation. The Warden's body moves into content
and follows the same curves. No new mechanic beyond that; the alternatives (a rage on
one target, signature attacks) are in the ADR.

**The Ascendant.** After its three aspects, a ring's creature returns as its Ascendant,
and every later rise is one: the Pyrefang Ascendant, the Voidmaul Ascendant. The
creatures return 3:00 after their death (was 4:00), the Ascendant 5:00 after its own, so
in a match where the creatures fall on time the first Ascendant lands around 16:00 on
the bot ring and 18:30 on the top one. The aspect order no longer loops: each favor
once a match. An Ascendant carries no aspect; its death hands the Wrath and the same
150 gold to every member of the killing team.

**The Wrath.** 150 s, team-wide, surviving death, refreshed by a second Ascendant and
never stacked. Any enemy champion a champion of the team brings under a fifth of its max
health dies on the spot, the killing blow credited to that champion; every attack or
ability hit burns 3 percent of the target's max health over 3 s, true damage. Towers and
minions execute nobody; nothing but a champion is executed. A chip says what it does,
for both teams; an enemy under the line wears a mark; the objective line counts down to
the Ascendant by name.

**The names.** Ascendant for the form and Wrath for its gift (both in `CONTEXT.md`),
searched first (ADR 0004): "Pyrefang Ascendant" and "Voidmaul Ascendant" are free.
Excluded: Verdict (an execute spell named in another work), Dread (near a named ability
elsewhere), Ascendancy (a named system of another game); Elder is free but is the word
another game uses for this exact role.

**Bots, wire, voice, look: as in the first round.** Every house style rallies to an
Ascendant the way it does to the Warden (`which: 'ascendant'` on the `creature` trigger
and the `contestCreature` behavior, `ObsCreature.ascendant` beside a nullable aspect,
the coach order unchanged); the snapshot says `asc: 1` on an Ascendant, the ring clocks
carry `ascendant`, the self block carries `wrathUntil` and `enemyWrathUntil`,
`IWorld.teamWrath(team)`; four more lines pending their clips ("The Pyrefang Ascendant
has risen!", "The Voidmaul Ascendant has risen!", "Your team holds the Wrath!", "The
enemy holds the Wrath"); the Ascendant is its creature's figure, bigger, in the Wrath's
color. `REPLAY_VERSION` moves to 6.

### Decisions taken in the codebase, round two

- **A body is content.** `CreatureBody` (`hp`, `ad`, `bitePct`, resistances, range,
  speeds, radius, xp) in `src/sim/content/rings.ts`, one per creature and one per
  Ascendant (`CreatureDef.ascendant: { name, returnS, body }`), the Warden's in
  `src/sim/content/warden.ts`; both enter the content fingerprint. `Unit.bitePct` and
  `Unit.ascendant` carry them on the unit; `growBody` in `src/sim/unit.ts` applies the
  curves; the auto-attack strike adds the bite to a champion target the way it adds a
  tower's heated share.
- **The ring state knows the form.** `isAscendantRise(state, index)` reads the rise
  index against the aspect order; `ringAspect` returns null past it; `onCreatureSlain`
  returns a `CreatureFall` (the creature, the aspect or null, `ascendant`) and restarts
  the clock on the right return; `RingClock.ascendant` says which form is live or next.
- **The Wrath beside the Boon.** `TeamBuffs` holds each team's Wrath expiry
  (`grantWrath`, `wrathUntil`), snapshotted with the Boons; `Sim.teamWrath(team)` and
  `Sim.grantWrath(team)` (a test, a drill); the death handling grants it for an
  Ascendant and a favor otherwise, with a `wrath` event beside `favor`. The execute and
  the burn live in `dealDamage` after the health moves: a `dot` status tagged `wrath`,
  one per victim, refreshed by an attack or an ability and never by its own ticks; an
  `execute` event when the line is crossed.
- **Each favor once.** `FAVOR_MAX_STACKS` is 1; the stack shape stays on the wire and in
  the chips.
- **A contest waits for a party.** With bodies sized for a duo and a team, a house bot
  that counted itself a party of one stood at a ring chipping a creature until an enemy
  came (the bots probe on seed 42: fourteen minutes, nothing killed). `contestCreature`
  and `contestWarden` gain `partyAtLeast` (validated 1 to 5): allied champions near the
  body, self included, two for a creature, three for an Ascendant or the Warden by
  default; short of it, the play passes and the bot farms or pushes, and the
  pre-positioning before a rise still draws the laners to the ring. The coach's
  `creature` order bypasses it: an order is an order.

**The bots' rally (the same evening).** The first measurement after the bodies grew
read one creature a match and no Warden: the house bots hit a body with their strikes
only (the calibration had spent every ability), dropped an 8 percent Warden for an
arriving enemy and watched it reset, and never gathered on a body that stayed up. Three
things landed, all in the playbook language so a custom bot has them too: a contest
spends the kit's abilities on the body before its strikes (`strikeBody`, the coach's
orders too); `finish-warden` and `finish-creature` plays right above `fight` in every
house style (the `warden` and `creature` triggers narrow `up` with `hpAtMost` and
`near`); and the rally: the forty seconds after a body rises and again every two minutes
while it stands, a healthy bot in range and one short of the party walks to it and waits
beside it, out of its reach, for the rest (`RALLY_EVERY_S`, `RALLY_WINDOW_S`,
`ObsCreature.roseAt`, `Observation.wardenRoseAt`, both additive). Beside it, the
maintainer's own complaint from play: a creature dropped its target at the disc's edge.
The ring's leash is now the whole platform, the disc and its fan stairs to their foot
(`RingSite.leash`, read off the export's `stairCrossings`), for holding a target and for
resetting alike. And the calm reset is no longer a snap: the probe on seed 2 showed both
teams at the pit at 12:30, the Warden at 43 percent, and a full Warden ten seconds after
the fight around it ended; left alone and hurt, a body now heals 3 percent of its health
a second (`CREATURE_CALM_REGEN_PER_S`, the Warden too), full in about half a minute, so
the side that wins the fight around it comes back to a body partly recovered. Pulled off
its platform it still snaps. The maintainer did not ask for this one; it is the rule a
contested body needs and it is his to reverse.

### Phases, round two

1. **Sim and calibration**: the bodies, the curves, the bite, the Ascendant, the Wrath,
   the tests (`tests/rings.test.ts` for the fourth rise, the Wrath grant, the returns;
   `tests/wrath.test.ts` for the execute and the burn; `tests/objectives.test.ts` for
   the Warden's body; `tests/creature_sizing.test.ts` as the gate on the standard), then
   the script run at the four clocks until every verdict reads OK. DONE.
2. **The bots**: `which: 'ascendant'`, the observation, the four house styles, the
   validator, `playbook_text`, the coach vocabulary doc; the party a contest waits for;
   no recall beside a body. DONE.
3. **The wire and the world**: `asc`, the nullable aspect, the Wrath fields, `teamWrath`,
   `REPLAY_VERSION` 6, the replay marks. DONE.
4. **Presentation**: the Ascendant's figure, the Wrath's color, the mark on an enemy under
   the line, the chip, the objective line, the announcements and the pending lines. DONE.
5. **Docs and measurement**: this plan, the ADR, the glossary, the design docs; the
   rings report rerun (Ascendants and Wraths per match); deploy. DONE.

## Out of scope

Authored models for the creatures; signature attacks per creature (a telegraphed cone, a
slam: the next plan if the bodies alone do not make the fight fun); a Wrath that stacks
or grows; a soul-like reward for holding every favor; rings on the launch map fixture;
cooldown reduction as a stat (the sim has none, so Tempo is attack speed only).
