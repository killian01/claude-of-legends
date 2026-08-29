# 48 hour build plan

Phases in order; each phase ends green (`tsc` plus the Vitest suite). The sim is built offline-first even though the product launches online-first: the server wraps the exact same sim (ADR 0001), so phases 2 to 5 are fully testable without netcode.

0. **Design** (done): grill rounds 1 to 3, ADRs 0001 to 0004, roster accepted, game definition consolidated.
1. **Scaffold and determinism core**: tooling (Vite, Vitest, Biome, strict TS), sim skeleton (fixed 20 Hz tick, seeded Rng), architecture and determinism gates as tests.
2. **Map and movement**: the map as a data-as-code module (lanes, towers, Sanctum, brush, fountain, colliders), click-to-move with pathfinding, Three.js top-down view of the map and moving capsules.
3. **Combat core**: stats, auto-attacks, the shared effect primitives, ability execution pipeline, one champion playable end to end.
4. **MOBA systems**: minion waves, towers and Sanctum damage rules, gold, XP and levels, items and shop, death and respawn, fog of war.
5. **Content**: the ten champions and four sigils as data records.
6. **Online**: authoritative server (`ws`, snapshots with interest and delta encoding), client mirror world, guest login, queue, private lobbies, champion select.
7. **Bots**: `Policy` interface frozen at v0, a scripted laner bot, matchmaking backfill, decision budget enforcement shared by server and future headless env.
8. **HUD**: health bars, ability bar with cooldowns, shop, scoreboard, minimap, death screen, end screen.
9. **Ship**: Docker image, deploy on the Hetzner machine, smoke test from a clean browser, play instructions in the README.

Post-sprint (community phase, mapped later with wayfinder): the environment (shipped, `headless/`) and Gym bindings over it, map editor pipeline, draft mode, accounts and persistence, new champions and items by PR.
