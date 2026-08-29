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

**Decision slot**:
The recurring opportunity in which a Policy produces exactly one action: one slot every five ticks, so four per second of sim time, staggered per participant so the ten seats do not all decide on the same tick. The slot is the scarce resource, not the decision budget: a slot spent restating a movement intention is a slot not spent casting.
_Avoid_: policy tick, frame, turn

**Remote policy**:
A Policy that runs outside the sim process and drives a seat through the same observation and action contract as an in-sim one, one action per decision slot. What a trained bot uses to join: the sim never runs the model, it only ships observations and accepts actions.
_Avoid_: agent, external AI, remote controller

**Environment**:
The headless host that runs a match with no browser and no server, exposing the Policy contract over a line stream so a trainer outside the repo can step the match. One step is one decision slot.
_Avoid_: gym, harness, env wrapper

**Skin**:
A purely cosmetic appearance variant of a champion, chosen at champion select and visible to everyone. Never affects gameplay, stats, or the Policy observation.
_Avoid_: costume, chroma

**River**:
The open diagonal corridor between the two halves, running from the point where the top lane crosses it to the point where the bot lane does. Neutral ground: it holds the two Warden pits, and it is the road between the lanes, so rotating from one lane to another goes along it instead of back through your own base. No jungle wall may stand in it.
_Avoid_: stream, channel, mid river (it is one river, end to end)

**Warden**:
The neutral river monster. It spawns in one of two mirrored river pits on an announced clock, is always visible to both teams, fights only champions, and the team that lands the killing blow claims the Warden's Boon.
_Avoid_: dragon, boss

**Warden's Boon**:
The team-wide, death-surviving damage buff granted when a team slays the Warden. Stacks a limited number of times.
_Avoid_: soul, objective buff

**Windup**:
The commitment beat before a hit lands. For an ability: costs are paid at press, the spell resolves after the delay, and a stun during it cancels the cast. For an auto-attack: the strike resolves a beat after the swing starts; moving, a stun, or a dash cancels it and refunds the attack timer (the orb-walk rule), and a target that blinks out of reach makes the committed strike whiff. The counterplay window big hits owe their victims.
_Avoid_: cast bar, channel (a channel would persist after resolving; no ability has one yet)

**Telegraph**:
The visible warning a dangerous spell shows before it lands: the windup's aimed shape, or a delayed zone's marked ground. Fairness rule: whoever can see the caster sees the telegraph, both teams alike. Presentation reads it from the sim; it never changes gameplay.
_Avoid_: indicator (that is the caster's own aim preview)

**Recast**:
A follow-up resolution of an ability, triggered by pressing the same key again inside its
declared recast window. Each press is budgeted like any cast; the wire action is unchanged
(ADR 0005). At most a few kits carry one.
_Avoid_: toggle, double cast, channel

**Aftershock**:
A delayed second eruption along a line an ability already struck: the ground stays visibly
marked, then detonates once more after a fixed delay. A telegraph by construction (both teams
read the marked ground); standing on it is the mistake. Torv's Faultline is its owner.
_Avoid_: echo, replay, second wall

**Mastery**:
A purely cosmetic per-champion rank derived from a player's recorded online matches on that champion (server/mastery.ts thresholds). Shown on the career profile with a title per rank; never affects gameplay, matchmaking, or rating.
_Avoid_: champion points, grind level

**Tower heat**:
The count of consecutive shots a tower has fired at the same champion. It resets on every
target change and drives both halves of the shot: the attack damage ramps, and so does the
slice of the victim's max health the shot takes as true damage. What makes a dive a
commitment rather than a visit.
_Avoid_: tower stacks, turret aggro (that is the targeting rule, not the damage)

**Structure**:
A tower or a Sanctum. Structures are immune to spells outright: they fall to attacks and to
minions, never to an ability, and they take no crowd control or displacement. Skillshots fly
over them rather than being eaten by them.
_Avoid_: building, objective (the Warden is an objective and is not a structure)
