# Claude of Legends

A 5v5 three-lane MOBA in the browser. One deterministic simulation, an authoritative server, and bots behind a single Policy abstraction.

## Language

**Champion**:
A playable character a participant controls for the whole match. Ten exist at launch.
_Avoid_: hero, character, class

**Participant**:
One of the ten seats in a match: a human, a bot, or a house bot.
_Avoid_: player (ambiguous; say "human" for people)

**Bot**:
A participant whose actions come from a Policy instead of a human, owned and fielded by an
account: a name, one champion with its sigils and skin, a playbook, and a record. "Bot" alone
always means this owned one; the server's unowned filler is always called a house bot.
_Avoid_: AI, NPC, computer player, golem, agent

**House bot**:
The server's own unowned bot that fills a seat nobody took and no ranked bot could take: a
house style on the roster champion the fill hands it. Never rated, named by its style
("House sieger"), obeys no one.
_Avoid_: bot fill, backfill bot, default bot

**House style**:
One of the brains a house bot plays: the Laner, the Brawler, the Sieger or the Objective
player, each a playbook anyone can read. Drawn from the match seed for every seat the fill
hands out, on every host, so two matches on different seeds are not played the same way.
_Avoid_: personality, difficulty, AI level, preset, house playbook

**Fill**:
How a team's empty seats are completed. Ranked bots first: the pool's bots seated from the
match seed, one per account, no champion twice inside a team, each an owned seat rated on
its account's live way. Then house bots on the roster's lanes around what the team holds, a
tank or a fighter for each top seat, a mage, an assassin or a battlemage for mid, a marksman
and a support for bot, the skirmisher wherever a seat is open, drawn from the match seed
among the champions the team does not hold. The same rule on every host: the live queue,
the Arena (house bots only there), sparring, offline practice, the environment.
_Avoid_: draft (the Forge's term), autofill, backfill, composition

**Home lane**:
The lane a champion's role plays by default: top for the tank and the fighter, mid for the
mage, the assassin and the battlemage, bot for the marksman and the support. The skirmisher
has none and takes the lane with a seat open. A five-seat team holds one mid, two top and
two bot; a champion sits in its home lane while a seat is open there, and every champion of
a team holds a lane from the start, a human's seat counted like a bot's.
_Avoid_: role lane, default lane, position, main lane

**Bot lane**:
The lane the marksman and the support call home, drawn along the bottom and the right of
the screen for both teams, as the top lane is drawn along the left and the top. Always said
in full, "bot lane" and "top lane", never "bot" alone: a bare "bot" is the owned
participant. "Bottom" is the same word.
_Avoid_: bot (alone), low lane, side lane

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
The team-wide, death-surviving damage buff granted when a team slays the Warden. Stacks a
limited number of times. While it lasts, every wave the team sends carries a siege minion:
holding the river turns into pressure on the lanes.
_Avoid_: soul, objective buff, monster buff

**Windup**:
The commitment beat before a hit lands. For an ability: costs are paid at press, the spell resolves after the delay, and a stun during it cancels the cast. For an auto-attack: the strike resolves a beat after the swing starts; moving, a stun, or a dash cancels it and refunds the attack timer (the orb-walk rule), and a target that blinks out of reach makes the committed strike whiff. The counterplay window big hits owe their victims.
_Avoid_: cast bar, channel (a channel would persist after resolving; no ability has one yet)

**Reach**:
How far a button actually threatens, in world units: a skillshot's or a cone's own length,
a leap's landing distance, a zone's or a burst's cast range plus its rim. Distinct from
cast range, which is only where the cast is aimed, and from attack range, which is the body's
own. The roster's reach floors (no spell shorter than its caster's attack, a melee engage of
at least 6, one button past the attack on every champion) are gated by
`tests/champion_reach.test.ts`; a wider reach is paid for out of the Kit envelope like any
other power.
_Avoid_: spell range, ability range

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

**Multikill**:
A run of kills by one champion, each landing inside the leash the one before it opened:
two is a double kill, five a pentakill, and there is nothing above five (the chain
restarts, so the next fight can climb again). The leash is not one number, it widens as
the chain climbs, and it is counted in sim seconds so every client reads the same fight
the same way (`src/ui/multikill.ts`). Dying ends your own chain. The lower rungs are
called to the killer alone; from the quadrakill up the whole lobby is told. Purely
cosmetic: it pays nothing, changes no rating, and appears in no record.
_Avoid_: killing spree, streak (that is `killStreak`, the unbroken run since your last
death, which sets the shutdown bounty), combo

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

