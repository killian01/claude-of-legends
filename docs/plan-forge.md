# Forge build plan

The Forge: player-authored champions (ADR 0010) on the account stack (ADR 0006) and
the Forge store (ADR 0011). Phases in order; each phase ends green (`tsc` plus the
Vitest suite) and lands module-first behind existing seams. The terms are in
`CONTEXT.md`: Forge, forged champion, draft, creation, power budget, Forge queue.

State of play (2026-08-31): phases 1 to 3 are done, phase 4 is done except its
generation-dependent corners, and phase 5's keyless half is done (the neutral
provider interface, the mock provider, the Tripo provider against its documented API,
the finalize pipeline with the ledger). What remains of each is noted inline.

1. **Forged schema and validator**: DONE. `ForgedChampionDef` as pure data (no code
   passive; a passive is a parameterized template reference), the deterministic
   validator (hard per-field bounds plus the power budget costing every stat point
   and effect primitive), and the passive template set in the engine. Tests: budget
   arithmetic pinned, bounds rejections, roster-shaped kits validate.
2. **Runtime registry**: DONE. Champion resolution is match-scoped (roster plus the
   match's forged definitions) behind one seam used by Sim, ClientWorld, replay, and
   the headless env; replays embed forged definitions instead of ids alone. Tests:
   determinism with forged champions, replay round-trip, world API parity.
3. **The Forge store and economy**: DONE, reshaped by ADR 0011 (accounts already
   existed by the time this landed, so the original accounts half of this phase was
   superseded by ADR 0006's stack). SQLite for forged champions, the creation
   ledger, and generation jobs; the weekly allocation refresh; the word filter on
   names and card texts.
4. **The Forge editor**: kit half DONE (stats, four abilities composed from the
   primitives, passive template picker, the power budget meter, card texts, drafts
   saved to the account, the test drive into offline practice on the stylized
   figure). REMAINING: splash art first (the shared style block, free iteration on
   the 2D quota, a candidate history to pick from), optional per-spell icon
   generation under the flat icon template, the workshop view (turntable orbit and
   zoom, playback of the six clips, prop grip adjustment, team color preview,
   in-match-size icon preview), and the agent endpoint that compiles free-text
   passives into primitives with refusal explanations.
5. **Generation pipeline**: keyless half DONE: the neutral provider interface
   (generate2D, imageTo3D, rig, animate) with Tripo first and a mock provider, the
   spike on preset animation coverage and provider terms (see the ADR 0010
   addendum), and the server-side async jobs: finalize derives the model sheet, runs
   the second-pass classification hook (block and refund), then image-to-3D,
   auto-rigging (biped only in v1; the Creature beta waits for a provider with a
   full six-clip story), the weapon-family clip set, download-before-expiry, asset
   provenance, the creation debit with refunds on failure. REMAINING, needs a paid
   Tripo key and their written UGC authorization: verify the live task envelope,
   test whether v1.0 presets retarget onto v2.5 rigs, real splash-to-model-sheet
   derivation, the weapon as a separate prop (house library or generated), a real
   image classifier behind the hook, compression under the per-champion asset
   budgets.
6. **Forge queue**: the queue itself, forged-definition distribution at match setup
   (ten clients, spectators), champion select showing the account's forged roster,
   the queue's own rating, bot backfill from the roster.
7. **The gallery**: the public browse space (every finalized champion listed by
   default, creator removal), sort by recent and popular, likes, reports with
   takedown and account warnings, the free practice test-drive, the per-champion
   "others may play it" toggle (on by default), and the community tab at Forge-queue
   select (all shared champions, popular first, search, pinned favorites).
8. **Quotas, moderation, ops**: per-account daily quotas (2D generations, agent
   calls), edge IP rate limits, and server config for every number in this plan.
   (The word filter landed early with phase 3, since draft saves needed it.)

Phase 2, after the Forge proves itself: Stripe Checkout on the existing ledger, bots
playing forged champions through author-declared hints, mastery and skins for forged
champions, marker-based rig correction in the workshop view when a provider API
accepts joint placement, a second provider behind the interface, the Reforge option
(redoing a finalized champion's splash or model), and gallery comments and kit remix.
