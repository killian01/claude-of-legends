# One Policy abstraction behind every bot

All non-human play goes through a single deterministic interface defined in `src/sim/`: `Policy: (observation, rng) -> action`, using the exact observation and action space the future Gym environment will expose. Deterministic, zero I/O.

Sequencing:

1. **Phase 1, scripted bots**: TypeScript implementations of `Policy` under `src/sim/content/bots/`, one file per bot, contributable by PR. They serve three roles: default opponent, matchmaking backfill, and smoke-test agents.
2. **Phase 2, trained bots**: the headless env (NDJSON over stdio plus Gymnasium bindings, following the world-of-claudecraft `headless/` and `python/` pattern) exposes exactly the same observation and action space as `Policy`. An RL agent trained outside connects to the server as a normal client (bot-as-client). No server-side inference.

## Consequences

- Fairness constraint: decision frequency is capped identically for scripted bots, RL agents, and humans (about 4 decisions per second of sim time).
- No model-weights registry and no server-side inference for now; recorded as a future option in `docs/roadmap.md`.
- The observation and action space is a public contract: changing it after Phase 2 breaks community-trained bots, so it is versioned and evolved deliberately.
