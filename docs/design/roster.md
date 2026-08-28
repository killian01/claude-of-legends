# Roster and vocabulary (draft)

Status: accepted (grill round 3). Numbers are deliberately absent; balance lands with implementation. See ADR 0004 for the naming policy.

The per-champion ability lists below describe the LAUNCH kits and are superseded by
`docs/design/kits-v2.md` (the kit redesign, accepted and implemented); identities, roles, and
lanes are unchanged. This file remains authoritative for the vocabulary table and the roster's
coverage intent.

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

projectile (line, cone, wave) - dash and blink - zone (damage, slow, heal, vision) - aura - shield and heal - crowd control (slow, root, stun, knockup, knock-aside, pull, taunt) - stealth - stat modifier - on-hit stacks.

## The ten champions

### Korrath, the Bulwark (Tank, top)

An immovable frontline anchor.

- Passive, Shieldskin: gains a small shield after a few seconds without taking damage.
- Q, Shield Slam: melee cone strike that slows.
- W, Iron Wall: brief self armor and magic resist surge.
- E, Earthgrip: maul slam sending a fissure of grasping stone; pulls the first enemy hit to Korrath.
- R, Earthbreak: leap to a zone, knocking up enemies around the impact.

### Dain, Emberfist (Fighter, top)

A brawler who wants extended trades.

- Passive, Heat: attacks build Heat; at full Heat the next ability deals bonus damage.
- Q, Blazing Jab: short dash plus strike.
- W, Cinder Guard: self shield that burns nearby enemies while it holds.
- E, Ember Wave: cone burst that slows.
- R, Emberfall: calls a comet down on a telegraphed zone; the impact stuns and leaves the ground burning.

### Sylra, Thornweaver (Mage, mid)

A zone-control mage who locks areas down.

- Passive, Barbed Marks: abilities mark enemies; the third mark roots briefly.
- Q, Thorn Bolt: line skillshot.
- W, Bramble Field: zone dealing damage over time and slowing.
- E, Verdant Shell: shield on self or an ally.
- R, Overgrowth: large zone that roots everyone still inside after a delay.

### Fenn, the Quickblade (Assassin, mid)

A single-target executioner who commits hard.

- Passive, Opportunist: bonus damage against low-health targets.
- Q, Lunge: dash through a target, dealing damage.
- W, Twin Fangs: two fast projectiles.
- E, Smoke Veil: brief stealth and move speed.
- R, Shadow Flurry: rapid strikes on one target, untargetable while striking.

### Elowen, Mistward (Battlemage, mid or flex)

A skirmishing mage who bends vision itself.

- Passive, Mistborne: dealing ability damage grants brief move speed.
- Q, Mist Lance: piercing line poke.
- W, Veil: zone that shrinks the vision radius of enemies inside it.
- E, Drifting Step: short blink.
- R, Whiteout: large zone with heavy slow and damage over time.

### Vesk, the Longshot (Marksman, bot)

Artillery range, immobile and terrifying.

- Passive, Deadstill: attacks against slowed or immobilized targets deal bonus damage.
- Q, Piercing Round: very long line skillshot.
- W, Caltrops: zone slow.
- E, Backstep: small hop backward plus an attack speed reload.
- R, Horizon Shot: map-crossing slow projectile.

### Ashvyn, Nightbow (Marksman, bot)

A mobile duelist marksman.

- Passive, Twinshot: every third attack strikes twice.
- Q, Shadow Volley: cone of arrows.
- W, Hunter's Step: short dash that resets the Twinshot counter.
- E, Pinning Arrow: single skillshot that roots on hit at max range, slows up close.
- R, Eclipse Rain: arrow storm zone.

### Maera, Tidecaller (Support, healer)

Sustain and wave-shaped utility.

- Passive, Spring Tide: her heals splash a portion onto a second nearby ally.
- Q, Tide Surge: wave skillshot that damages enemies and heals allies it passes through.
- W, Rising Spring: heal-over-time zone.
- E, Undertow: slowing wave skillshot.
- R, Great Wave: large wave that knocks enemies aside and shields allies it touches.

### Torv, Stonehorn (Support, engage tank)

The one who starts the fight.

- Passive, Bulwark Aura: nearby allies gain a small armor bonus.
- Q, Horn Charge: dash that knocks the first enemy hit aside.
- W, Challenge: taunts nearby enemies briefly.
- E, Tremor Stomp: area slow around self.
- R, Faultline: line shockwave that stuns along its path.

### Rhoka, Wildclaw (Skirmisher, flex)

A diving brawler who feeds on extended fights.

- Passive, Rend: attacks apply stacking bleed.
- Q, Pounce: dash to a target area.
- W, Savage Sweep: claw burst around self, bonus damage per bleed stack on targets.
- E, Primal Howl: area slow plus self attack speed surge.
- R, Apex Frenzy: for a duration, attacks heal Rhoka and strike faster.

## Coverage check

Roles: 2 top (tank, fighter), 3 mid or flex (mage, assassin, battlemage), 2 marksman, 2 support (heal, engage), 1 skirmisher flex. Every crowd-control primitive, projectile shape, and zone type is exercised by at least one kit, so the roster doubles as a test matrix for the effect system.
