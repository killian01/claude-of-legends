# Roadmap

Living document. The 48 hour build scope is defined by the ADRs in `docs/adr/` and the ongoing design sessions; this file records what is deliberately deferred.

## Future options (explicitly deferred)

- **Model-weights registry and server-side inference** for community-trained RL bots. For now trained bots join as normal clients only (bot-as-client, see ADR 0002).
- **Headless Gym environment** (Phase 2 of ADR 0002): NDJSON stdio env plus Gymnasium bindings over the same Policy observation/action space.
- **In-game map editor pipeline** (world-of-claudecraft pattern: editor to JSON to compiled TS module) and community-contributed map variants.
- **Offline practice mode** in the browser (the sim already runs client-side by construction; only the entry point is deferred).
- **Accounts, persistence, ranked matchmaking.**
- **Mobile controls.**
