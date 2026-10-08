# The battle royale plan

The battle royale on the Wanderseed (ADR 0031), the ground geometry it stands on (ADR 0029)
and the teams it needs (ADR 0030). Every product choice below was settled with the maintainer
on 2026-10-02; this file keeps them in one place and tracks the build.

## The game

| Topic | Decision |
|---|---|
| Format | 50 champions, each for themself. House bots fill; a person takes a bot's seat. |
| Variants | Respawn and One life, on the same planet with the same Dusk; only death differs. |
| Respawn | Back in 5 s at the edge of the light, keeping everything, or where a tap on the globe during the wait picked, inside the light and 10 m from everyone. The most takedowns when the last light goes out wins. The score leader shows on the globe every 30 s and is worth 2. Join until 2 min from the end; the next match starts at once. |
| One life | One life, the last standing wins. Join during the calm 1:30. |
| Length | 10 min: 1:30 calm, then the Dusk closes in 5 phases. |
| Planet | The Wanderseed: a true sphere, radius 80 m, walked round in every direction; about 1,100 m2 a champion; equator 500 m. |
| Regions | Six, like the faces of a die: Sanctuary (+Y), Open ground (-Y), Ruins (+X), Cypress groves (-X), Lakes (+Z), Cliffs (-Z). The 8 cube corners are crossroads with a launch pad and a beacon. |
| Dusk | The lit cap shrinks toward a point drawn each match at a fifth of a champion's speed; outside, 1 to 12 percent of maximum health a second by phase; the next cap always drawn, on the ground and the globe. |
| Drop | 10 s over the globe to pick a landing point; others' picks show; bots pick; no pick lands somewhere quiet. |
| Start | Level 3, Q, W and E learned, ultimate at 6, ranks applied automatically, the two sigils. |
| Loot | The next piece of the champion's house build (`nextKitStep`), equipped at once. No shop, no gold, no recall. |
| Caches | About 150 drawn among about 250 spots, golden ones (2 pieces) in the Sanctuary and at region hearts; opened by standing 1.5 s beside one, broken by damage. One life: never back. Respawn: back after 90 s. |
| Creatures | About 20 camps back after 90 s (experience, a piece, 30 percent health); Pyrefang and Voidmaul at 3:00 (Ruins and Cliffs hearts), Warden at 6:00 (Sanctuary); last hit takes the reward. |
| Takedown | The next piece, experience and 30 percent health to the last hit. |
| Moving | +40 percent speed after 5 s out of combat; about 10 launch pads throw 50 m. |
| Hiding | Bushes hide; solid things block sight. |
| Bots | Each named, with a bot mark; "50 in the match, 2 people". Skill mixed: about half gentle, a third normal, a few strong; softer with only Guests. |
| Champions | The 10 of the roster, a quick pick (last one ready, Random, skin), duplicates allowed. |
| Points | ADR 0027's ladder and rules, plus One life 50 / 25 / 15 for the last, the top 5, the top 10; Respawn 50 to the best score. |
| Entry | Play now launches Respawn; One life and the 5v5 are tiles. |
| Production | The real planet from the start, built by a Blender script from one seeded layout (`docs/planet.md`). |

## The build

1. Ground geometry (`src/sim/geo.ts`) and a pinned 5v5 (`tests/fixed_match.test.ts`). Done.
2. Any number of teams (ADR 0030). Done.
3. The sim's systems that run on the planet rewritten over `geo.ts`; the ground seam over the
   Orchard's grid and the planet's cube-sphere grid (`src/sim/sphere_nav.ts`). The systems and
   the seam (`src/sim/ground.ts`) are done, pinned on an open sphere by the sphere tests'
   shared planet (`tests/sphere_world.ts`); the cube-sphere grid goes behind `SphereGround`.
4. The Wanderseed: layout, navigation, model, previews (`scripts/planet/`, `docs/planet.md`).
5. The mode in the sim (`src/sim/royale/`): the drop, the Dusk, caches, pads, loot, levels,
   creatures, takedowns, respawn, scores, the end.
6. The battle royale bots: loot, pads, the Dusk, picking fights, fleeing, the skill mix.
7. The server: a 50 seat match, the two variants, drop in, points, the next match.
8. The client: the planet drawn as a sphere (camera, clicks, telegraphs, overlays), the globe
   for the drop and the minimap, the HUD, the end screens, the landing.
9. Test cycles: headless 50 bot matches measured, browser runs on a computer and a phone,
   tuning.
