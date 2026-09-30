# A seat asks its lane at select

A person used to be seated in a lane nobody told them about: the sim dealt every champion its
role's home lane (`src/sim/lanes.ts`), a human's seat counted like a bot's, and nothing on
the wire or on screen said which lane it was. The maintainer's reading of the first visitors
was that they were dropped on the map with no direction. `docs/plan-forest.md` had deferred
"a human's lane label for the forest (a human roams as they like)"; this decision reverses it.

- **The choice.** Champion select offers four lane preferences: top lane, mid lane, bot lane
  and the forest. The champion's home lane is preselected (the lane with the most room for a
  Skirmisher) and follows each champion clicked until the person picks a lane themselves, so
  there is no "any" button. The forest is open to every champion; one the fill would not post
  there is told the camps will be slow. A bot card (ADR 0013) shows its playbook's lane and
  the row stays disabled: the playbook's lanes win.
- **First come, first served.** A claim is sent as it is made (`{ t: 'lane' }`) and the own
  team sees every claim live in `select_update`, keyed by seat index because names are not
  unique; the enemy never sees them. A five-seat team takes at most two top, one mid, two bot
  and one forest, with top and forest sharing two seats. A full lane is greyed out; the
  server refuses a claim on it. When select ends, every person holds a concrete lane
  (`src/sim/lane_picks.ts`).
- **The fill composes around it.** A held seat's lane consumes its fill seat before the role
  rule runs (`src/sim/fill.ts`): a person in the forest means no house Jungler, a second top
  takes the forest's seat. Every house seat now carries the lane of the fill seat it was
  drawn for, which also fixes all-house teams that left mid empty when a Skirmisher drawn for
  mid drifted to top. Ranked bots' playbook lanes are held the same way.
- **The sim keeps it.** The seat's ask lives on `Unit.pickedLanes`, apart from the brain's
  `lanePrefer`, so the disconnect stand-in no longer erases a person's lane or re-deals the
  team; a forest seat's stand-in is the Jungler. `ReplayPick.lanes` is additive and applied in
  `buildMatchSim`; a record without it re-simulates exactly as before, so `REPLAY_VERSION`
  does not move.
- **The match tells.** `SelfSnap.lane` carries the assigned lane every snapshot (setup,
  rejoin, drop in, any re-deal). The HUD shows a card naming the lane once the opening shop
  is closed, a tap on it walks the champion there, the minimap draws the lane, and an arrow
  beside the champion points the way until arrival. Replays and spectators show none of it; a
  coach seat is told its bot's lane.

A newcomer who drops in (ADR 0025) still takes a bot's seat as it is and is told its lane.
ADR 0018 called a fresh account's spill into top "the shop's first lesson"; with a lane
preference any champion can ask for top, which softens that argument without changing the
collection. The observation contract (ADR 0002) is unchanged: `ObsSeat.lane` and
`ObsSelf.lane` existed already, only their values follow the asks.
