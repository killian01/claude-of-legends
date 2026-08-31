# Game definition (v1)

The consolidated result of the design grill (rounds 1 to 3). The ADRs in `docs/adr/` hold the why for the load-bearing choices; this file holds the what.

- **Format**: 5v5, three lanes, one fixed map.
- **Access**: browser, online-first. A free account (unique name, password, email address) for anything that reaches the server; the offline practice match needs none. The address confirms the account and resets a forgotten password, and nothing else (ADR 0007). No general database: JSON files on disk (ADR 0006), except the Forge, which keeps its champions, creation ledger, and generation jobs in SQLite (ADR 0011).
- **Matchmaking**: one queue; a "play now with bots" button; private lobbies joinable by code; bots backfill empty seats.
- **Map**: 2 towers per lane plus 2 Sanctum towers; no third structure tier between the towers and the Sanctum (win condition: destroy the Sanctum towers, then the Sanctum); jungle terrain with brush between lanes, no camps in v1. Each half carries a matching jungle on both sides of its mid lane, and every outer tower stands in a choke: walking to an inner tower without passing an outer one is a long detour, never a stroll (`tests/tower_approach.test.ts`).
- **Vision**: full team fog of war; brush hides its occupants. Policy observations are team vision, never global sim state.
- **Economy**: passive gold plus last hits, kills, and towers; shop at fountain, and while dead (the respawn lands there anyway); about 20 items in 2 tiers (components into finished items).
- **Progression**: levels 1 to 18, one skill point per level, R at 6/11/16, XP shared by proximity.
- **Pacing**: 20 to 25 minute target, respawn timers scale with game time, recall 8 s, full regen at fountain, no surrender in v1.
- **Sigils**: pick 2 of 4 at lock: Riftstep (blink), Zephyr (move speed), Mend (burst heal), Sear (damage over time plus healing reduction).
- **Champions**: 10 at launch (`docs/design/roster.md`), kits composed from shared effect primitives.
- **Champion select**: blind pick, about 60 s, no duplicates within a team (allowed across teams), random button, sigil choice at lock.
- **Controls**: right-click move, A attack-move, QWER abilities, mouse-aimed skillshots. Desktop browser only.
- **Fairness**: identical decision budget for humans and bots (ADR 0003).
- **Rendering**: Three.js top-down camera, flat fixed map, simple stylized geometry at launch.
- **Bots**: scripted Policies under `src/sim/content/bots/` (ADR 0002); community-trained RL bots later via the headless env, joining as normal clients.
- **Deployment**: single Docker image, one process one port, on the maintainer's Hetzner machine. Repo private until launch, MIT, public at launch.