**Home**:
The page a signed-in account lands on: the bar to every section, the play tiles, and under
them the home's panels: the account's own place and numbers, the top of the ladder by hand,
the top bots, and the latest champions out of the Forge, each a way into the section that
holds the rest. Everything under the bar stands in one column, centered on a wide window.
A section opens under the bar rather than over it, so the bar stays and one click goes from
any section to the next.
_Avoid_: menu, main menu, lobby (that is the private one), dashboard, launcher, feed, widget

**Play tile**:
One of the five ways into a match on the Home, each a painted scene of its own: the Ranked
queue, Bots, the Forge queue, a Private lobby, Practice. The tile is the button.
_Avoid_: card (that is the pre-game menu's), button, mode select, panel

**Layer**:
A screen that opens over what was there and closes back to it: a section of the Home, a
drawer, a pre-game card, the match, a replay. Each open layer is one entry in the browser's
history (ADR 0020), so Back closes the top one rather than leaving the site. A guarded layer
refuses Back and says so instead: the match opens its pause menu.
_Avoid_: page (the landing and the Home are pages; what opens over them is a layer), route,
modal, view, screen (too broad to say what Back does to it)

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

**Collection**:
The champions of the roster an account may pick: the four every account starts with, plus
every one it has recruited with laurels. A bot fields only its owner's collection.
_Avoid_: owned champions, roster (that is the ten the game ships), library, inventory

**Rotation**:
The three roster champions every account may play for one week whatever its collection, the
same three for everyone, changing on a fixed weekly turn.
_Avoid_: free week, trial champions, loan

**Laurel**:
What an account earns by playing a match by hand, and spends to recruit a champion into its
collection. Never granted, never bought, and never spent on anything the server pays a
provider for: that is the ember's job, and the two never convert either way.
_Avoid_: coin, credit, point, ember (that is what the server spends), mark (that is Sylra's)

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

**Ranked queue**:
The public matchmaking queue, roster champions only, filled with house bots for any seat
nobody takes. A match from it is rated when a human sits on each side. Ranked here is the
same adjective as a ranked bot: in rated play.
_Avoid_: public queue, standard queue, solo queue, normal queue

**Private lobby**:
A room one account opens and others join with its code or invite link, played on the
roster and never rated. Its host may send the whole room into the Ranked queue as one party.
_Avoid_: custom game, room, custom lobby

**Practice**:
The offline match against dummies, run entirely in the browser tab with nothing saved and
no account needed. The same simulation the rated match runs.
_Avoid_: offline mode, sandbox, training, tutorial

**Forge queue**:
The matchmaking queue where forged champions are allowed, alongside roster champions. Every
other queue is roster-only. Rated on its own rating, separate from the Ranked queue's.
_Avoid_: atelier mode, custom game (that is a private lobby)

**Draft**:
A forged champion still being authored in the Forge: kit, stats, name, and splash art are
edited freely and previewed on the engine's stylized figure. Drafts are unlimited and free.
The 3D happens in two player-approved steps, both on the draft: the BUILD spends its embers
and produces the model, rigged (its skeleton comes with it) and with its weapon when one was
made, which the creator inspects and dresses in the workshop (and may rebuild, spending
again); ANIMATE, always last and always its own click, bakes onto that skeleton the clips
the creator picked from the provider catalog, at its own price. Neither waits on a finished
kit: the 3D is built from the chosen reference image and owes the spells nothing, so a
creator who arrives with an image can see it stand up before they have written a spell.
Full validation stands at the Seal, where it decides whether anyone else may meet the
champion. Neither seals: the Seal (its
own entry) is the creator's own separate click, in the editor's Actions rail.
_Avoid_: WIP champion, unfinished champion

**Rig**:
The skeleton inside a forged champion's model, made by the build in the same run as the
model itself and priced into it. It is not a step of its own: bones are what a Prop hangs on
and what a Clip file moves, so a build returns a model whose weapon can be placed in the
workshop immediately, without buying animations first to get a hand to hang it on. The
rigged body, not the static one, is what every client shows. A champion built before the
build rigged has none; its first bake rigs it once and pays the rig then.
_Avoid_: skeleton pass, auto-rig step, bone setup

**Seal**:
The creator's explicit click that marks a champion finalized: the kit, the art and the
model lock, and the champion may enter the gallery. It is the one gate where EVERYTHING
must hold, the power budget included: a champion nobody else can meet is the right place
to demand a legal one. It is an act on the whole champion, so
it stands with the other champion actions in the editor's right rail rather than inside any
one creation step (playtest: under the animations it read as a setting of the clips). Never
a side effect of another step (playtest: a lock that arrives unasked reads as a bug). The
seal spares the animations: a sealed champion re-bakes any clip freely. Unsealing is the
same door in reverse, any time, owner-only: the champion returns to a draft and leaves the
gallery until resealed. Reforge (its own entry) is the seal's one in-place kit exception.
_Avoid_: finalize button, lock, publish

**Reforge**:
Moving a sealed champion's kit numbers after the seal. One slice is live: the basic attack
reach, which decides melee or ranged, a feel a creator only discovers in a real match.
Owner-only and free; the changed champion is revalidated in full and must still clear the
power budget, so no reforge moves power past the seal.
_Avoid_: respec, rework, nerf/buff

**Spell animation**:
An ability key's own cast animation, picked by the creator from the cast and strike
catalogs in that spell's editor block. A spell without one plays the champion's shared
cast clip. Baked and re-baked freely like any clip, seal or no seal.
_Avoid_: ability clip, per-spell override

**Spell look**:
One ability's visual effects as data on the ability itself: the body of the bolt and what
it trails, the shape of the cast, the impact and the detonation, the floor of a zone and
what moves in it, an optional palette. Every word comes from a closed vocabulary the
renderer draws out of its own primitives, so a look can ask for nothing the shipped
catalog could not, and every number sits on a hard rail. A look travels with the champion
definition, which is what lets a champion invented after the client shipped have spells of
its own: the authored catalog is code keyed by champion id, and a forged id was never in
it. Any part a look leaves out keeps the game's default for that part. Cosmetic
throughout: the sim never reads a look, and the power budget never prices one.
_Avoid_: VFX config, particle preset, spell skin

**Look suggestion**:
A proposed spell look per key, written by a model from the champion's chosen splash and
its kit, in the same conversation form the kit and stat suggestions take. Every proposal
is checked word by word against the look vocabulary and then through the full validation
gate before it reaches the editor, and nothing touches the form until the creator applies
it. It generates no asset and downloads nothing, so it is priced as a model turn and not as a
build.
_Avoid_: VFX generation, effect art job

**Brief**:
The Forge's first door: one line of intent from the creator ("a stone warden who makes
leaving the lane expensive"), and a whole champion comes back written, in one answer.
Identity, role, the passive and four spells, base stats and growth, and the sentence the
splash art starts from, all fitted to the envelopes and cleared by the full validator
before the creator sees it, so what is proposed is playable as it stands. It exists
because assembling a champion field by field asks one person to be an art director, a
game designer and a technical artist at once: the brief makes the first champion something
to CHANGE rather than to author. Priced as one turn of a conversation, and like every
proposal in the Forge nothing touches the form until the creator takes it. It never
touches art, the 3D model or the sounds; asking again is another champion from the same
line. Drafts only.
_Avoid_: autogenerate, one-click champion, wizard

**Kit suggestion**:
A proposed passive and four spells, written by a model from the champion's own chosen
splash art. Suggestions arrive in a conversation the creator iterates in ("more mobility
on the E"); each answer is a whole proposed kit, shown with its derived descriptions and
its budget bill, and nothing touches the form until the creator applies it. A suggestion
must clear the same validation a hand-written kit does, and arrives fitted to the Kit
envelope line rather than tiptoeing under it, held under the Burst caps. The answer
streams: the creator reads the
comment as the model writes it. The creator may write in any language; the comment
answers in kind, the kit itself is English like the roster (ADR 0004). The thread and
its latest proposal are saved with the draft, so a reload finds them; nothing reaches
the form unreviewed. Drafts only: a sealed kit is locked.
_Avoid_: AI kit, autogenerated champion, chat bot

**Flavor line**:
One authored sentence per spell and for the passive: the spell's image in the
champion's world, shown in italics above the derived mechanics text, which the game
writes from the spec in the same words for every champion and which no one edits by
hand. A kit suggestion writes one for each; the creator rewrites it freely. English
like every card text, word-filtered like every card text, at most 160 characters.
_Avoid_: description, lore, tooltip text

**Stat suggestion**:
A proposed line of base stats and growth per level, written by a model from the
champion's role and kit (no splash needed) in a conversation the creator iterates in
("a tanky frontliner", "faster but frailer"). Each answer arrives fitted to the Stat and
Growth envelope lines, one shared factor per group over the points above each floor,
the melee or ranged choice and its reach held as asked; it is shown as read-only twins
of the two Stat polygons beside what moves, and nothing touches the live polygons until
the creator applies it. Applied, the vertices stay the creator's to pull. The thread
and its latest proposal are saved with the draft. Drafts only.
_Avoid_: AI stats, auto-tune, stat generator

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
anyone's own work.
_Avoid_: preview dummy, test character

**Ember**:
The one unit the Forge and the Academy both burn: what an account spends whenever the
server pays a provider on its behalf (ADR 0017). Every paid act is priced in embers by what
it actually costs us, so a 3D build is dear, a clip bake is a fraction of it, a 2D image a
fraction again, and a turn with the coach or the kit conversation cheaper still. Every
account receives a weekly grant of 100, which is a forged champion a fortnight, and it
rolls over; a brand new account is topped up ONCE to what one whole champion takes, art
included, because meeting a wall before having made anything at all is the worst place in
the Forge to meet one. The ledger is the same append-only one as before, with the balance
derived and never stored, and any failure refunds exactly what it debited. The creator
arbitrates their own week, trading rerolls against animations. One ember is one cent of
what the server spends, so the weights are read off measurement and never argued about:
`docs/design/generation-costs.md` holds them and `server/embers.ts` is the table.
A whole champion costs 115 plus its art.
_Avoid_: credit, token, generation token, point

**Creation**:
A champion someone forged, in the ordinary sense of the word. It is no longer a unit of
anything: what the acts of making one cost is counted in embers (ADR 0017). Building a
draft's 3D model, baking its animations and forging its weapon are each their own priced
act, and a technical failure of any of them refunds what it took.
_Avoid_: forge credit, creation credit

**Model reference**:
The technical 2D image the 3D generation accepts as its input: exactly ONE character,
full body, front view, A-pose, empty hands, plain background. A machine reads it against
those rules before a build spends on it, at the classify stage where stopping is still
free, and refuses only the two faults that make a model nobody can use (more than one
figure, a cropped body); it says what it saw, and the creator may build anyway, because it
is an eye and not a gate with a key. One figure only, because
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
body mesh; it comes from the house weapon library or from its own generation. A forged
weapon places ITSELF the first time the workshop opens on it: the hand the rig names, and
the grip its own shape implies (a handle is thinner than what it swings). That is a
proposal like any other, shown and said out loud, and it becomes real only when the creator
saves the tuning.
_Avoid_: attachment, accessory

**House clip**:
An animation the repo ships itself: a Mixamo clip retargeted once onto the shared rig
skeleton (every forged biped shares its bone names) and served as an app asset, so applying
one to a champion is a file copy, no provider call, no credits. A champion that has baked
nothing BORROWS a five-role house set from the moment it is rigged, chosen by its weapon
family: a built model is seen playing (in the workshop and in a match) before its creator
has picked a single animation, and its own bake replaces the borrowed set whole. Borrowed
clips are named as borrowed wherever they show, and a champion cannot be sealed on them.
Curated in weapon-family sets (sword and shield, great sword, magic); every house clip is
baked facing the rig's rest forward and performs on the spot, because the game aligns a
champion to its rest forward and owns all movement. `scripts/bake_house_clips.mjs` is the
curation record.
_Avoid_: stock animation, builtin animation

**Workshop view**:
The 3D inspection and adjustment view of a forged champion's generated model, from the
static build onwards (validating the model BEFORE animating is the point):
turntable orbit and zoom, playback of the clip set under readable names, team color
preview, a match-view camera at in-game scale, and the display tuning (below) edited
live by the creator. Hanging the weapon needs bones, which a built model already has;
a champion built before the build rigged is told so plainly instead of shown an empty
bone list. A view of one champion, not a place; the place players create in
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
The point envelope a forged champion must fit inside, the sum of three envelopes (Stat,
Growth, Kit) that never trade points with one another: every stat point and every effect
primitive in the kit has a cost, on top of hard per-field bounds and the Burst cap. What
makes forging a set of trade-offs instead of a max-everything form, and what makes a
champion with every envelope full the equal of the roster, never its better.
_Avoid_: balance score, point buy

**Stat envelope**:
The share of the power budget that base stats alone may spend, sized to the roster's
statsiest champion. Points the kit leaves unspent never flow into it.
_Avoid_: stat budget, stat cap

**Growth envelope**:
The share of the power budget that per-level growth alone may spend, sized to the
roster's best scaler.
_Avoid_: growth budget, scaling cap

**Kit envelope**:
The share of the power budget that the passive and the four spells together may spend,
sized to the roster's priciest kit. The line the kit conversation fits its proposals to.
_Avoid_: spell budget, kit budget

**Burst cap**:
The ceiling on what one cast may deal to a single target at rank 1, measured against a
reference target fresh out of the fountain: one cap for a basic spell, a higher one for
the ultimate, and one for the three basics together. It says what the power budget
cannot: the budget prices damage per second of availability, never the size of one hit,
so a nuke on a long cooldown was cheap and lethal at level 1 until the cap.
_Avoid_: damage cap, lethality score, one-shot rule

**Stat polygon**:
The Tuning tab's stat editor: an interactive polygon, one axis per priced base stat,
whose vertices the creator pulls outward to buy a stat and inward to free points. A
vertex stops where the Stat envelope runs out, so overspending is impossible by
construction, and the numbers are read at the axis tips, never typed. Growth per level
is a second, smaller polygon on its own Growth envelope. The melee or ranged choice is a
toggle beside it, an identity, not an axis: a melee champion's reach is pinned off the
polygon, a ranged champion's reach is one more axis. The envelope is the polygon's own:
lightening the kit never buys stat room, and no set of vertices reaches every rail. A
Stat suggestion lands on it whole when applied; the vertices stay the creator's.
_Avoid_: radar chart, spider chart, stat sliders

**Power dial**:
A spell's one intensity control: it scales the spell's amounts (damage, healing, crowd
control durations) inside the engine's bounds and stops where the Kit envelope or a
Burst cap runs out, saying which, exactly like a Stat polygon vertex. Structure (the
cast kind, the effect kinds, the shapes) is not its business: that comes from the kit
suggestion or the advanced editor. Rhythm (cooldown, mana cost, cast range, windup)
stays typed beside it, in plain units. The kit conversation's proposals arrive already
fitted to the Kit envelope line by the same scaling, one shared factor across the four
spells, the spells a Burst cap stops held there while the others take the room: the
model sizes roughly, the arithmetic lands the numbers.
_Avoid_: power slider, spell level

**Play**:
One rule of a playbook: a trigger over the observation plus the behavior to run while it
holds, with its parameters. Each decision slot, the first play whose trigger holds is the
one that acts.
_Avoid_: rule, node, behavior (that is the play's second half)

**Playbook**:
A bot's whole decision policy as data: an ordered list of plays, evaluated top down and
interpreted by one Policy in the sim. The micro (last hits, dodging, which key does what)
is the engine's, never the playbook's. The Laner is the default playbook every bot starts
as. Versioned like the Policy contract, and it grows only additively.
_Avoid_: brain, script, behavior tree, AI

**Kit**:
The part of a playbook that says what a bot works toward rather than what it does now: a
build, a skill order, and variants, each a trigger with its own build or skill order. The
first variant whose trigger holds is the kit in force, decided again at every purchase and
every skill point; none holding, the defaults are.
_Avoid_: loadout, profile, settings

**Build**:
An ordered list of items a bot buys toward, components resolved by the engine in order.
Longer than the bag: past six items the next one replaces the cheapest in the bag once the
gold covers the difference, and what the build does not want is sold first.
_Avoid_: item set, shopping list, item plan

**Variant**:
One conditional entry of a kit: a trigger plus the build or skill order to use while it
holds, ahead of the defaults.
_Avoid_: branch, override, situational build (that is what a variant is for, not its name)

**Stance**:
How the fight behavior holds distance: kite (attack from the edge of range and give ground
to whoever closes), front (walk in), poke (cast, then step back). Auto picks kite for a
ranged champion and front for a melee one.
_Avoid_: positioning mode, aggression, range setting

**Odds**:
How a fight stands before it is taken, read from team vision: the strength of the allied
champions within a radius (the bot included, each weighed by health and level) over both
sides' together. One half is an even fight, above it an advantage. A play reads the odds
as a trigger, and the fight's commit is the odds under which the bot never walks in.
_Avoid_: win probability, power score, threat level

**Freeze**:
Keeping the enemy wave in front of one's own lane tower: last hits only, standing just
ahead of the tower and holding still between them, so the wave dies to the tower, the
gold is the freezer's, and the enemy laner must come deep for any farm at all. One of the
two intents of the wave management behavior; the same verb as the human's S.
_Avoid_: hold the lane, stall, camp the tower

**Shove**:
Hitting the wave to send it at the enemy tower, which is what farming the nearest minion
does. The other intent of the wave management behavior; the Laner's default farm.
_Avoid_: push (that is walking the lane with the wave), clear, fast push

**Lane opponent**:
The enemy champion the team has seen the most inside the bot's assigned lane over the last
three minutes; none when nobody was seen there. What "adapt to the opponent" adapts to
before a fight starts.
_Avoid_: laner, matchup, counterpart, vis-a-vis

**Lane partner**:
The allied champion assigned to the same lane as the bot (two top, two bot, one mid): who
a bot lanes beside, known from the start of the match.
_Avoid_: duo, lane mate, buddy

**Coach order**:
The one live instruction a bot's owner can give it during a match: go to a lane or point,
take the Warden, focus a target, back off, group on an ally, hold, free. One active at a
time, persistent until released or done, free like a movement intention, sent as a typed
ping. A bot obeys only its owner.
_Avoid_: command, directive, ping (the order rides on one, it is not one)

**Academy**:
The in-game place where an account writes and tests a bot: the conversation that edits the
playbook as patches, the play list beside it, and local sparring at full speed. An account
feature. Making a bot there is a way through five steps, each a page of the same bot: the bot
itself, its kit and its playbook with the coach beside both, sparring, then play; a bar across
the top jumps between them and Back and Next at the foot walk them in order.
_Avoid_: bot editor, bot forge, workshop, trainer, wizard (for the steps), tab (for a step)

**Ranked**:
A bot its owner marked available for rated play: the Arena's rounds and play now, and the
empty seats of live matches, where it takes a seat before a house bot. The owner's one
switch; off, the bot only spars.
_Avoid_: deposited (the store's word), in the pool, active

**Arena**:
The server-run competition of ranked bots: hourly rounds and on-demand "play now" matches
against the pool, played at full speed with no one present and never coached, rated on the
account's Arena rating, watched afterwards as replays.
_Avoid_: tournament, league, bot queue, night mode

**Sparring**:
An unrated match run only to test a bot: locally in the Academy at full speed against
house bots, or on the server to decide whether a proposed playbook change wins more before
it is applied. Never moves a rating; every bot gets the same server sparring allocation.
A series is five such matches at once, the bot's current playbook against its previous
version on the other side, the side alternating, summed into one reading.
_Avoid_: practice match (that is the human's offline match), test match, simulation

**Briefing**:
The report a bot's owner reads after the Arena has played: results and rating movement,
time and deaths per play, and the night coach's proposed playbook changes with what
sparring said about them. Nothing is applied without the owner unless they opted in, and
every applied change is a version they can undo.
_Avoid_: night report, digest, summary

**Record**:
A bot's list of the matches it played, newest first: sparring and series in the Academy,
Arena matches, and live matches where the account fielded it. Each entry carries its
kind, its result, the bot's line (kills, deaths, assists, creep score, the build it ended
on), the playbook version that played, its plays, and its replay. Capped per bot, the
oldest leaving first. The tally of won and lost is the record in the sports sense, read
one kind at a time so rated play is never blended with the sparring behind it.
_Avoid_: history, match log, ledger, and "record" for a stored replay (that is a replay)

**Replay bar**:
The replay's own controls: the badge, the speeds, the clock, the scrub track and the marks.
It rides just above the HUD's bottom block, measured rather than guessed, so it never lands
on the champion's health, mana or gold; it is dragged by its badge to anywhere else, folded
to its handle with H (the clock and the way out stay), and both choices are remembered per
browser. Dragged out of reach or left behind by a smaller window, it comes back inside on
the next open, and a double-click on the badge puts it home.
_Avoid_: timeline, scrubber, seek bar

**Replay**:
A match played again rather than filmed: the record keeps the seed, the picks (a bot's
playbook embedded whole) and the commands, and the viewer rebuilds the sim and runs it. A
match compresses to kilobytes that way, and the live path and the replay path cannot drift
apart because both go through the same functions. What it costs is that a replay is only
faithful while the sim and the content it reads are the ones that played: a champion, an
item or the map moving would make yesterday's replay play out a match that never happened.
Three guards say so instead: the replay version, bumped by hand when the sim's own code
changes; the content fingerprint, computed from the tables themselves so nobody has to
remember; and the check trail, where the match stood every ten seconds, which the viewer
compares as it plays. A record that fails the first two is not played and says why; one
that drifts mid-play stops at the first mark that differs. The trail is about a kilobyte a
match, against the five megabytes a recorded one would weigh (measured), which is the
whole reason a replay is re-simulated rather than filmed.

**Death card**:
The scene of one death on a Match sheet: where the champion fell, the allies and enemies
within reach, whether an enemy tower had it in range, and the champions and structures
around it, in words and as a thumbnail of the map. What turns "six deaths on the chase
play" into a rule to fix.
_Avoid_: death recap, kill cam

**Bot page**:
What anyone signed in may read of a bot before playing it: its owner and champion, its
rated tally and its ratings by tier, its rated matches with their lines, builds and
replays, and its playbook when the owner opened it (the owner's switch, off by default).
The page reads the same to everyone, the owner included: closed is closed, and the owner
reads their own playbook in the Academy. Reached from the ladder and the pool.
_Avoid_: scouting report (the plan's measuring script), profile (that is an account's)

**Challenge**:
An on-demand Arena match against one ranked bot the challenger chose, from the bot's
page: the challenger's bot on one side, the chosen one on the other, house bots around,
played by the server now, unrated, from the same daily allowance as play now, on both
Records.
_Avoid_: duel, friendly, custom match

**Tier**:
The named band a rating sits in, the same on every ladder: Recruit below the base rating,
then Regular, Veteran, Elite and Legend by steps of a hundred. A place a number reads as,
never a separate score.
_Avoid_: rank (that is the position on a ladder), league, division, and other games' metals

**Match sheet**:
The reading of one entry of a Record: both teams' scoreboard with their builds, time and
deaths per play, the bot's deaths with their minute and the play that held, each a link
into the replay a few seconds before, and the replay itself.
_Avoid_: match detail, post-game screen, summary, report (that is the Briefing's material)

**Rating**:
The Elo of one rated subject on one ladder, one per way. An account holds the two ways a
person sits for, by hand and the Forge queue; a bot holds the two it plays, live and the
Arena. A match moves only the rating of the way each owned seat was played; house bots
move none.
_Avoid_: MMR, Elo (the algorithm, not the number), score

**Rated subject**:
What a seat's rating belongs to: the account for a seat played by hand or in the Forge
queue, the bot for a seat its owner's bot played live or in the Arena (ADR 0016). The
owner is named beside a bot everywhere it appears, but the number is the bot's.
_Avoid_: owner, holder, player (ambiguous, see Participant)

**Ladder**:
The rated subjects of one way ranked by their rating; one ladder per way. The two ways a
person sits for rank accounts, the two a bot plays rank bots with their owner named
beside each. A position on it is a rank. A subject takes its place after three rated
matches on that way, and the same emblem, rating and rank show wherever it appears.
_Avoid_: leaderboard, ranking, board, standings

**Placement**:
A rated subject's first three rated matches on one way, before it takes its place on that
ladder. A subject in placement shows how many it has played of the three.
_Avoid_: calibration, provisional, unranked (that is a match nobody rated)

**Form**:
A rated subject's latest rated results on one way, newest first, read as a row of wins and
losses.
_Avoid_: streak, run, momentum

**Emblem**:
The image of a tier, one per tier, the same everywhere the tier shows: the ladder, an
account's place, and later the lobby and the scoreboard.
_Avoid_: badge, medal, rank icon, crest

**Way**:
How an owned seat was played: by hand, by the account's bot in a live match, by that bot
in the Arena, or by hand in the Forge queue. One rating and one ladder per way, held by
the way's rated subject.
_Avoid_: mode, queue (where the match came from, not how the seat was played), category
