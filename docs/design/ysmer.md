# Ysmer, the Turnlamp (champion thirteen)

Status: in build. Lands in the slices below behind the `released` switch in its content data
(`released: false` in `src/sim/content/champions/ysmer.ts`), turned on in the last one.

## What it is

A hooded lamplighter whose lantern lets her **trade places**: she and another champion stand,
in one tick, each where the other stood. Ysmer is a support. Her spark trades her with the enemy
it strikes, so the enemy's marksman is suddenly standing among her team; her ultimate reaches
any champion near her aim, and an ally in trouble is taken out of the fight while she stands in
their place under a shield.

Every other champion moves itself (Fenn, Elowen, Rhoka) or pushes others along a line (Korrath's
pull, Maera's wave, Torv's charge). Ysmer is the first who moves people across the fight without
anyone walking: a position, not a direction, is what she changes.

## Why it is fun

- The first match shows the idea: two champions blink into each other's spots with a thread of
  light between them. Everyone reads it at once, and both sides know what it means: the one who
  was safe is not, the one who was caught is free.
- It has a cost anyone can see: the trade puts Ysmer where the other one stood. Pulling a foe in
  sends her out to its friends; rescuing an ally leaves her in the danger they were in.
- It has answers: minions body-block the spark, a stealthed or untargetable champion cannot be
  reached, and the spark is a slow skillshot from 7.5 that can be stepped.
- It works on both maps and in every mode. In the battle royale, where everyone is an enemy, the
  ultimate is never dead: it reaches the nearest champion of any side.

## The kit

Role Support, home lane bot. Ranged (attack range 5.5), a lantern on a pole.

- **Passive, Homeward Glow.** Ysmer and allied champions within 6 of her move 20 percent faster
  while under 35 percent health.
- **Q, Wick Shot.** A bolt of lamplight (range 9): magic damage and a 20 percent slow for 1.5 s.
- **W, Hung Lantern.** Hangs a lantern at her feet for 5 s (radius 3): allies under it mend,
  enemies under it are revealed. Pressed again within those 5 s, Ysmer is back beside the
  lantern (the recast return blink Fenn's Shadow Flurry already uses).
- **E, Changeling Spark.** A spark skillshot (range 7.5, speed 20): the first enemy hit takes
  magic damage; if it is a champion, it and Ysmer trade places and it is slowed 35 percent for
  1.25 s. A minion in the way takes the spark and nobody moves.
- **R, In My Stead.** Reaches the champion nearest the aim within 11, ally or enemy, never an
  enemy hidden in stealth and nobody untargetable. An ally trades places with her and gets a shield; an enemy
  trades places with her and is rooted for 1 s. Either way Ysmer takes a shield of her own. With
  nobody near the aim the cast is refused and costs nothing.

### The trade

`src/sim/combat/swap.ts`, the effect `{ kind: 'swap' }`. Both spots were standing ground a
moment before, on the plane and on the sphere, so no landing search runs. A trade is a blink for
both units: walls, rings and cliffs are not crossed on foot, so none stops it, exactly as a
blink clears an Oathfield's rim (`docs/design/ostrand.md`). A flight either was on ends where it
stood, with no landing payload; both walks are dropped. A dead unit, a structure, an immobile or an untargetable unit is never
traded, and a trade breaks a recall's channel as any move does. The champion-targeted delivery is `{ kind: 'champion_target' }` in
`combat/casting.ts` (`combat/champion_target.ts` picks the champion). Both are roster-only: the
Forge never offers them. No new system: no ADR.

## Numbers (first pass, tuned on the release night)

| | |
|---|---|
| Base | hp 560, mana 420, ad 46, armor 24, mr 30, attack speed 0.62, move 3.65, radius 0.6 |
| Growth | hp 86, mana 40, ad 2.6, armor 2.4, mr 1.5 |
| Q | 50 mana, cooldown 7, 70 + 0.7 ap |
| W | 60 mana, cooldown 14, 8 + 0.05 ap healed every 0.5 s |
| E | 70 mana, cooldown 16, 55 + 0.5 ap |
| R | 100 mana, cooldown 80, ally shield 150 + 0.6 ap, own shield 100 + 0.4 ap, root 1 s |

Balance target: within the roster's band in the 5v5 matrix, `scripts/royale_duel.mjs` and
`scripts/royale_report.mjs`. The risk is a spark into a waiting team: if Ysmer's side wins too
many fights she starts, the slow after the spark goes first, then the root after the ultimate.

## How a bot plays it

Slice 2 (`src/sim/content/bots/hints.ts`, a playbook under `content/playbooks/`):

- Q as a poke on the nearest enemy champion in reach, like the other supports.
- E only when the bot's side is ahead around it (more allied champions near her than enemies
  near the target), so the enemy lands among her team; never into a tower's reach.
