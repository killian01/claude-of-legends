# Roster and vocabulary (draft)

Status: accepted (grill round 3). Numbers are deliberately absent; balance lands with implementation. See ADR 0004 for the naming policy.

The per-champion ability lists below summarize the CURRENT kits (the v2 redesign);
`docs/design/kits-v2.md` is the detailed design with verdicts, structural numbers, and bot
playbooks. Identities, roles, and lanes are unchanged from launch. This file remains
authoritative for the vocabulary table and the roster's coverage intent.

## Game vocabulary

| Concept | Our name |
|---|---|
| Team core structure | **Sanctum** |
| Picked utility spells (2 per participant) | **Sigils** |
| Blink sigil | **Riftstep** |
| Move speed sigil | **Zephyr** |
| Burst heal sigil | **Mend** |
| Damage-over-time plus healing reduction sigil | **Sear** |

Kept as generic genre vocabulary: tower, minion, lane, brush, recall, fog of war, fountain.

## Ability primitives

Every ability below is composed from a small set of shared, data-as-code effect primitives. This is what makes 10 champions (50 abilities) feasible in the sprint:

projectile (line, cone, wave, chain) - traveling dash and blink - zone (damage, slow, heal, vision, reveal) - wall - aura - shield and heal - crowd control (slow, root, stun, knockup, knock-aside, pull, taunt) - stealth - stat modifier - on-hit stacks - conditional effects - empowered attack - cooldown events - recast.

## The ten champions

### Korrath, the Bulwark (Tank, top)

An immovable frontline anchor: the fight happens where he says it does.

- Passive, Shieldskin: gains a small shield after a few seconds without taking damage.
- Q, Shield Slam: telegraphed melee cone strike that slows.
- W, Iron Wall: raises a real stone rampart across the aim, blocking paths and dashes for a beat.
- E, Earthgrip: fissure skillshot that pulls the first enemy hit; a target dragged against terrain (his own rampart included) is stunned first.
- R, Earthbreak: a true leap with a telegraphed landing; the epicenter knocks up, the rim only slows.

### Dain, Emberfist (Fighter, top)

A momentum brawler who banks Heat and spends it in beats.

- Passive, Heat: attacks build Heat; at full Heat the next ability deals bonus damage.
- Q, Blazing Jab: traveling punch through enemies on its line; hitting a champion refunds half the cooldown, killing one resets it. Minions and camps never move it.
- W, Cinder Guard: a jump onto an ally in reach (no ally, no cast); self shield plus a burn on enemies where he lands, and a shield broken by damage detonates around him.
- E, Ember Flurry: ignites the next attack: bonus damage, a splash behind the victim, one extra Heat stack.
- R, Emberfall: calls a comet down on a telegraphed zone; the epicenter stuns and burns, the rim slows.

### Sylra, Thornweaver (Mage, mid)

A zone-control mage; standing near her victims is itself a mistake.

- Passive, Barbed Marks: abilities mark enemies; the third mark roots briefly.
- Q, Thorn Bolt: line skillshot that chains once to a second nearby enemy; both hits mark.
- W, Bramble Field: zone dealing damage over time and slowing; marks on entry.
- E, Verdant Shell: shield on self or an ally that bursts thorns (damage plus a mark) when it breaks or expires.
- R, Overgrowth: large zone that roots everyone still inside after a delay; at max rank the detonation leaves a lingering slow patch.

### Fenn, the Quickblade (Assassin, mid)

A single-target executioner who commits hard, in and out.

- Passive, Opportunist: bonus damage against low-health targets; a takedown on a recently struck champion resets Lunge.
- Q, Lunge: traveling dash, visible and interceptable.
- W, Twin Fangs: two fast projectiles; bonus damage against isolated targets.
- E, Smoke Veil: brief stealth and move speed.
- R, Shadow Flurry: a windup, then a traveling strike down a short line, untargetable only in flight; recast within the window to blink back to the cast position.

### Elowen, Mistward (Battlemage, mid or flex)

A skirmishing mage who bends vision itself.

- Passive, Mistborne: dealing ability damage grants brief move speed.
- Q, Mist Lance: piercing line poke.
- W, Veil: zone that blinds enemies inside and conceals allies within the mist.
- E, Drifting Step: short blink, the roster's one true teleport.
- R, Whiteout: large slow-and-damage storm; an enemy walking out over the rim is knocked back inward.

### Vesk, the Longshot (Marksman, bot)

Artillery range, immobile and terrifying: distance is damage.

- Passive, Deadstill: attacks against slowed or immobilized targets deal bonus damage.
- Q, Piercing Round: very long line skillshot whose damage grows with distance traveled.
- W, Caltrops: zone slow.
- E, Backstep: short vault that leaves a caltrop patch at the launch point, plus an attack speed reload.
- R, Horizon Shot: map-crossing projectile; a short slow up close, a longer stun the farther it flew.

### Ashvyn, Nightbow (Marksman, bot)

A mobile duelist marksman on a rhythm of thirds.

- Passive, Twinshot: every third attack strikes twice.
- Q, Shadow Volley: cone of arrows.
- W, Hunter's Step: traveling dash that primes the Twinshot counter.
- E, Pinning Arrow: single skillshot that roots at long range, slows up close.
- R, Eclipse Rain: arrow storm zone that reveals enemies inside for its duration.

### Maera, Tidecaller (Support, healer)

The tide gives and takes in the same wave.

- Passive, Spring Tide: her heals splash a portion onto a second nearby ally.
- Q, Tide Surge: wave skillshot that damages enemies and heals allies it passes through.
- W, Rising Spring: heal-over-time zone; allies in critical health heal double.
- E, Undertow: slowing wave skillshot.
- R, Great Wave: giant wave that sweeps enemies aside and shields the allies it passes.

### Torv, Stonehorn (Support, engage tank)

The one who starts the fight; the earth answers.

- Passive, Bulwark Aura: nearby allies gain a small armor bonus.
- Q, Horn Charge: traveling charge that plows bystanders aside; the impact point knocks up.
- W, Challenge: taunts nearby enemies briefly.
- E, Tremor Stomp: area burst around self; already-slowed enemies are rooted instead of slowed again.
- R, Faultline: line shockwave that stuns along its path; the crack stays marked and erupts a second time (the Aftershock).

### Rhoka, Wildclaw (Skirmisher, flex)

A diving brawler who feeds on extended fights.

- Passive, Rend: attacks apply stacking bleed; three or more bleeds inflict grievous wounds.
- Q, Pounce: traveling leap; hitting a bleeding target refunds most of the cooldown.
- W, Savage Sweep: claw burst around self, bonus damage per bleed stack on targets.
- E, Primal Howl: area slow plus self attack speed surge.
- R, Apex Frenzy: attack speed surge; while it holds, attacks on bleeding targets heal Rhoka.

## Coverage check

Roles: 2 top (tank, fighter), 3 mid or flex (mage, assassin, battlemage), 2 marksman, 2 support (heal, engage), 1 skirmisher flex. These are the home lanes (`CONTEXT.md`): the fill completes a team by them and the sim seats each champion in its own. Every crowd-control primitive, projectile shape, and zone type is exercised by at least one kit, so the roster doubles as a test matrix for the effect system.
