# The forest build plan

The consolidated result of the maintainer's three notes from play on 2026-09-11, after the
rings' second round (`docs/plan-rings.md`): the fog of war must cover the two ring
creatures and their platforms; the Warden should not always rise at the plaza but sometimes
at a random place in the forests; the forests want a jungler's post and some variety in
the camps. ADR 0023 holds the why; this file holds what was decided and what the
measurement said.

## What was decided

**The fog.** Two faults with one look. In the sim a ring's creature was revealed to both
teams by design (ADR 0022 copied the Warden's rule); it now sits in the fog like a camp,
its clock public and its body seen only with sight on the ring. In the renderer the fog was
a flat sheet 4.1 m up while the ring discs stand at 3.3 m and the spawn terraces at 3.8 m,
so a creature on its disc stood lit through it; the sheet is now draped over the terrain,
every vertex 4.1 m over the ground under it. The Warden keeps its reveal (not asked for;
its health bar is the fight both teams read). The playbooks read the clock where they read
the body: a bot walks to a ring whose clock says up, and the fog lifts on arrival.

**The Warden's pits.** The map lists named pits; the first Warden rises at the first, every
later one at a pit drawn from the match's rng among the others, never the same twice
running. The Star Orchard's forests are corridors three to six meters wide with the camps in
rooms about six meters across: measured on the grid, the widest ground away from the camps
and the lanes is four rooms of seven to fourteen meters, two a forest, each with its point
mirror on the other side. Those are the pits beside the plaza:

| Pit | Where | Room |
|---|---|---|
| plaza | the center, the first Warden's | 18 m across |
| west glade | the west forest, south room | 14 m |
| west hollow | the west forest, north corridor | 7 m |
| east glade | the east forest, north junction | 8 m |
| east hollow | the east forest, south room | 10 m |

A pit in one team's forest is that team's shorter walk; the draw is fair on average. The
draw is told to nobody until the Warden stands there (the maintainer's note after the first
deploy: where the Boon appears must not be on the minimap before it pops): the objective
line says "Warden 2:10" until the rise, then "Warden LIVE at the west glade", and the
announcement names the room; a bot guesses the nearest pit before, as a human would. A
Blender revision with two authored clearings, one a forest, would let the forest fights
breathe; the rooms are what the export has.

**The camps.** Three kinds, data-as-code (`src/sim/content/camps.ts`), every body written
at the 4:00 mark and grown with the clock like the rings' creatures and the Warden:

| Camp | Bodies | Body at 4:00 | Pays | Back after |
|---|---|---|---|---|
| Spinecrest | 1 | 600 hp, 38 damage, 15 resistances | 85 gold, 110 xp | 90 s |
| Brackenlings | 3 | 210 hp, 13 damage, 8 resistances each | 32 gold, 40 xp each | 90 s |
| Barkmaw | 1 | 900 hp, 45 damage, 20 resistances, the attack speed buff | 130 gold, 170 xp | 120 s |

A forest's round from its team's door is the Spinecrest, the Brackenlings, the Barkmaw (the
buff camp at the far, contested end), keyed by distance from the owning team's fountain, so
both junglers walk the same round. A full round pays about 310 gold, what a lane's waves
pay in the same minute and a half. The names were searched before they were taken:
Duskmite (a How to Train Your Dragon creature), Gloomling (Star Wars), Cindermite (World of
Warcraft), Mireling (Siralim) and Gnarlmaw (Warhammer) were found in use and refused.

**The team's memory of its camps.** A jungler cannot know whether a camp stands without
looking, and a policy cannot remember (a replay re-attaches fresh policies after a
checkpoint). So the sim remembers for the team, from its own vision, what it last saw at
each spot (standing or empty, since when), and the observation carries it (`ObsCamp`), the
way it carries the enemies last seen. The route reads that: a spot never looked at is due at
0:30, a spot seen standing is up, a spot seen empty is up again once its kind's clock has
run since the team first saw it empty.

**The Jungler.** A post, not a draw: the fill's fifth seat is the forest's (a fighter, a
tank, a skirmisher or an assassin), taken last so a smaller team keeps its lanes, and every
five-seat house team fields the Jungler on it; a lane seat still draws among the four lane
styles. In the playbook language the post is the forest as a lane preference (`lanes:
["jungle"]`, a seat with no lane, `lane` trigger `jungle`) and the `jungle` behavior (the
camp in reach cleared with the kit's abilities, else the walk to the camp the team believes
up and can reach first, the own forest by default). The Jungler's own playbook: the
Objective player's stance on every neutral body from across the map (the rings within 90),
a fight that holds alone, a gank at three levels and the health for it, the round, the
Laner's tail on mid.

## State of play

Measured on the house bots (`scripts/rings_report.ts`, seeds 1 to 4, capped at 30
sim-minutes), against the rings' round two (2.3 creatures a match, no Warden ever taken
by bots):

| Seed | Length | Creatures | Wardens (pit) | Camps cleared, team 0 / team 1 (by the jungler) |
|---|---|---|---|---|
| 1 | 27:00 | 5 | 3 (plaza, west glade, plaza) | 56 / 29 (56 / 28) |
| 2 | 28:24 | 3 | 1 (plaza) | 58 / 57 (58 / 55) |
| 3 | 30:00, undecided | 2 | 2 (plaza, east glade) | 74 / 53 (74 / 53) |
| 4 | 27:12 | 3 | 1 (plaza) | 40 / 62 (39 / 61) |

3.3 creatures a match, the first at 5:09 on average (the jungler is the second body at
the first Pyrefang); 1.8 Wardens a match where there were none, two of the seven in a
forest room; the junglers clear nearly every camp their team takes, a round every two
minutes or so. The matches stay long (27 to 30 minutes, one undecided): the bodies were
sized for that in the rings' round two, and a jungler on each side does not shorten them.
On seed 42 alone, a Jungler clears its first round (the Spinecrest at 0:40, the
Brackenlings by 1:00, the Barkmaw at 1:29) and its second by 2:40, reaching level 5 by
4:00.

## Phases

1. The fog: the sim rule, the draped sheet, the playbooks' clock reading, the tests. DONE.
2. The Warden's pits: the named list, the draw, the observation, the wire, the worlds, the
   objective line, the minimap, the bots, the tests. DONE.
3. The camps: the content, the kinds on both maps, the packs, the growth, the memory, the
   wire, the figures, the names on the HUD, the tests. DONE.
4. The Jungler: the language, the seating, the fill, the style, the playbook, the Academy's
   select and the coach's grammar, the tests. DONE.
5. Docs and measurement: this plan, the ADR, the glossary, the design docs, the report,
   deploy. DONE.

## Out of scope

The Warden in the fog; authored forest clearings (a Blender revision); a coach order for
the camps; camp abilities; a jungler for a smaller team; a human's lane label for the
forest (a human roams as they like).