- R on an ally in reach under 30 percent health with an enemy champion near it; otherwise on an
  enemy champion in reach whose health share is below hers. In the battle royale (everyone an
  enemy) the second rule alone.
- W at the start of a fight under herself, recast when she drops under 30 percent health.

## Art

- Model: `public/models/champions/mage.glb` (CC0, already in `CREDITS.md`, no champion uses it
  yet), slate-blue robe, an iron lantern on a pole as the weapon prop with an amber point light.
  Elowen already reads as a ghost, so Ysmer is a living lamplighter.
- The trade: a thin thread of amber light between the two spots for a beat, and a flash at both.
- Portrait and the four ability paintings: requested from the harness with the shared style
  blocks (`docs/design/portrait-prompts.md`, `docs/design/icon-art-style.md`),
  `public/portraits/ysmer.webp` and `public/icons/abilities/ysmer_{Q,W,E,R}.webp`.
- Skins: four, in the shape of the others (`src/sim/content/skins.ts`), Gloamglass fourth.

## Slices

1. This document, the `CONTEXT.md` term (Trade places), the roster entry, the art requests, and
   the sim: `ysmer.ts` with the passive and the four spells, the trade effect and the
   champion-targeted delivery, behind `released: false`. Tests: `tests/ysmer.test.ts`.
   Landed 2026-11-24, with two pieces moved forward because the gates require an entry for
   every champion, released or not: the royale build and a first planet tuning (unmeasured,
   hp 1, damage 1.3), and the manifest def on mage.glb with a staff standing in for the
   lantern. The portrait is requested and lands with slice 3.
2. Bots: hints and playbook as above, her royale build and tuning, tested on both maps
   (`championDef` already lets a bot seated on her play the kit behind the switch).
   Landed 2026-11-24: her hints (`content/bots/hints.ts`: Q poke, W under herself in a fight
   and home again under 30 percent health, E an engage from 3 or more, R behind a new gate
   `ult.rescueBelow`: an allied champion in reach under 30 percent with an enemy champion
   within 5 of it, read by the Star Orchard laner and by the battle royale's crews, before the
   enemy gates), and a planet tuning of hp 1.15, damage 1.65: 53 percent of her landing duels
   and 52 percent after the calm (`royale_duel --with ysmer`, seeds 1 to 8). The general
   playbooks need no entry: they read the hints. Tests: `tests/ysmer_bots.test.ts` (the Star
   Orchard laner; the crews' read of the rescue gate is still to be pinned in slice 4).
3. Render: the manifest entry on mage.glb with the lantern prop, the trade's thread of light on
   the wire, the spell looks, the portrait and the ability paintings copied in and listed.
   Landed 2026-11-26: every trade made is told as a `swap` event (`combat/swap.ts`), carried
   by the 5v5 and battle royale snapshots to whoever sees either end and read by
   `game/swap_notes.ts` alike from a local tick, a replay, a spectated match or the wire; the
   renderer draws the thread of amber light between the two spots, a flash and a ring at each
   end (`render/vfx/ysmer_fx.ts`). Her looks in the catalog: a bead of lamplight for Q and the
   autos, the iron lantern on its post for W, the two-colored spark for E, a column of light
   for R. The lantern prop (`props.ts`) replaces the staff. The aim of a champion-targeted
   cast shows its search circle at the cursor. The portrait and the four paintings are in
   `public/`, listed and credited.
4. Balance with the headless tools, skins and laurel price, the news entry with her portrait,
   phone and desktop checked, and `released: true`.
