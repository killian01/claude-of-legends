# Adopt the world-of-claudecraft architecture

Claude of Legends reuses the architecture proven by [world-of-claudecraft](https://github.com/levy-street/world-of-claudecraft): one deterministic TypeScript simulation core (fixed 20 Hz tick, all randomness through a seeded Rng, zero DOM or renderer imports) that runs identically in the browser, on the authoritative server, and in a headless environment; an `IWorld` style seam as the only boundary between simulation and presentation (Three.js top-down renderer, DOM HUD); game content as typed data-as-code records; module-first code organization enforced by structural tests (architecture scan, monolith line ratchet, golden-trace determinism parity). We reimplement the code clean for a MOBA rather than forking: their per-directory CLAUDE.md contracts are the spec, not their monolith files.

## Consequences

- The server is authoritative. The client renders and never decides outcomes; the only sanctioned prediction is bounded local visual motion.
- The same sim running headless is what makes community bot training possible later (see ADR 0002).
- Determinism gates are installed from the first playable commit, not retrofitted.
