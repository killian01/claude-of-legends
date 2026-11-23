# Emberstray

Status: built and in the Thornfray pool (2026-11-23), the third bout kind. Its terms are in
`CONTEXT.md` (Emberstray, Glow); the contract it fills is `docs/design/thornfray.md` (The bout
contract) and the path it followed is `docs/adding-a-bout.md`.

## What it is

A ring of light twelve meters across, the Glow, stands at the heart of the Thornyard. It rests
twelve seconds, then drifts at a walk to its next stop, rests again, drifts again. Every second
a champion stands inside it counts one second held. When the clock runs out at 1:40, the most
seconds held wins. A fall costs five seconds (Respawn's death) and the walk back.

## Why it is fun

Lastwick asks for survival and Starglean for routes; Emberstray asks for ground. Everyone knows
where the fight is, because everyone wants to stand in the same small ring, and the ring will
not stay put: a champion who won the ring has to keep it while it walks away from the bush they
were using. Anyone inside counts, so sharing it is possible, but the only way to count alone
is to clear it. A champion who reads the drift and gets there first, or who comes back from a
fall at the side the Glow is heading to, beats one who only fights.

## How it plays

- **A person.** The Glow is drawn as a pulsing ring with a column of light over it, pale blue
  when nobody stands in it, gold when you are the one nearest its heart, red when another
  champion is. The minimap shows it as a ring. The top line says "Emberstray · 0:48 · 12.4 s
  held, 2nd". Land toward it, fight for it, step with it as it drifts; a tap on the globe after a
  fall picks the side to come back on.
- **A bot.** The tend errand (`src/sim/royale/bot/bout_calls.ts` `tendCall`): from 35 percent
  health, walk to the Glow's heart from anywhere in the Thornyard and hold within half its radius
  of it, stepping after it as it drifts. It is asked after the whole fight block, as every bout
  errand is: a bot with an enemy in sight fights by its odds first, and a bot that passed on a
  fight walks on into the ring, where it meets the enemy again.

## Numbers

| | |
|---|---|
| Base | Respawn |
| Thornyard | Chord radius 40 m, in the Ruins or the Cliffs (the Lakes' and the Groves' hearts are water and thicket under much of the roam; the Sanctuary's and the Open ground's stand on the poles' landmarks) |
| Clock | 100 s from landing; the most seconds held then wins |
| Dusk | Calm to 65 s (outside the Thornyard burns 4 percent a second). Phase 5 closes to 34 m from 65 to 80 s and holds to 115 s at 6 percent. Edge speed 1.1 m/s |
| Glow | 6 m radius. Its route is drawn at the landing on the bout's stream: the heart first, then eight stops within 20 m of the heart (a stop is also kept 14 m off a pole), 14 to 26 m from the stop before. Rests 12 s, drifts at 2 m/s |
| Light | The closing's center slides at most 0.8 of its 6 m shrink, so a ring whose heart is within 23.2 m of the Thornyard's stays lit to the clock: the Glow never stands in the dark |
| Caches | Up to 10 at landing inside the Thornyard, back 40 s after opened |
| Off | Seedfalls, Risings, camps, pads, the Burr, the Last light, the marks, the Upstart |
| On | The Clamors, the globe's return pick, the Grace |
| Count | Held time (`heldTimeScorer`): every champion standing in the Glow counts its seconds |
| Ties | Fewer falls, then the earlier tick its count was reached, then the lower seat |
| HUD | "Emberstray · 0:48 · 12.4 s held, 2nd", win line "Hold the Glow longest · Bout 3 of 6" |
| Card | "Hold the Glow longest", "The Glow rests, then drifts: follow it", "Anyone inside it counts: clear it" |

Measured with `node scripts/thornfray_report.mjs --bout emberstray --seeds 6` (36 bouts): every
bout ran to its clock at 1:40, first fall at a median 0:09, 20.1 takedowns a bout, the winner's
median 25.1 s held and every seat's 10.4 s, the bots fighting 85.0 percent of the seconds an
enemy is within 8 m in sight (Starglean 84.7, Lastwick 86.7), mean place by skill strong 4.7,
normal 4.6, gentle 4.4. With `--standin`, a seat that gives no order placed 7.6 on average and
never won.

A bot that passes on a fight beside the Glow is given room first (the brain's give-room step)
and walks back once it has it; it counts again when the fight is decided.

## Art

Nothing of its own: the Glow is the engine's `'circle'` goal primitive, drawn by
`src/render/planet_goals.ts` on the planet, the globe and the minimap for every kind.

## Slices

1. (2026-11-23) The kind, its goal, its errand, its tests and pins, the News: released.
2. Later, if it earns it: a call on the announcement line when the Glow starts to drift, and
   the next stop shown faintly while it rests (a `'target'` primitive the count does not read).
