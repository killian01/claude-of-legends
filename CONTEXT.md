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
_Avoid_: base core, citadel, and the names other MOBAs give this structure

**Sigil**:
One of the utility spells a participant picks two of at champion select. Launch pool: Riftstep, Zephyr, Mend, Sear.
_Avoid_: utility spell, and the names other MOBAs give this pick

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
_Avoid_: dragon, boss, monster names from other games

**Warden's Boon**:
The team-wide, death-surviving damage buff granted when a team slays the Warden. Stacks a limited number of times.
_Avoid_: soul, objective buff, monster buff

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

**Account**:
The persistent identity a person plays under: one name, unique across the server and owned by
whoever registered it, one email address, plus the rating and match history earned with it.
Reaching the server at all requires one; the offline practice match does not. The name is the
whole public identity, so nothing is appended to it to tell two people apart, and the address is
never part of it: only the account itself ever sees its own.
_Avoid_: profile (that is the screen that shows an account), user, login, player (ambiguous, see Participant)

**Confirmed address**:
An email address whose owner has followed the link sent to it. Only a confirmed address can
receive a password reset, and only a confirmed address is held forever. An address nobody has
confirmed is held for a week and then goes back into circulation, so registering with someone
else's address takes it out of their reach for seven days and no longer. Confirming changes
nothing about playing: an account with an unconfirmed address queues, is rated and places on the
ladder exactly like any other.
_Avoid_: verified, validated, activated (an account is never inactive here)

**Discord account**:
An account created through the Continue with Discord button (ADR 0009): its name is derived from
the Discord name, it starts with no password and no email, and the same button signs it back in.
One Discord identity makes exactly one account here. Optional everywhere: a server without the two
Discord secrets never shows the button, and a name-and-password account plays, is rated and places
on the ladder identically, and can never be opened through Discord. What is stored (the Discord id
and a copy of the name) is never visible to another player: like an email address, only the
account itself sees its own, and the id never leaves the server at all.
_Avoid_: linked Discord (the ADR 0008 flow this replaced), OAuth account, connected account,
social login

**Same name**:
Two account names are the same name when they differ only by letter case or by the separators
in them: Bob, bob, b_o_b and b-o-b are one name, and only one account may hold it. Uniqueness
is judged on that reading, never on the raw text, so a name cannot be taken twice by dressing
it differently. What the owner typed is what everyone sees. An account may change its name, but
the name it leaves behind is never handed to anyone else: a name belongs, once and for all, to
the first account that took it. Nobody inherits another player's name, and so nobody inherits
what people remember about it.
_Avoid_: slug, normalized name, canonical name

**Roster**:
The ten champions shipped with the game (`docs/design/roster.md`), as opposed to forged
champions. The roster browser is the screen that lists champions.
_Avoid_: base champions, default cast

**Tagline**:
The one-line play-style intent under a champion's name at select and in the roster browser.
On a forged champion it carries real weight: it is what tells four allies what an unknown
kit does.
_Avoid_: blurb (the legacy field name in code), motto, description

**Forge**:
The in-game workshop where a participant creates a forged champion from scratch: name,
appearance, stats, and spells, without leaving the game. An account feature (ADR 0006).
_Avoid_: editor, character creator, workshop

**Forged champion**:
A champion authored by a participant in the Forge rather than shipped in the roster. Its kit
is data composed from the same spell primitives as the roster and must fit the power budget.
Playable only in the Forge queue.
_Avoid_: custom champion, user-generated champion

**Forge queue**:
The matchmaking queue where forged champions are allowed, alongside roster champions. Every
other queue is roster-only. Ranked on its own rating, separate from the standard queue's.
_Avoid_: atelier mode, custom game (that is a private lobby)

**Draft**:
A forged champion still being authored in the Forge: kit, stats, name, and splash art are
edited freely and previewed on the engine's stylized figure. Drafts are unlimited and free.
The 3D happens in two player-approved steps, both on the draft: the BUILD spends a creation
and produces the static model, which the creator inspects in the workshop (and may rebuild,
spending another); ANIMATE, always last and always its own click, rigs the validated model
once, bakes the clips the creator picked from the provider catalog, and seals the champion
as finalized. The seal locks the kit, the art and the model, never the animations: a sealed
champion changes any single clip and re-bakes JUST that one, freely, at no creation cost.
Reforge (its own entry) is the seal's one kit exception.
_Avoid_: WIP champion, unfinished champion

