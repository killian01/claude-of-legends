# Decision budget semantics

Refines the fairness constraint of ADR 0002. Every participant (human, scripted bot, RL agent) spends from an identical decision budget: a token bucket refilling at about 4 tokens per second of sim time, with a capacity of at most 2; both rate and capacity are configurable. Budgeted actions (ability casts) apply on the next sim tick, so the cap limits throughput and never adds latency. Movement is exempt for humans and bots alike: a movement intention is persistent state the sim samples every tick and may be replaced at any time, outside the budget.

## Consequences

- The headless env must reproduce exactly the same budget semantics as the server; a parity test pins the two implementations to each other.
- The budget is part of the public Policy contract, versioned together with the observation and action space.
- Considered and rejected: strict 4 Hz sampling for everyone (up to 250 ms of artificial input latency, unacceptable feel) and capping bots only (humans structurally advantaged in throughput).
