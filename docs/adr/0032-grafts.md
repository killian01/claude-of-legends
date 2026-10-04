# Grafts: a choice of three, several times a battle royale

A battle royale on the Wanderseed (ADR 0031) gave every champion the same arc: land at level 3,
walk the house build piece by piece, rank the spells by a fixed rule. Nothing in a match asked
the player to choose, and two runs of the same champion played alike. The genre's strongest
reason to play one more match is a choice of three cards, several times a match, that makes the
champion a different one each run (CONTEXT.md: Graft).

## Decision

- **Three grades, fourteen Grafts, as data** (`src/sim/content/grafts.ts`). A Sprout raises a raw
  stat by a share and stacks twice (attack damage and ability power, attack speed, maximum
  health). A Bough changes a rule (the heal out of a fight, a shield in one, damage on a fresh
  champion, a burst of speed when low, a takedown's heal, thorns). A Heartwood changes the kit
  (spells back on a takedown, an arcing third attack, a quicker ultimate, a root on the low, a
  burst when hit low) and shows on the champion for everyone: an aura on the planet, a mark on
  the nameplate, a field of the unit record in the observation (`ObsUnit.heartwood`) and on the
  wire (`SnapUnit.hw`).
- **Offers come on events**, drawn from the match's stream at offer time
  (`src/sim/royale/grafts.ts`): the drop's Bough in both variants (the tick after the landing
  pick, or as the drop ends, open until three seconds after the landing); in One life the
  second cache, the first camp, levels 6 and 9 a Sprout, the first takedown a Bough, the third a
  Heartwood; in Respawn an Arrival and a golden cache a Bough (the golden cache now pays one
  piece instead of two), levels 5, 7, 9 and 11 a Sprout, a Bough, a Sprout and a Heartwood; a
  Seedfall cache a Heartwood in place of its second piece; a big creature's last hit a Heartwood
  once the Risings call it (`offerCreatureHeartwood`).
- **The draw**: three distinct cards of the grade, each weighing twice when its role tag matches
  the champion's role (the house build its role walks, `playbook/kit.ts`), never what the seat
  holds or has queued (a Sprout at two stacks), never a card whose offer rule says no (the heal
  out of a fight in Respawn's Last light or with five left in One life); short of three, filled
  from the grade below; still short, one piece of loot instead.
- **The queue**: three offers at most. A fourth drops, among the waiting ones and itself, the
  lowest grade, the newest of equals. The head is open for ten seconds from the later of its
  offer and the last pick; at its deadline card 0 is taken. One life's elimination clears it.
- **The pick is an action**, `{kind: 'graft', pick: 0 | 1 | 2}`, additive to the v0 contract
  (ADR 0002): free like `level` and `drop` (no decision token, ADR 0003), taken while dead, flying
  or dropping, and not gated by the stage. A person sends the client message `graft`; the
  server's verb records it and the replay applies it through the same `Sim.pickGraft`. A bot
  picks by a policy rule over the same observation (`bot/graft_pick.ts`): the role card, the heal
  when hurt, the thorns for a shell, the first of equals; a dead seat is asked while its offer is
  open (`RoyaleMode.wantsDeadDecision`).
- **The 5v5 does not move.** Every hook (`stats.ts`, `passives.ts`, `combat/damage.ts`,
  `combat/casting.ts`, the sim's takedown) runs only for a champion holding a Graft;
  `tests/fixed_match.test.ts` pins it. The royale's rules version moves instead
  (`ROYALE_RULES_VERSION`), never `REPLAY_VERSION` or the content fingerprint.

## Consequences

- Remote and headless policies cannot play the battle royale yet: `src/net/policy_wire.ts`
  parses neither `drop` nor `graft`. The environment (ADR 0002) offers the 5v5 only.
- The planet tuning moved with the Grafts (`content/royale_tuning.ts`): Elowen gave back two
  steps of damage and Sylra took two (steps of 0.05), measured by `scripts/royale_report.mjs`,
  which now prints the Grafts held, picked and filled.
- A takedown in a Graft's text is the last hit, as everywhere on the planet: an assist resets
  no spell.
