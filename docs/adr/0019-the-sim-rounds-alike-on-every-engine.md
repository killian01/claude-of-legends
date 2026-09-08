# The sim rounds alike on every engine

A replay is a re-simulation, not a tape (ADR 0001, the replay in `docs/design/bots.md`):
the server keeps a seed, the picks and the command stream, and whoever opens the match
builds the same sim and steps it again. The Arena and the night coach run their matches on
the server's Node, the Academy's sparring runs in the browser's worker, and the viewer runs
in whatever browser the owner has open. So one match is computed on several engines, and
the replay contract holds only if every one of them computes the same numbers.

IEEE 754 promises that for the four operations, the remainder and the square root: one
correctly rounded result, the same on every conforming implementation. It promises nothing
for the rest of `Math`. `Math.hypot`, the trigonometric functions, `Math.exp`, `Math.pow`
and the `**` operator are each engine's own algorithm, right to within a bit or two, and
which bit varies by engine and by version. On the server's own Node, `Math.hypot` and
`Math.sqrt(x * x + z * z)` disagree in the last bit for about a third of the positions on
this map. A last bit is enough: a distance check flips, a minion picks the other target, a
wave arrives a tick apart, and the replay shows a fight that never happened.

The sim had a hundred and twenty `Math.hypot` calls and four trigonometric ones, so this
was decided before it was found in a viewer rather than after.

## Decision

`src/sim/` computes with exactly rounded operations only. Lengths go through `hypot` in
`src/sim/exact.ts`, which is the square-root formula. The two angles the sim needs, the
cosine for a cone's half angle and the compass ring a terrain check samples, come from the
same module: a fixed Taylor polynomial evaluated in a fixed order over exact operations,
and a table of the eight compass directions whose entries are literal constants. The cone
itself compares cosines by a dot product instead of subtracting angles, so no arc tangent
is needed at all.

`tests/architecture.test.ts` bans the engine's own versions from `src/sim/`, the same way
it bans `Math.random` and the wall clock: `Math.hypot`, every trigonometric and hyperbolic
function, the exponentials and logarithms, `Math.pow`, `Math.cbrt` and `**`. A new need
for one of them is met by adding an exact version to `src/sim/exact.ts`, with its test.

The replay version moved to 3 with this change. The exact length differs from the engine's
in the last bit often enough that a version 2 record would play out a different match.

## Consequences

- A match recorded on the server plays out identically in every browser, and a sparring
  record made in a browser plays out identically on the server. That was the contract
  already; now it is the arithmetic's too, not only the algorithm's.
- Contributors reach for `hypot`, `cos` and `sin` from `src/sim/exact.ts` rather than
  `Math`. The gate says so at the first test run.
- The polynomial cosine costs a dozen multiplications per cone cast, which is nothing
  against the cast's own target search. The length formula is cheaper than the engine's
  hypot, which scales its arguments to avoid an overflow this map cannot produce.
- What stays outside the rule: the renderer, the HUD and the Forge's statistics are free to
  use `Math` as they like. Only `src/sim/` runs on every host and has to agree with itself.
