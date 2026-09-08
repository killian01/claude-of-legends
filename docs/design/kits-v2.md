# Champion kits v2

Status: accepted (maintainer validation, 2026-08-28), including the cooldown events primitive
flagged below. Implemented the same day: primitives (tests/primitives_v2.test.ts), the ten kits
(tests/kits_v2.test.ts), and the hint-driven bot brain (src/sim/content/bots/hints.ts,
tests/bots_v2.test.ts). In the implementation the conditional effect's true branch is named
`effects`, not `then` (a `then` property makes an object thenable). Deviations after the
playtest passes: Korrath's Iron Wall cooldown is 11 s, not 14 (pacing gate), and the wall
lasts 6 s, not 2.5; Dain's Q reaches 7 and resets outright on a punch kill, and Emberfall is
radius 6 with a 1.3 s fuse; Torv's Faultline no longer leaves a wall (principle 7 below): the
fissure erupts a second time instead (the aftershock, seeded as delayed-detonation zones).
The reach pass (2026-09-08) followed those playtest passes and is the last deviation: the v2
passes had lengthened Dain's punch to 7 and doubled Emberfall across without touching the
champions beside them, so the roster's reaches had stopped being a band. Measured against the
Kit envelope (`scripts/champion_matrix.mjs` for the win rates, `src/sim/forge/budget.ts` for
the bill), the fixes were Ashvyn's Shadow Volley 5.5 to 7 (it reached less far than his own
bow), his step 3.5 to 5, his arrow 9 to 10 and Eclipse Rain to radius 5.2 at 10; Rhoka's
Pounce 5 to 6 with Savage Sweep 2.4 to 3 and Primal Howl 3 to 3.6; Elowen's Veil 8 to 8.5 and
Drifting Step 4 to 5; Korrath's Shield Slam 4 to 5, Iron Wall 7 to 8 (level with the grip it
combos into) and Earthbreak 6.5 to 7; Fenn's Lunge 5 to 7 (level with Dain's punch) and
Shadow Flurry 5.5 to 6.5; Torv's Horn Charge 5.5 to 6. Every one is paid out of that
champion's own unspent Kit envelope, and none of them approaches Dain, who defines the
ceiling at 812 points of 820. The floors are written down in `tests/champion_reach.test.ts`
so the next pass cannot quietly leave a champion behind.
The bots-v2 predictive aim, CC awareness, brush pursuit, and tower discipline are implemented
via additive v0 observation fields (unit velocity, visible statuses, last-seen memory; see
`src/sim/policy.ts`).
Companion research: `docs/research/moba-mechanics-catalogue.md`, a mechanics taxonomy distilled
from a full parse of the genre-defining MOBA's roster (August 2026). That file cites competitor
champions by name as research references, so it is deliberately untracked (`docs/research/` is
gitignored) and stays a local note. This document cites mechanic families only, never champion
names; mechanical inspiration is permitted and name-level copying is not (ADR 0004).

## Why a v2

The launch kits cover the genre's effect vocabulary but create few decisions: most abilities are
stat payloads with no condition, no sequencing, and no counterplay beyond the windup. Dashes are
instant teleports, rank scaling is a flat multiplier, and the single generic bot casts everything
point blank at current positions. The v2 goal is that every ability asks a question of the caster
(when, where, in what order) and gives the opponent an answer (dodge, spread, break the setup).

## Design principles

1. **Telegraph first.** Every high-impact effect keeps or gains a counterplay window: a windup,
   a travel time, a marked zone, or a visible setup. No untelegraphed instant burst, on any kit.
2. **Anchored redesign.** Each champion keeps its proven signature mechanics; every ability gets
   an explicit verdict: keep, rework, or replace. Names, themes, roles, and lanes do not change.
3. **One click, one aim point.** Every ability stays expressible as `{cast, key, x, z}` under
   policy contract v0. No hold-to-charge, no toggle, no target-id casts, no extra slots,
   no channels. Recast (ADR 0005) is the single sanctioned extension of cast semantics.
4. **Budget-shaped kits.** No kit needs more than two back-to-back casts to function
   (decision budget: about 4 casts per second, burst of 2, ADR 0003).
5. **Bot-playable by construction.** Every ability's decision rule must be statable in one
   sentence a deterministic policy can evaluate from team-vision observations. Each kit below
   carries its bot playbook.
6. **Coverage as a test matrix.** Every effect primitive, old and new, is exercised by at least
   one kit (see the coverage table), preserving the roster.md property.
