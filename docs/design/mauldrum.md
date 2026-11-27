# Mauldrum

The fourth Thornfray bout kind (`CONTEXT.md`: Mauldrum; ADR 0035; built by
`docs/adding-a-bout.md`). A race on the Voidmaul: eight champions land in the Cliffs, the
Voidmaul rises on its ring at the Thornyard's heart twelve seconds later, and the most damage
landed on it when the clock runs out wins.

## Why it is fun

Every other bout asks the eight to spread (Starglean's caches, Lastwick's sweep) or to share a
point (Emberstray's Glow). Mauldrum puts a third party in the middle that hits back: the
Voidmaul's slam punishes a crowd, and a champion that commits to the creature turns its back to
seven rivals. The choice of every second is "hit the creature or hit the champion beside me",
and both pay: a takedown takes a fifth of the fallen's count. The blow that fells it is worth a
big bonus, so its last tenth of health is the bout's loudest moment, usually in the last
half minute.

## How it plays

- Respawn's death: a fall costs five seconds and the walk back, so nobody is out of the race.
- The Thornyard is the Cliffs alone, 40 m around the region's heart, where the Voidmaul ring
  stands. One closing (phase 5) to 30 m from 60 to 75 s, the light held to 110 s, the outside
  burning 4 percent a second from the first second. The clock ends the bout at 100 s.
- The Voidmaul is called at the landing (the planet's 30 s heads-up) and rises at 12 s, at the
  planet's own neutral scale. It does not return in the bout (the planet's return is 150 s).
- Eight caches at landing, back 40 s after opened; the Clamors run. No camp, no Warden, no other
  ring, no Seedfall, pad, mark, Burr, Last light or Upstart.
- The count, "struck" (`src/sim/royale/bouts/score_mauldrum.ts`): each blow a seat lands on the
  Voidmaul counts its damage, rounded on its own; the blow that fells it counts 400 more; a
  takedown moves a fifth of the fallen's count (rounded down) to its taker. Ties: fewer falls,
  the earlier tick the count was reached, the lower seat.
- The struck has no ceiling of one health bar: the felling blow counts its whole damage, and a
  Voidmaul that heals out of combat or resets on its leash is struck again. The race is for
  blows landed, not for a share of one bar.

## How a bot plays it

The house brain with `MAULDRUM_BOTS` (`src/sim/content/bots/bout_skills.ts`) and the `maul`
errand (`src/sim/royale/bot/bout_calls.ts` `maulCall`), asked after the fight block like every
errand, so a bot with an enemy in reach fights it first. From 40 percent health it walks to the
Voidmaul's ring, waits within 9 m while it has not risen, and strikes it once it stands; under
the floor, or once it has fallen, it goes on to the brain's caches and its roam. A creature-taking
skill already hits a big body in reach before the errand (the brain's `rising-fight`); the errand
makes every skill play the bout's rule.

## Numbers (seeds 1 to 6, `scripts/thornfray_report.mjs --bout mauldrum --seeds 6 --standin`)

36 bouts, every one ended by its clock at 1:40; first fall at 9 s (median); 17.4 takedowns a
bout; the winner's count 1170 (median), every seat's 255; fighting 85.2 percent; the strong
skill places 3.4 on average, the gentle 4.4; a stand-in seat that gives no order places 7.0 and
never wins. The Voidmaul takes about 3,000 damage over a bout and falls between 65 and 80 s on
most seeds; on some it stands to the clock with a quarter of its health.

## Art

No new art: the Voidmaul's own body (`docs/voidmaul-model.md`), its slam and its ring are
what the bout shows. A later slice may draw the count's leader on the creature (a thin ring
under it in the leader's color), once the first bouts are played.

## Slices

1. (2026-11-28) The kind, its count, its errand, its tests and pinned bouts, released with News.
2. Later, only if it is played: the leader's ring on the Voidmaul and a short "felled by" line
   on the bout's end card.
