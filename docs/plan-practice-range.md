# The Range build plan

Issue #7 asks for a practice range: a couple of standing targets with big health pools,
visible damage numbers, no death, instant respawn, so learning a champion takes two minutes
instead of a full 5v5. The roadmap deferred it (`docs/roadmap.md`, "Offline practice mode").
It touches the sim (a new unit kind and a sim option), the client's offline boot, the
renderer, and the select screen. This file is the proposal; every choice under "Proposed" is a
default the maintainer can overturn before the phase it belongs to lands.

## Proposed

| Topic | Choice |
|---|---|
| Names | **Range** for the place and **Strikepost** for a target (`CONTEXT.md`). Strikepost is an original compound (strike, post), searched for IP on 2026-10-14 and clean. |
| Where it runs | In the browser tab only, like Practice: nothing saved, no replay, no points (ADR 0027 scores the classic public queue alone), no practice report. The server never sees it, so no wire message carries a post. |
| The map | The Star Orchard as every match has it (ADR 0021), towers and Sanctums standing. Nothing else moves: no waves, no camps, no ring creatures, no Warden, no bots, and no winner. |
| The posts | Two, side by side, 11 m out from the team's Sanctum toward the map's middle and 5 m apart: open ground inside the base, short of the mid lane's last tower, a walk from the fountain. A **Bare Strikepost** (5000 health, no armor, no magic resist) and a **Plated Strikepost** (5000 health, 80 and 80), so a kit reads as it lands on a carry and on a tank. |
| Never falls | The hit that would fell a post fills it again (`combat/damage.ts`), so it is never in the dead, pays no gold or xp, and posts no death. Left alone 4 s it fills, stands back on its spot and drops its statuses (a knockback, a slow, a stun all show on it while it is being hit). |
| Damage numbers | Already there: the renderer prints the viewer's own hits over any victim (`renderer.ts`, the combat notes' `hits`). The neutral number for other sources lists champions, the Warden and creatures; a post joins that list in phase 2. |
| Towers | Ignore it: tower and minion AI skip neutral units already (`tower_ai.ts`, `minion_ai.ts`). |
| Bots | None play in the Range. The posts are a kind of their own, so no playbook behavior (which names `camp` and `creature`) and no house bot ever routes to one; a bot dropped into a Range would hit a post by the same rule a person does, through the same damage pipeline. |
| The way in | The Practice select's "Enemy bots" row gains a third choice, **None (Range)**, beside Gentle and Normal: the same champion, skin and sigils, and the Range instead of the 5v5. The home's tiles stay as they are. |

## The seams

- **Unit kind**: `'post'` joins `UnitKind` (`src/sim/unit.ts`) with `postKind` and
  `createStrikepost`. A kind of its own rather than a `camp` with a new `campKind`, so the
  forest's rules (the jungler's round, the sightings, the camp memory in the observation) never
  see it.
- **Content**: `src/sim/content/strikeposts.ts`, the two posts and the numbers above.
- **Sim**: `SimOptions.range: { team }` (`src/sim/sim.ts`) stands the posts and stops the waves,
  the camps, the rings and the Warden; `src/sim/strikeposts.ts` places them and steps the calm
  refill. A Range is built by `orchardSim` with the option, never by `buildMatchSim`: it has no
  replay to agree with.
- **Client**: `runOffline` in `src/main.ts` boots a Range when the select says so: one
  champion, no fill, no practice report, the practice clock as it is. The match layer, the pause
  menu and the exit behave as Practice's.
- **Renderer**: a post's mesh from primitives (a timber post with a painted ring, the plated one
  banded in iron), its health bar and the neutral damage number; the minimap draws it as a
  small neutral dot; the HUD's target frame names it from the table.

## The phases

1. **The sim** (landed 2026-10-14; `src/sim/strikeposts.ts`, `tests/strikeposts.test.ts`). The
   unit kind, the content table, `SimOptions.range`, the never-falls rule, the calm refill,
   `CONTEXT.md`. Nothing a player sees changes: no host passes the option yet. Tests: the posts
   stand on open ground in the team's base, one of each kind; no other match has one; two
   minutes of a Range raise no wave, camp, creature or Warden; a level 18 champion hitting a
   post for ten seconds fells nothing and earns nothing from it; a left post fills and stands
   back after the calm and not before; the plated one mitigates.
2. **The way in and the look**. The select's third choice (`src/game/practice_bots.ts`, the
   menu row), the Range branch in `runOffline`, the post's mesh, its bar, the damage numbers,
   the minimap dot and the target frame. Checked in a browser at 844x390 with touch and on a
   desktop (a held thumb on a post, the cast pad on it). A News entry. One night.
3. **The Range's tools**, only if the first use asks for them: a small panel with the level
   (1, 6, 11, 18 through `Sim.setLevel`), cooldowns and mana refilled, the shop's gold, and the
   damage done in the last five seconds on the post last hit. A night.

## Open for the maintainer

- Whether the Range belongs on the home as its own tile rather than a choice at the Practice
  select; the plan keeps the home's tiles as they are.
- Whether a person should be able to open the Range online (a server mode with no queue);
  the plan keeps it in the tab, where it costs the server nothing.
- Whether a post should strike back in some form (a slow swing to practice dodging); the issue
  asked for stationary targets and the plan keeps them inert.