7. **One signature mechanic, one owner.** A kit-defining mechanic belongs to exactly one
   champion: the wall to Korrath, the recast to Fenn, the chain to Sylra, the aftershock to
   Torv. Sharing a signature makes both copies cheap (maintainer direction, playtest round 2).
   Generic effects (damage, slows, shields, dashes) stay shared vocabulary.

## New engine primitives

All primitives below resolve server side from one aim point and are invisible to the action
space. Each lands as its own small tested module; `observe.ts` telegraph exposure is part of the
definition of done for every one of them.

| Primitive | What it is | Exercised by |
|---|---|---|
| Conditional effects | An effect list gated by a deterministic predicate at resolution: distance traveled, target HP threshold, target isolation, target CC state, terrain contact, zone position (center vs rim), shield consumed, zone boundary crossing | Vesk Q R, Ashvyn E, Fenn W, Maera W, Torv E, Korrath E, Dain W R, Sylra E, Elowen R |
| Traveling dash | Dashes gain a speed and a real path: interceptable, visible, optional pass-through hitting units along the way. Default for every dash in v2; Elowen E stays a true blink as her identity | Korrath R, Dain Q, Fenn Q R, Vesk E, Ashvyn W, Torv Q, Rhoka Q |
| Chain | A projectile hit jumps once to the nearest other valid unit within a radius, at reduced effect | Sylra Q |
| Wall | A temporary impassable terrain segment; blocks pathing and traveling dashes, not projectiles | Korrath W (sole owner per principle 7) |
| Reveal zone | A zone granting its team sight of its area, revealing brush and stealth inside | Ashvyn R |
| Knock-aside | `knockback` gains a direction parameter (lateral to a wave's travel, or path-relative), finally honoring the roster promise | Maera R, Torv Q, Elowen R |
| Per-rank overrides | Ability data may override numbers or gain effects at specific ranks, instead of the uniform rank multiplier | Sylra R |
| Empowered attack | A data effect priming the caster's next auto attack within a window with rider effects | Dain E |
| Recast (ADR 0005) | A second press of the same key inside a declared window resolves a follow-up; each press is budgeted | Fenn R (the only one in v2) |
| Cooldown events | An on-hit or on-takedown trigger refunding or resetting an ability's cooldown. **Beyond the approved menu; flagged for review**: it powers the three spend-and-rebuild loops below and is contract-safe, but it was not in the agreed primitive list | Dain Q, Fenn Q, Rhoka Q |

Explicitly out of scope for v2: summons and pets, hold-to-charge, stances and kit swaps,
controllable clones, target-id tethers, channels.

## The ten kits

Numbers are structural only (windups, durations, thresholds that define a mechanic).
Balance numbers land with implementation, as roster.md already prescribes.

### Korrath, the Bulwark (Tank, top)

The fight happens where Korrath says it does. Anchor kept: Shieldskin, the earth theme, the
pull-then-punish loop.

- **Passive, Shieldskin. Keep.** Unchanged: a shield after 4 s without taking damage.
- **Q, Shield Slam. Keep.** Cone slam, physical damage plus slow.
- **W, Iron Wall. Replace** (was a self stat buff). Raises a stone rampart: a wall segment of
  length 4 at the aim point, perpendicular to the cast direction, lasting 2.5 s. Blocks pathing
  and traveling dashes.
- **E, Earthgrip. Rework.** The pull skillshot stays; new conditional: a target dragged into
  contact with terrain (map walls or his own rampart) is stunned 0.75 s.
- **R, Earthbreak. Rework.** The leap becomes a real arc with about 0.45 s of air time and a
  telegraphed landing zone. Center (radius 1.5): damage plus knockup 1.0 s. Rim (radius 3):
  damage plus slow. Aim precision decides the payoff.
- **Bot playbook:** cast W behind a retreating target or across a choke; aim E when the target
  stands within a pull of terrain; R on two or more clustered enemies; hold ground while
  Shieldskin recharges.

### Dain, Emberfist (Fighter, top)

A momentum brawler who banks Heat and spends it in beats. Anchor kept: the Heat passive.

- **Passive, Heat. Keep.** Four auto-attack stacks; full Heat empowers the next ability by 25%.
- **Q, Blazing Jab. Rework.** A traveling punch-dash that passes through enemies on its path,
  damaging each; if it hit at least one champion, half of Q's cooldown is refunded, and a
  champion killed by the punch resets it outright (cooldown events). His weave tool.
  Playtest round 3: only champions move this cooldown. Minions and camps damage-only, so
  the weave stays a duel tool and never becomes a wave-clear engine.
- **W, Cinder Guard. Rework.** Self shield for 3 s plus a burn on enemies around him. New
  conditional: if the shield is fully consumed by enemy damage before expiring, it detonates
  around him (magic damage plus a brief slow). Attackers must choose: pop it or wait it out.
  Playtest round 3: the cast is now a jump ONTO an ally. It goes to the ally nearest the aim
  and lands against them, the guard goes off where he lands, and with nobody in reach the cast
  is refused and costs nothing. Bringing the burn to a teammate under pressure is the button.
- **E, Ember Flurry. Replace** (was a generic damage cone). Empowered attack: his next auto
  within 3 s deals bonus magic damage, splashes in a small cone behind the target, and grants
  one extra Heat stack.
- **R, Emberfall. Keep, light touch.** The telegraphed comet stays; the payload becomes
  center vs rim: full damage plus stun 1.2 s at the epicenter, damage plus slow on the rim.
- **Bot playbook:** Q through the target to keep the refund loop alive; E before each trade;
  W when two or more enemies commit onto him; R onto a CC'd or clustered target.

### Sylra, Thornweaver (Mage, mid)

Everything feeds Barbed Marks; standing near her victims is itself a mistake. Anchor kept: the
mark system, the zone control.

- **Passive, Barbed Marks. Keep.** Three marks root and burst.
- **Q, Thorn Bolt. Rework.** The line bolt now chains once to the nearest other enemy within 4
  at 70% effect; both hits apply a mark. Counterplay: spread out; poked allies are contagious.
- **W, Bramble Field. Keep.** Zone: mark on entry, slow damage ticks.
- **E, Verdant Shell. Rework.** The ally shield stays; when the shield breaks or expires, it
  bursts thorns: small AoE damage plus one mark on nearby enemies. Shielding the diver inside
  the enemy team becomes a play.
- **R, Overgrowth. Keep, plus a rank override.** The delayed root zone stays; at rank 3 the
  detonation leaves a lingering bramble patch (slow zone, 2 s).
- **Bot playbook:** Q at enemy pairs; W on the escape path; E on the engaged ally; R when two
  marks are already out on a target in range.

### Fenn, the Quickblade (Assassin, mid)

In, kill, out; every strike is committed and visible. Anchor kept: Opportunist, stealth.

- **Passive, Opportunist. Keep**, now pure data: targets below 35% HP take 15% more from him
  (HP-threshold conditional).
- **Q, Lunge. Rework.** A traveling dash, interceptable; if a champion he damaged within the
  last 2 s dies, Q's cooldown resets (takedown event). The snowball lever.
- **W, Twin Fangs. Rework.** The skillshot stays; isolation conditional: 40% bonus damage when
  the target has no allied champion within 4. Fenn hunts strays, not teamfights.
- **E, Smoke Veil. Keep.** Stealth 2.5 s plus move speed.
- **R, Shadow Flurry. Replace** (was point-and-click plus flat untargetability). Cast one:
  0.35 s windup, then a traveling strike along a short line, untargetable only during the 0.4 s
  travel, heavy damage to every champion passed. Recast within 4 s: blink back to the cast
  position. Commit forward with a banked, budgeted way home. The roster's only recast.
- **Bot playbook:** engage with R when the target is under 50% HP and reachable; recast home
  when own HP drops under 35% or the kill is secured; W only on isolated targets; E to cross
  the last gap or to leave.

### Elowen, Mistward (Battlemage, flex)

The mist decides what you see and where you may go. Anchor kept: the lance weave, the blind.

- **Passive, Mistborne. Keep.** Move speed on ability damage.
- **Q, Mist Lance. Keep.** Piercing lance with the two-hit weave mark.
- **W, Veil. Rework, small.** The blind zone stays; allies inside are now concealed by the mist
  (repeated brief stealth while in the zone, data-today). The zone itself stays visible: enemies
  know where the hidden threat is, not what it is doing.
- **E, Drifting Step. Keep.** A true blink, the one exception to traveling dashes.
- **R, Whiteout. Rework.** The storm zone keeps its tick damage and slow; new boundary rule: an
  enemy crossing the rim from inside is knocked aside 2 units back inward, at most once per
  1.5 s per unit. Walking out is a timed puzzle; a dash or sigil blink ignores it.
- **Bot playbook:** W on the own carry when diven; R on two or more grouped enemies; E to
  reposition, never to engage.

### Vesk, the Longshot (Marksman, bot lane)

Distance is damage. Anchor kept: Deadstill, the map-length shot.

- **Passive, Deadstill. Keep.** Autos deal 15% more to slowed, rooted, stunned, or airborne
  targets.
- **Q, Piercing Round. Rework.** The piercing line stays; damage now scales with distance
  traveled, up to +50% at max range. Point-blank Q is a mistake; max-range Q is the reward.
- **W, Caltrops. Keep.** The slow zone that feeds Deadstill.
- **E, Backstep. Rework.** A short traveling vault that drops a small caltrop patch (1.5 s slow
  zone) at the launch point, keeping the attack speed buff. Kiting leaves a trace.
- **R, Horizon Shot. Rework.** Keeps the 0.6 s windup and the map-length projectile; the impact
  is distance-conditional: under 30 units of travel, slow 50% for 2 s; beyond, a stun scaling
  from 0.5 s up to 1.5 s at 80 or more units. The counterplay window (windup plus flight time)
  grows exactly as the payoff does.
- **Bot playbook:** hold Q until near max range of the target's predicted position; E away from
  the nearest diver; R only on impaired or fleeing targets along sighted lines.

### Ashvyn, Nightbow (Marksman, bot lane)

A tempo archer on a rhythm of thirds. Anchor kept: Twinshot and its W prime.

- **Passive, Twinshot. Keep.** Every third auto echoes; W primes the counter to two.
- **Q, Shadow Volley. Keep.** The arrow cone.
- **W, Hunter's Step. Keep.** Dash (now traveling like all dashes), attack speed, passive prime.
- **E, Pinning Arrow. Rework.** The arrow finally honors the roster: beyond 60% of max range it
  roots 1.0 s, under that it slows 40% for 1 s (distance conditional). Max-range picks, not
  point-blank spam.
- **R, Eclipse Rain. Rework.** The damage-and-slow zone stays and now reveals enemies inside
  for its duration (reveal zone): brush and stealth offer no cover under the eclipse.
- **Bot playbook:** E at max range only; W before committing to a trade to bank the echo; R
  centered on fights near brush or vision edges.

### Maera, Tidecaller (Support, healer)

The tide gives and takes in the same wave. Anchor kept: Spring Tide, the dual-payload waves.

- **Passive, Spring Tide. Keep.** Heals splash to the nearest other ally.
- **Q, Tide Surge. Keep.** The piercing wave that damages enemies and heals allies it passes.
- **W, Rising Spring. Rework.** The heal zone stays; HP conditional: allies under 40% max HP
  heal double per tick. Dropping it early wastes it; triage becomes legible.
- **E, Undertow. Keep.** The piercing slow wave.
- **R, Great Wave. Rework.** The roster promise, delivered: a giant wave that sweeps enemies
  aside (knock-aside, lateral to the wave's travel) and shields the allies it passes. A peel
  ultimate, not a knockup.
- **Bot playbook:** Q along the ally-to-enemy axis; W under the lowest-HP ally in a fight; R
  aimed to sweep divers off the carry, not to poke.

### Torv, Stonehorn (Support, engage)

The mountain charges and the earth answers. Anchor kept: Bulwark Aura, Challenge.

- **Passive, Bulwark Aura. Keep.** Armor for nearby allied champions.
- **Q, Horn Charge. Rework.** A traveling charge; enemies clipped along the path are knocked
  aside, the landing center knocks up 0.75 s. Interceptable, blockable by a wall, honest.
- **W, Challenge. Keep.** The taunt burst; unique in the roster and perfectly bot-legible.
- **E, Tremor Stomp. Rework.** The self burst stays; CC escalation: enemies already slowed are
  rooted 0.9 s instead of slowed again. Q into E, or any ally slow into E, is the combo the
  whole kit teaches.
- **R, Faultline. Rework.** The line stun stays; the crack then stays marked along the whole
  line and erupts a second time 1.5 s later (the aftershock: delayed-detonation zones, damage
  plus a heavy slow). Standing on the fissure is the mistake; the wall belongs to Korrath
  (principle 7).
- **Bot playbook:** Q into two or more enemies; W after landing among two or more; E whenever a
  slowed enemy is adjacent; R through the enemy frontline so the echo catches whoever holds
  ground.

### Rhoka, Wildclaw (Skirmisher, flex)

Wounds that widen; the hunt rewards staying on the kill. Anchor kept: Rend.

- **Passive, Rend. Keep, one addition.** Auto attacks stack bleeds; abilities amplify per live
  bleed (unchanged). New: a target with three or more of Rhoka's bleeds suffers 25% grievous
  wounds while they last. Her anti-sustain niche.
- **Q, Pounce. Rework.** A traveling leap; conditional: hitting a bleeding target refunds 60%
  of Q's cooldown (cooldown event). Seed wounds, then pounce again and again.
- **W, Savage Sweep. Keep.** The bleed-amplified burst.
- **E, Primal Howl. Keep.** Slow burst plus attack speed steroid.
- **R, Apex Frenzy. Rework.** The 5 s steroid stays; the flat 180 heal is replaced: while
  active, autos against bleeding targets heal Rhoka a flat amount per hit. Lifesteal earned by
  target selection, not granted by button press.
- **Bot playbook:** seed bleeds with autos and W before spending Q; Q preferentially onto
  bleeding targets; R when two or more of its bleeds are live on champions.

## Coverage

Every primitive is exercised by at least one kit (sigils cover the two delivery kinds kits
dropped):

| Primitive | Kits |
|---|---|
| Skillshot (pierce) | Vesk Q, Maera Q E, Elowen Q |
| Skillshot (stop on hit) | Sylra Q, Ashvyn E, Korrath E, Torv R, Vesk R |
| Zone (ticks) | Sylra W, Vesk W E, Ashvyn R, Maera W, Elowen W R |
| Zone (delayed detonation) | Dain R, Sylra R |
| Zone (ally ticks) | Maera W, Elowen W |
| Cone | Korrath Q, Ashvyn Q, Dain E splash |
| Burst | Dain W, Torv W E, Rhoka W E |
| Dash (traveling) | Korrath R, Dain Q, Fenn Q R, Vesk E, Ashvyn W, Torv Q, Rhoka Q |
| Blink | Elowen E, sigil Riftstep |
| Self or ally | Sylra E, sigil Mend |
| Enemy target | sigil Sear (no kit uses it in v2; kept exercised by the sigil pool) |
| Slow, root, stun | throughout; root: Sylra passive, Ashvyn E, Torv E |
| Knockup | Korrath R, Torv Q |
| Knock-aside | Maera R, Torv Q, Elowen R |
| Pull | Korrath E |
| Taunt | Torv W |
| Stealth | Fenn E, Elowen W |
| Blind | Elowen W |
| Untargetable | Fenn R travel |
| Shield | Korrath passive, Sylra E, Dain W, Maera R |
| Heal | Maera kit, Rhoka R |
| Dot | Dain W, Rhoka passive |
| Grievous | Rhoka passive, sigil Sear |
| Mark | Sylra kit, Elowen Q, Dain E prime |
| Stat buff | Vesk E, Rhoka E R, Ashvyn W |
| Wall | Korrath W |
| Aftershock (delayed line re-eruption, built on delayed-detonation zones) | Torv R |
| Reveal zone | Ashvyn R |
| Chain | Sylra Q |
| Conditional effects | see primitive table above |
| Cooldown events | Dain Q, Fenn Q, Rhoka Q |
| Empowered attack | Dain E |
| Per-rank override | Sylra R |
| Recast | Fenn R |

## Bots v2

One generic spec-driven brain plus a declarative hint table per champion (data, not code, under
`src/sim/content/bots/`):

- **Generic brain upgrades:** per-ability range read from the spec (replacing the single
  hardcoded 7); predictive aim leading the target by projectile ETA; zone placement on the
  target's escape path; ultimate holding rules (enemy count or HP threshold from hints); heal
  and shield awareness for allied targets; respect for conditional sweet spots (cast Q near max
  range when the spec says damage scales with distance).
- **Hint table per champion:** one record: the tactical role of each key (poke, engage, escape,
  peel, steroid, execute), the R rule, and the combo order if any (Torv: slow before E).
- The existing dodge logic already generalizes; new spec kinds must be added to the
  self-centered list in `observe.ts` so telegraphs stay honest, and traveling dashes must be
  observable like projectiles so bots can intercept or dodge them.

## Implementation phasing (after this proposal is validated)

1. **Primitives.** Each new primitive lands as its own tested module behind the casting seam,
   with `observe.ts` exposure and determinism coverage. Recast lands with ADR 0005.
2. **Kits.** Champion data files rewritten per this document; tooltips, icons, and VFX follow
   (`describe.ts`, `ability_icons.ts`, vfx catalogue re-tagged); golden traces re-baked.
3. **Bots.** Generic brain upgrades, hint tables, parity and behavior tests.
4. **Balance.** Numbers pass, pacing tests, headless self-play sweeps.
