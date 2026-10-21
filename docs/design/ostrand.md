# Ostrand, the Pledgeblade (champion twelve)

Status: accepted design, not yet in the game. Lands in four slices (below); until the last one
the champion stays behind the `released` switch in its content data, so no select screen, bot
seat or royale pool deals it.

## What it is

A knight who picks one enemy and will not let go. Ostrand is a duelist fighter: everything in
the kit names one enemy champion, the **Sworn**, and the ultimate raises the **Oathfield**, a
closed ring of stone around Ostrand and whoever stands near, for a few seconds. Nobody walks or
dashes in or out. Spells and arrows still fly over the rim, so the duel is a stage the rest of
the fight can still reach, not a sealed room.

Every other champion moves the fight (Korrath's rampart, Torv's charge, Maera's wave) or
leaves it (Fenn, Elowen). Ostrand is the first who changes who is in it.

## Why it is fun

- The first match shows the idea: a ring of stone goes up and two people are inside. Both
  teams read it at once, and both know what to do: win the duel, shoot into it, or get out.
- It has answers anyone can find: a blink (Riftstep, Drifting Step) clears the rim, ranged
  allies fire over it, a slow or a root outside the ring is still a slow or a root inside.
- It plays the same on the Star Orchard and on the Wanderseed, where a ring in a battle royale
  turns a third-party into a choice: wait at the rim for the winner or shoot in now.

## The kit

Role Fighter, home lane top. Melee, a long lance-sword (attack range 2.0).

- **Passive, Sworn.** The first enemy champion Ostrand damages becomes his Sworn for 8 s
  (renewed by every hit on it; one Sworn at a time; a new one is taken only once the mark
  lapses or the Sworn dies, or by E and R, which overwrite it). Toward the Sworn he walks 15
  percent faster; his attacks and spells deal it 10 percent more damage. A takedown on the
  Sworn heals him for 12 percent of his missing health and refreshes Lance Drive. Both teams
  see the mark over the Sworn's head.
- **Q, Lance Drive.** A short thrust down a line (reach 4.5): physical damage to every enemy
  on it, and a slow of 25 percent for 1 s. The Sworn is slowed 40 percent instead.
- **W, Standard.** Plants a banner at his feet: a zone (radius 3.5, 4 s) where allies take 15
  percent less damage from champions and enemies are revealed. It does not move with him; the
  play is to fight over it.
- **E, Gauntlet Throw.** A gauntlet skillshot (range 9): the first enemy champion hit takes
  light damage and becomes the Sworn. Recast within 3 s: a traveling dash to the Sworn, which
  walls and terrain stop like any dash.
- **R, Oathfield.** Needs an enemy champion within 4.5; that champion becomes the Sworn. A
  ring of wall (radius 5) rises around Ostrand's position for 4 s (4.5 s and 5 s at ranks two
  and three). A unit standing on the rim is pushed to the side its center was on, never
  through. While it stands Ostrand takes 20 percent less damage from champions outside the
  ring. The ring falls early if Ostrand dies.

The ring is built from the existing wall primitive (`src/sim/walls.ts`): a closed polygon of
sixteen chords, each a `createWallSegment`, so it blocks walking, pathing and traveling dashes
and lets projectiles and sight pass, exactly like Iron Wall. On the planet each chord is an arc
of a great circle, as walls already are. No new system: no ADR.

## Numbers (first pass, tuned in slice 4)

| | |
|---|---|
| Base | hp 640, mana 280, ad 60, armor 30, mr 30, attack speed 0.66, move 3.7, radius 0.7 |
| Growth | hp 98, mana 28, ad 3.6, armor 2.8, mr 1.8 |
| Q | 30 mana, cooldown 6, 65 / 100 / 135 / 170 / 205 + 0.8 bonus ad |
| W | 50 mana, cooldown 16 |
| E | 40 mana, cooldown 12, 40 / 60 / 80 / 100 / 120 + 0.3 bonus ad |
| R | 100 mana, cooldown 100 / 85 / 70 |

Balance target: within the roster's band in the 5v5 matrix and in `scripts/royale_duel.mjs`
and `scripts/royale_report.mjs`. The duel is the risk: if Ostrand wins most rings, R's damage
reduction goes first, then the Sworn bonus.

## How a bot plays it

The playbook (`src/sim/content/playbooks/`) and hints (`src/sim/content/bots/hints.ts`):

- Lane and fight like the other fighters; take the nearest enemy champion as Sworn with the
  first trade.
- E on an enemy champion in reach, recast at once when Ostrand's health share is above the
  Sworn's.
- R when an enemy champion is within reach and Ostrand's health share is at least the
  target's; never with no enemy champion in reach (the cast needs one anyway).
- W at the start of a trade, under itself.

Bots that meet a ring: a bot inside fights (bots fight on sight). A bot outside with no path
to its target must not freeze or thrash against the rim: ranged bots fire over it, melee bots
hold at the rim and pick the nearest reachable enemy. Slice 2 pins this with a test, for
person and bot alike (a person's click inside a ring walks to the rim).

## Art

- Model: `public/models/champions/knight.glb` (KayKit, CC0, already in `CREDITS.md`), scaled
  up a little, steel plate with an oath-red tabard, a long lance-sword as the weapon prop.
- The Sworn mark: a small red pennant over the head. The Oathfield: the wall's stone with a
  thin red banner line along the top, so it does not read as Korrath's rampart.
- Portrait: requested from the harness with the shared style block
  (`docs/design/portrait-prompts.md`), `public/portraits/ostrand.webp`.
- Skins: three, in the shape of the others (`src/sim/content/skins.ts`).

## Slices

1. This document, the `CONTEXT.md` terms (Sworn, Oathfield), the roster entry, the portrait
   request.
2. Sim: `ostrand.ts` with the passive, the four spells and the ring wall, behind
   `released: false` (filtered out of select, the bot pool and the royale pool, with a test
   that it is); tests for the Sworn, the ring's push, dashes stopped at the rim, and bots and
   persons outside a ring.
   Landed 2026-10-22: `content/champions/ostrand.ts` behind `released: false`
   (`ChampionDef.released`; `CHAMPIONS` and `CHAMPION_LIST` hold released champions only,
   `UNRELEASED_CHAMPIONS` is read by the match's champion registry alone), the Sworn
   (`sim/sworn.ts`, a `sworn` status keyed by its source), the Oathfield (`sim/oathfield.ts`,
   sixteen chords with a side-keeping push), and `ringGoal`: a walk or a chase whose goal
   is across a standing ring aims at the point where its line meets the rim, on the
   walker's side, so a click into a ring and a bot's chase end at the stone. Tests:
   `tests/ostrand.test.ts`. Two first-pass simplifications, to revisit in slice 4: the
   Sworn stride holds while the Sworn is within 8 (not only while walking toward it), and
   Standard gives allies 15 armor and 15 magic resist instead of a damage share.
3. Render and bots: the manifest entry and props, the mark and the ring's look, the hints and
   the playbook, the royale build and tuning. Carried over from slice 2: Gauntlet Throw's
   recast (a traveling dash to the Sworn, a new recast kind beside `returnBlink`), the
   Oathfield's damage reduction against champions outside the ring, and the ring falling
   when Ostrand dies; a bot outside a ring picking the nearest reachable enemy. The portrait
   is already in `public/portraits/ostrand.webp` (credited), shown once he is released.
4. Balance with the headless tools, skins and laurel price, the portrait, the news entry, phone
   and desktop checked, and `released: true`.