**Reforge**:
Moving a sealed champion's kit numbers after the seal. One slice is live: the basic attack
reach, which decides melee or ranged, a feel a creator only discovers in a real match.
Owner-only and free; the changed champion is revalidated in full and must still clear the
power budget, so no reforge moves power past the seal.
_Avoid_: respec, rework, nerf/buff

**Clip file**:
An animation-only model file carrying one baked batch of preset clips, no geometry, riding
beside a champion's rigged body: the unit of the per-clip bake. Changing one animation
produces one new clip file; the other roles keep theirs. Champions sealed before the split
carry their clips inside a single model file instead.
_Avoid_: animation pack, clip bundle

**Mannequin**:
The neutral gray biped every catalog animation can be previewed on, instantly and at no
cost, before it is baked onto a champion. An app asset generated once (body, rig, and the
whole preset catalog as clip files) and shipped with the client, not a champion and not
anyone's creation.
_Avoid_: preview dummy, test character

**Creation**:
The consumable unit of the Forge economy: building a draft's 3D model spends one, covering
everything that champion is owed: the static model, the later animate step that seals it,
and the weapon when one is generated (at build time or claimed afterwards). The splash art
belongs to the free drafting stage. A technical failure of the build refunds the creation;
a failed animate or weapon claim costs nothing and simply runs again. Every account
receives a weekly allocation (ADR 0011); buying more arrives with payments.
_Avoid_: credit, generation token

**Model reference**:
The technical 2D image the 3D generation accepts as its input: exactly ONE character,
full body, front view, A-pose, empty hands, plain background. One figure only, because
the 3D builder reconstructs whatever the image shows: a multi-view sheet becomes a
multi-body model. Derived from the draft's chosen splash art and iterated by the player
like any other art kind (generate, view large, pick, iterate); the 3D build runs on the
exact chosen image, never a hidden regeneration. Stored under the art kind and asset key
`sheet` for continuity.
_Avoid_: model sheet (the old multi-view term), concept art

**Gallery**:
The public browse space of finalized forged champions: every finalized champion is listed by
default (the creator can remove it), sorted by recent or popular, with likes, reports, and a
free practice test-drive. Champions whose creator leaves sharing on (the default) are
playable by anyone from the community tab at Forge-queue select.
_Avoid_: workshop, hub, marketplace

**Prop**:
A separate model hung on a named bone of a champion's rig, the hand-held weapon foremost,
with its own grip offsets. A forged champion's weapon is always a prop, never fused into the
body mesh; it comes from the house weapon library or from its own generation.
_Avoid_: attachment, accessory

**House clip**:
An animation the repo ships itself: a Mixamo clip retargeted once onto the shared rig
skeleton (every forged biped shares its bone names) and served as an app asset, so applying
one to a champion is a file copy, no provider call, no credits. Curated in weapon-family
sets (sword and shield, great sword, magic); every house clip is baked facing the rig's
rest forward and performs on the spot, because the game aligns a champion to its rest
forward and owns all movement. `scripts/bake_house_clips.mjs` is the curation record.
_Avoid_: stock animation, builtin animation

**Workshop view**:
The 3D inspection and adjustment view of a forged champion's generated model, from the
static build onwards (validating the model BEFORE animating is the point):
turntable orbit and zoom, playback of the clip set under readable names, team color
preview, a match-view camera at in-game scale, and the display tuning (below) edited
live by the creator. A view of one champion, not a place; the place players create in
is the Forge.

**Display tuning**:
The creator's saved adjustments to how a forged champion's generated model is presented:
height, facing, ground offset, and the weapon prop's kind, bone, grip offsets, and uniform
size. The grip is the point of the weapon the hand holds: the workshop lets the creator
designate it with one click on the weapon itself, and the handle aligns onto the rig's
grip axis. Stored server-side in the sealed assets, clamped by shared bounds, and read by
every client in a match; pure presentation with zero gameplay effect, exactly like skins.
_Avoid_: model settings, transform
_Avoid_: model viewer, inspector, showroom

**Splash art**:
The painted illustration of a champion, in the shared style of the set: the champion's face
at select, in the roster browser, and on the profile. For a forged champion it is also the
creative starting point: the first thing the player makes in the Forge, and the source
everything else (model sheet, then model) derives from.
_Avoid_: portrait (the legacy name in code for the resolution chain), painting

**Power budget**:
The point envelope a forged champion must fit inside: every stat point and every effect
primitive in the kit has a cost, on top of hard per-field bounds. What makes forging a set
of trade-offs instead of a max-everything form.
_Avoid_: balance score, point buy
