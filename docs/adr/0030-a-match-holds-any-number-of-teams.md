# A match holds any number of teams

The sim knew two teams: `TeamId` was `0 | 1`, the enemy of a team was `1 - team`, and vision,
favors, team buffs and every per-team record were pairs. The battle royale (ADR 0031) is a
free-for-all of fifty champions: every champion is its own team.

## Decision

- **`TeamId` is a number.** A match has a team count, two for the 5v5, one per champion in a
  free-for-all; neutral units keep their own flag as before.
- **An enemy is a different team.** Every `1 - team` that asks "is this an enemy" asks
  `a !== b` (and the neutral rule beside it); per-team records are arrays the size of the team
  count; vision gives one set per team.
- **The systems only the 5v5 has stay two-team.** Lanes, waves, towers, Sanctums, the fountain,
  lane picks and the coach still name "the other team" (`otherTeam`), and run only in a match of
  two teams.
- **The 5v5 does not move.** The same units in the same order, the same draws from the same
  random stream: a recorded 5v5 bot match pinned by its final state (`tests/fixed_match.test.ts`)
  plays to the same state.
- **The wire and the environment are additive.** A unit's team on the wire is a number as it
  was; the public observation of the environment (ADR 0002) keeps its two-team shape for the
  5v5 and is not offered on a free-for-all.

## Consequences

- The HUD reads a free-for-all as one ally (the player) and everyone else an enemy.
- Points (ADR 0027) weigh "a human on the other team" as any other human in the match.
