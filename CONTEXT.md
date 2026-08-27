# Claude of Legends

A 5v5 three-lane MOBA in the browser. One deterministic simulation, an authoritative server, and bots behind a single Policy abstraction.

## Language

**Champion**:
A playable character a participant controls for the whole match. Ten exist at launch.
_Avoid_: hero, character, class

**Participant**:
One of the ten seats in a match, human or bot.
_Avoid_: player (ambiguous; say "human" for people)

**Bot**:
A participant whose actions come from a Policy instead of a human.
_Avoid_: AI, NPC, computer player

**Policy**:
A deterministic decision function (observation, rng) -> action, with the exact observation and action space the Gym environment exposes. The single abstraction behind every bot, scripted or trained.
_Avoid_: agent, brain, controller

**Sanctum**:
The team's core structure. Destroying the enemy Sanctum wins the match.
_Avoid_: base core, citadel

**Sigil**:
One of the utility spells a participant picks two of at champion select. Launch pool: Riftstep, Zephyr, Mend, Sear.
_Avoid_: utility spell

**Decision budget**:
The token bucket that rate-limits budgeted actions identically for every participant: refills at about 4 per second of sim time, capacity at most 2, both configurable. Ability casts are budgeted; movement is not.
_Avoid_: APM cap, input throttle

**Movement intention**:
A participant's persistent movement order. The sim samples the latest one every tick; replacing it costs no decision budget.
_Avoid_: movement command (implies one-shot)

**Skin**:
A purely cosmetic appearance variant of a champion, chosen at champion select and visible to everyone. Never affects gameplay, stats, or the Policy observation.
_Avoid_: costume, chroma

**Warden**:
The neutral river monster. It spawns in one of two mirrored river pits on an announced clock, is always visible to both teams, fights only champions, and the team that lands the killing blow claims the Warden's Boon.
_Avoid_: dragon, boss

**Warden's Boon**:
The team-wide, death-surviving damage buff granted when a team slays the Warden. Stacks a limited number of times.
_Avoid_: soul, objective buff

**Windup**:
The cast time of an ability: costs are paid at press, the spell resolves after the delay, and a stun during it cancels the cast. The counterplay window big spells owe their victims.
_Avoid_: cast bar, channel (a channel would persist after resolving; no ability has one yet)

**Telegraph**:
The visible warning a dangerous spell shows before it lands: the windup's aimed shape, or a delayed zone's marked ground. Fairness rule: whoever can see the caster sees the telegraph, both teams alike. Presentation reads it from the sim; it never changes gameplay.
_Avoid_: indicator (that is the caster's own aim preview)
