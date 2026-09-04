# Bots are player-authored data, run in the sim, rated on the account

> **Amended by ADR 0016.** On the two bot ways the rated subject is now the bot, not the
> account: rating the owner averaged every attempt they had running, which punished the
> iteration this mode exists to encourage. Everything else here stands, including that a
> bot is data interpreted by one deterministic Policy, that a match needs an owned seat on
> each side, and that an automatic playbook change is gated by unrated sparring.

An account can field a bot in its seat instead of playing by hand (`docs/design/bots.md`),
and that seat is rated. We decided that a bot is data: a playbook of ordered plays
interpreted by one deterministic Policy inside `src/sim/`, authored in the Academy by hand
or through a model, never player code and never a model call during a match; that the
rating subject is the account, one rating per way of playing (by hand, bot live, bot in
the Arena), earned in the one shared live queue plus the server-run Arena; and that any
automatic playbook change is gated by unrated sparring. The reasons: the sim is one
deterministic core running identically in ten browsers, on the server, and in the
environment (ADR 0001, ADR 0010); the slot schedule and the decision budget already treat
an in-sim Policy exactly like a human (ADR 0003); a young server cannot afford a fourth
queue; and the identity every rating hangs on is the account (ADR 0006).

## Considered options

- **The remote policy wire as the mode** (bot-as-client, ADR 0002 phase 2): rejected for
  this mode. It needs code, so it is not the no-knowledge path; a remote process is a
  stranger's process, so a bot-only ladder could not tell a bot from a human at the
  keyboard; and it carries latency and disconnects a ladder would have to forgive. It
  remains the road for trained bots, unchanged.
- **A model deciding during the match** (a language model as the policy, or one setting
  goals every few seconds): rejected. ADR 0002 defers server-side inference; a match is
  thousands of decision slots; and a non-deterministic policy breaks replays, the parity
  tests, and the fairness of a ladder.
- **Three queues** (human only, mixed, bot only), each with its rating: rejected. The
  live population would be split four ways with the Forge queue, and "human only" does
  not exist today either, since house bots fill every empty seat. One live queue where
  the seat kind is chosen at queue time, plus the Arena, yields the same three ladders
  with crisp definitions and no empty queue.
- **Dials on the house brain instead of a playbook**: rejected. A few parameters on a
  shared brain make every bot the same bot, a conversation that only turns dials is a
  gimmick, and the ladder would be flat.
- **The bot as the rated subject** (a ladder of bots): rejected. The account is the
  identity (ADR 0006); a bot is a choice, like a champion. A per-bot record is display,
  not rating.
- **Applying the night coach's proposals without a test**: rejected. A model proposal is
  not an improvement until measured; sparring is the measure, unrated and equal for
  every bot.

## Consequences

- `server/rating.ts` generalizes from "a human on each side" to "an owned seat on each
  side": house bots move nothing, K scales with owned seats, and each owned seat moves
  the rating of its way of playing. The match record marks the way each seat was played.
- The scripted Laner becomes the default playbook and the playbook interpreter replaces
  its code. The rewrite must be tick-identical to the code Laner across seeds (a parity
  test) before the code Laner goes; the micro (last hits, dodging, key roles, tower
  discipline) moves into engine helpers both share.
- Policy contract v0 is untouched: the coach order enters the observation as an additive
  optional field (ADR 0005), and the playbook format is versioned and grows only
  additively, like the contract.
- The active play is a sim event; replays regenerate it from the sim and embed the
  playbook version that played, as they embed forged definitions (ADR 0010).
- Bots get their own SQLite store beside the Forge's (`bots.sqlite3` under DATA_DIR,
  `node:sqlite`, ADR 0011's pattern) in their own module, so the Forge's files stay
  untouched while the two land in parallel.
- Arena and sparring matches run in a worker thread with a bounded queue: the deployment
  stays one process, one port, and the live loop is never blocked by a ten-second match.
- Ranked integrity in the Arena: on-demand matches come from a daily allocation and are
  matched by rating, at most three bots are deposited per account, and sparring never
  rates.
