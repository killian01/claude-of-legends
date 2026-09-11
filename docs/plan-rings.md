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
  (`src/sim/rings.ts`: `initialRingStates`, `stepRings`, `onRingCreatureSlain`), called
  in the fixed tick order after the Warden step.
- **One unit kind, two creatures.** `UnitKind` gains `'creature'`; the unit carries
  `creatureId` (`pyrefang` or `voidmaul`) and the aspect it holds, so every surface
  that keys on the kind (visibility, picking, the renderer, the minimap, the HUD's
  target card, the replay marks, the death cause) handles one new branch.
- **The contract.** `Observation.creatures?: readonly ObsCreature[]` (id, position,
  `spawnAt` or null while one is alive, `unitId` while alive, the aspect coming); the
  playbook trigger `creature` (`which`: `pyrefang`, `voidmaul` or `any`; `state`: `up`,
  `spawning`, `down`; `within`), the behavior `contestCreature` (`which`, `hpAtLeast`,
  `prepSeconds`), the coach order `creature` (the live one, else the next to rise, the
  nearest on a tie). `PLAYBOOK_FORMAT_VERSION` stays 4: additive kinds, an older
  playbook keeps validating.
- **The wire.** The snapshot's self block gains the creature clocks and aspects and both
  teams' favors (optional fields, absent when empty); `ClientWorld` mirrors them;
  `IWorld` gains `creatures()` and `favors(team)`.
- **The HUD.** The meta line becomes an objective line built by a pure module
  (`src/ui/objective_line.ts`, tested): `Pyrefang 1:12 Might · Voidmaul LIVE · Warden 6:00`.
  A chip per favor held, for both teams, saying what it does (`MIGHT +3% AD/AP`). The
  rise and the claim are announced on screen and by voice, the ring is pinged on the
  minimap and flashed on the ground like the Warden's pit.
- **The fixture stays bare.** The launch map has no rings; the ring tests play the
  export the way `tests/star_orchard.test.ts` does. The Warden's tests move to 12:00.

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

## Out of scope

Authored models for the creatures; a fourth-stack climax beyond the Warden; rings on
the launch map fixture; cooldown reduction as a stat (the sim has none, so Tempo is
attack speed only).
