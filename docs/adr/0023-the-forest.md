# The forest: a jungler, three camps, a Warden that moves

The rings' second round (ADR 0022) left the maintainer three things to say from play, on
2026-09-11: the fog of war did not cover the two ring creatures, the ring platforms showed
through it; the Warden always rose at the plaza and should sometimes rise somewhere in the
forests; and the forests wanted a jungler's post and some variety in what stands at the
camps. Three changes to the same ground, decided together (`docs/plan-forest.md`).

## Decision

- **A ring's creature sits in the fog like a camp.** `Sim.isVisible` reveals structures and
  the Warden to both teams, and nothing else; a creature's clock stays public (the ring
  block on the wire, `ObsCreature`), its body is seen only by a team with sight on the
  ring. The Warden keeps its reveal: both teams watching its health bar is the drama the
  first design chose, and the maintainer named the two creatures. The playbooks read the
  clock where they read the body: a bot walks to a ring whose clock says up, and the fog
  lifts on arrival (`contestCreature`, the `creature` trigger's bare `up`, the coach's
  creature order).
- **The fog sheet follows the terrain.** The renderer's fog was a flat plane four meters
  up; the ring discs and the spawn terraces stand three to four meters above the ground,
  so a creature on its ring stood lit through the fog with its platform. The sheet is now a
  grid draped over the terrain, every vertex the same height over the ground under it
  (`src/render/fog_sheet.ts`, `tests/fog_sheet.test.ts`), the same fog canvas painted onto it.
- **The Warden's pit is drawn.** `GameMap.wardenPits` is a named list; the first Warden
  rises at the first pit and each later one at a pit drawn from the match's rng among the
  others, never the same twice running (`drawPit`, `ObjectiveState.pit`). On the Star
  Orchard: the plaza, then four forest rooms, the widest ground the forest corridors open
  into away from the camps (seven to fourteen meters across, measured on the grid; the
  forests hold nothing wider), each with its point mirror on the other side, so a match
  draws them fairly on average while a pit in one team's forest is that team's shorter walk.
  The pit is public with the clock: the observation (`wardenPit`), the wire (`objPit`, an
  index into the map's pits), `IWorld.wardenPit`, the objective line ("Warden 2:10 at the
  west glade"), the minimap, the announcement. The bots pre-position at the drawn pit.
- **Camps are content of three kinds** (`src/sim/content/camps.ts`): the Spinecrest (one
  body, the plain camp), the Brackenlings (three small bodies, paid per body, back together
  once the last falls), the Barkmaw (one big body, the attack speed buff, slower to come
  back). Each spot holds a kind (`CampSpot.kind`); a forest's round from its team's door
  is the Spinecrest, the Brackenlings, the Barkmaw, so both junglers walk the same round and
  the buff camp is the far, contested end of each forest (`starOrchardCamps`, by distance
  from the owning team's fountain). Every camp body is a neutral body like the others,
  written at the 4:00 mark and grown with the clock (`createCamp` through `growBody`), so a
  round at twelve minutes is not free. The names were searched for other games' use before
  they were taken (Barkmaw, Spinecrest, Brackenlings; Duskmite, Gloomling, Cindermite,
  Mireling, Gnarlmaw were found in use and refused).
- **A team remembers its camps.** Beside the bodies, the sim keeps what each team last saw
  at every spot (`CampSighting`: when it looked, whether bodies stood, since when it has seen
  the spot empty), noted from the tick's own vision, and the observation carries it
  (`ObsCamp`), fog-honest the way `lastSeen` is. A jungler routes on that memory, never on
  the sim's truth: a camp the enemy took quietly costs one walk, the way it costs a human
  one.
- **The Jungler is a post.** The playbook language gains the `jungle` behavior (clear the
  camp in reach with the kit's abilities before the strikes, else walk to the camp the team
  believes up and can reach first; the own forest by default) and the forest as a value of
  the lane preference and the `lane` trigger; a seat that asks for the forest first holds no
  lane (`assignLanes` returns null for it, the `lane` trigger reads `jungle` there). The fill
  gains a fifth seat kind, the forest's (a fighter, a tank, a skirmisher or an assassin),
  taken last so a smaller team keeps its lanes, and every five-seat house team fields the
  Jungler on it, the fifth house style, by post rather than by draw (`fillSeats`,
  `houseSeats`); a lane seat still draws among the four. The Jungler's playbook
  (`src/sim/content/playbooks/jungler.ts`) is the Objective player's stance on every neutral
  body from across the map, a fight that holds alone, a gank once it has three levels and the
  health, the round in between, the mid push as its tail.
- `REPLAY_VERSION` moves to 7; the camps' table joins the content fingerprint.

## Alternatives rejected

- Fogging the Warden with the creatures: not asked for, and the always-visible health bar
  is the fight both teams read; the Warden is now sometimes in a forest room, where the
  reveal matters more, not less.
- A raised flat fog plane instead of a draped sheet: the parallax between the plane and the
  ground grows with the height, and a plane high enough for a creature on a disc would sit
  eight meters over a champion on the ground.
- Warden pits at the camps themselves: two neutral bodies on one spot, both leashed there.
  The rooms beside the camps are the forests' next-widest ground.
- A Warden pit drawn uniformly with repeats allowed: two Wardens running at the same forest
  room is the one draw a team cannot answer; "never the same twice" keeps the draw and
  removes it.
- Camp memory in the playbook interpreter (a stateful policy): a policy is a pure function
  of the observation and the rng, and a replay re-attaches fresh policies after a checkpoint
  restore; memory belongs to the sim, in the observation, like `lastSeen`.
- The Jungler as a sixth draw for any seat: a support jungler is a bad match for everyone
  in it; the forest is a seat with its own eligible roles, so the post comes with a body
  that can clear a camp at level one.

## Consequences

- Older replays refuse to play (version 6); the Arena's, the Academy's and the queue's
  house teams all field a jungler from this deploy, on every host alike.
- The house bots' measurement moves: with the jungler as a second body at the first
  Pyrefang the rings fall sooner (`docs/plan-forest.md`, state of play). `scripts/rings_report.ts`
  prints the camps each jungler cleared and the pits each Warden rose at.
- The Academy's lane select offers the forest; the coach's grammar says it; the play list
  reads "clear the camps of my forest".
- `tests/warden_pits.test.ts`, `tests/camps.test.ts`, `tests/jungler.test.ts`,
  `tests/fog_sheet.test.ts` pin the four decisions; `tests/rings.test.ts` and
  `tests/rings_wire.test.ts` now expect a creature in the fog.
