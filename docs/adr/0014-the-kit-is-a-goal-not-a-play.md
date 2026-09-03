# Every choice is the playbook's, and the kit is a goal, not a play

The second playtest round of the bots mode (`docs/design/bots.md`) came back with two
complaints from the maintainer playing their own bot: nothing about the build could be
controlled, and the bots were far from a player in reasoning. The first is a boundary
question, the second a quality one, and the two are entangled: a smarter default only
helps if the owner can also override it, and an override is only worth writing if the
engine can execute it well.

We decided three things. First, the boundary of ADR 0013 stands, but redrawn on one rule:
**everything that is a choice belongs to the playbook, everything that is execution
belongs to the engine.** The item build, the skill order, which enemy to fight, how to
hold distance, and where to lane are choices; last hits, dodging, aim, and which key is
the escape are execution. Second, **the build and the skill order are goals, not plays**:
they live in a `kit` section of the playbook, with variants keyed on the same triggers
the plays use, resolved again at every purchase and every skill point. A play says what
to do now; a kit says what to work toward. Third, **bots may sell**, by the same rule as a
human (at the fountain, for seventy percent), through a new action of the Policy
contract, so a build can be longer than the bag and a leftover component never rots.

## Considered options

- **Build and skill order as plays** (`shop` with a plan parameter, `levelUp` with an
  order): rejected. The level reflex runs before the list, so a conditional order in a
  play would fire only when nothing above it acted; the list's order and the engine's
  reflexes would fight; and the Academy would have no single place to show "the build".
- **A profile beside the playbook** (build and skills as bot fields outside the play
  data): rejected. A bot is one document, one version, one thing the coach edits and the
  replay embeds; two documents are two histories.
- **Opening the micro** (attack-move, dodge on and off, key combos as playbook data):
  rejected, as in ADR 0013. The ladder ranks decisions; a micro contest is an execution
  contest nobody without expertise can enter, and every bot would converge on the same
  script.
- **Keeping the scripted Laner parity pin**: retired. The pin proved the rewrite in phase
  1; keeping it would freeze the default bot's execution at the level of the scripted
  brain, and the whole point of engine growth is that every bot, house bots included,
  plays better without its owner changing a line. What replaces it is a win-rate gate:
  a changed default Laner must beat the previous one over a fixed set of seeds.
- **Stat priorities instead of an item list** ("damage, then attack speed"): rejected
  for v1. A list is how a MOBA player thinks and what the model writes reliably;
  situational choices are variants on triggers, which already exist.

## Consequences

- The playbook format grows to version 2, additively: an optional `kit` (`build`,
  `skills`, `variants`), two optional parameters on `fight` (`stance`, `target`), and a
  `sell` behavior. A version 1 playbook validates and plays unchanged; a play that never
  named a stance gets `auto`, which kites on a ranged champion and walks in on a melee
  one. That is an execution change under an old playbook, which the format promise
  allows: it promises that an old playbook keeps playing, not that the engine never
  improves under it.
- The Policy contract gains `{ kind: 'sell', slot }`, additive like every v0 growth
  (ADR 0005): a trainer that never sends it is unaffected. Visible champions carry their
  champion id in the observation, which is what a viewer reads off the screen anyway.
- The engine's three role builds become data, the defaults of a kit that names none, so
  the walk from a bag to the next purchase is one generic recipe walker for owner builds
  and defaults alike: components in recipe order, a finished item consumed by a later one
  still counts as owned, a leftover the build no longer wants is sold first, and past a
  full bag the next target replaces the cheapest item once the gold covers it.
- The Academy shows the kit beside the play list, editable by hand, and the coach gets one
  more operation to write it. The item catalog enters the coach's grammar.
- `tests/fixtures/legacy_laner.ts` and the tick-for-tick parity tests go; a gate script
  plays the default Laner against its previous version over fixed seeds and reports the
  win rate, the number the plan's phases use as their bar.
