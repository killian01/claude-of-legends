# Roadmap

Living document. The 48 hour build scope is defined by the ADRs in `docs/adr/` and the ongoing design sessions; this file records what is deliberately deferred.

## Future options (explicitly deferred)

- **The passive-hook system**: per-tick champion passives (Dain's Heat,
  Ashvyn's Twinshot, Rhoka's Rend, Torv's aura, Korrath's Shieldskin,
  Elowen's Mistborne, Fenn's Opportunist, Maera's splash), referenced from
  the champion files. A flagship community contribution.
- **Skill points and ability ranks** (one point per level, R at 6/11/16).
- **Reconnect to a live match**; a bot substituting for a disconnected
  player.
- **Post-review polish tail**: minion unit collision, health potions,
  assists, camera freedom and zoom, range indicators, fog terrain dimming,
  minion aggro on champion attackers, end-of-match stats screen.

- **Model-weights registry and server-side inference** for community-trained RL bots. For now trained bots join as normal clients only (bot-as-client, see ADR 0002).
- **Headless Gym environment** (Phase 2 of ADR 0002): NDJSON stdio env plus Gymnasium bindings over the same Policy observation/action space.
- **In-game map editor pipeline** (world-of-claudecraft pattern: editor to JSON to compiled TS module) and community-contributed map variants.
- **Offline practice mode** in the browser (the sim already runs client-side by construction; only the entry point is deferred).
- **Accounts, persistence, ranked matchmaking.**
- **Mobile controls.**
- **Visual upgrade of the map and units** (models, textures, terrain detail, VFX). Deliberately deferred: the renderer sits behind the IWorld seam, so art improves without touching gameplay code. A bounded readability and polish pass happens in phases 8 and 9 of the sprint; the real art pass is a flagship community contribution (the world-of-claudecraft image-to-GLB pipeline is reusable for champion and prop models).
