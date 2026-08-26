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

**Decision budget**:
The token bucket that rate-limits budgeted actions identically for every participant: refills at about 4 per second of sim time, capacity at most 2, both configurable. Ability casts are budgeted; movement is not.
_Avoid_: APM cap, input throttle

**Movement intention**:
A participant's persistent movement order. The sim samples the latest one every tick; replacing it costs no decision budget.
_Avoid_: movement command (implies one-shot)
