# Forge build plan

The Forge: player-authored champions (ADR 0010) on the account stack (ADR 0006) and
the Forge store (ADR 0011). Phases in order; each phase ends green (`tsc` plus the
Vitest suite) and lands module-first behind existing seams. The terms are in
`CONTEXT.md`: Forge, forged champion, draft, creation, power budget (its Stat, Growth
and Kit envelopes, and the Burst cap), Forge queue.

State of play (2026-08-31): phases 1 to 3 and 6 to 8 are done. Phase 4 is done
except the agent endpoint (needs a Claude API key) and prop grip adjustment
(needs the weapon prop, phase 5's Tripo half). Phase 5's keyless half is done
(the neutral provider interface with the upload seam, the mock provider with
real placeholder assets, the Tripo provider against its documented API, the
finalize pipeline deriving from the splash with the ledger and the asset
budgets). What remains is phase 5's live-key half, behind the paid Tripo key
and their written UGC authorization; details inline.

1. **Forged schema and validator**: DONE. `ForgedChampionDef` as pure data (no code
   passive; a passive is a parameterized template reference), the deterministic
   validator (hard per-field bounds plus the power budget costing every stat point
   and effect primitive), and the passive template set in the engine. Tests: budget
   arithmetic pinned, bounds rejections, roster-shaped kits validate. Reshaped by
   ADR 0013 (2026-09-02): the budget is three envelopes (stats 190, growth 90, kit
   820) that never trade points, each at the roster's maximum, plus a burst cap on
   what one cast deals at rank 1 (`src/sim/forge/envelopes.ts`, `burst.ts`); the
   fresh draft, the polygon, the dial and the kit conversation's fit follow. Left
   for its own PR: raising the roster's kits toward the kit envelope (damage and heal
   amounts only, bot matches before and after), so the envelopes stop being dictated
   by single champions.
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
   figure). Art half DONE: splash art first (the shared style block held server
   side, free iteration on the 2D quota, a per-kind candidate history with the
   creator's pick, sealed at finalization; finalize refuses without a chosen
   splash), optional per-spell icons under the flat icon template (previewed at
   full and in-match size, the procedural icon stays the default), the workshop
   view (turntable orbit and zoom, playback of the clip set, team color preview
   on the ring, a match-view camera over a one-unit grid), and splash art on the
   gallery and Forge-queue select cards. Studio rework DONE (2026-08-31, on
   playtest feedback): the editor is three tabs in creation order (Design with
   the splash hero, example lines and the visible splash-to-model pipeline;
   Spells with per-spell icon blocks; Tuning with the stats), a finalize that
   lands opens the workshop, and the workshop is the adjustment atelier: live
   display tuning (height, facing, ground offset) and the weapon prop attached
   to a chosen rig bone with hand-tuned grip offsets, saved server-side
   (/api/forge/display, clamped by the shared sanitizer) and applied in-match.
   Forged champions PLAY as their generated models everywhere: the render
   registry loads the sealed GLB (clip names resolved by substring, so preset
   and placeholder spellings both land), announced from drafts, the gallery,
   and the match_start forgedAssets block. Conversations (2026-09-02): the kit
   conversation on the Spells tab and its sibling, the stat conversation on the
   Tuning tab (`server/suggest_stats.ts`, the fit in `src/sim/forge/stat_fit.ts`),
   share one chat panel (`src/ui/forge_chat.ts`); the Spells tab reads overview,
   conversation, proposal, then the five slots wearing their icons (generated one
   at a time or all four at once) and the selected slot's parameters, the passive
   a slot like the others. The draft autosaves (compared by value after every
   refresh, debounced) and both conversations travel with it
   (`server/forge_chats.ts`, restored on open); spells and the passive carry a
   flavor line the conversation writes and the creator edits, above the derived
   text, which stays the game's. Playtest round after (2026-09-02): the dial and
   the fit write amounts on their reading steps (`snapAmount` in
   `src/sim/forge/spell_power.ts`) and the fit tops the kit back up to the line
   one step at a time; key tabs (P Q W E R) beside the parameters and animation
   titles switch spells in place; a failed call (server gone, session ended)
   shows a banner instead of emptying the rail and the icons, and the
   Forge e2e (`scripts/e2e_forge.mjs`) walks all of it. The chosen spell icons
   reach the match: they ride the draft rows, the gallery entries and the
   match_start assets block, the client registry (`src/ui/forged_icons.ts`) puts
   them ahead of the shipped paintings, and `scripts/e2e_test_drive.mjs` reads
   them off the HUD of a test drive. The test drive opens with every champion at
   the ultimate's level (`Sim.setLevel` walks the xp curve), so R is on the
   table at once; and the creator picks a cast sound per spell and a basic-attack
   sound from the procedural palette (`src/sim/content/sounds.ts`, heard on pick,
   carried by the definition, bounded by the validator). REMAINING: the agent endpoint that
   compiles free-text passives into primitives with refusal explanations (needs
   a Claude API key); the generated weapon prop itself stays phase 5's Tripo
   half (the procedural prop library carries the grip flow until then).
5. **Generation pipeline**: keyless half DONE: the neutral provider interface
   (generate2D, imageTo3D, rig, animate, plus the optional uploadImage seam that
   turns a local file into a provider input token) with Tripo first and a mock
   provider whose downloads write real placeholder files (a spec-valid PNG and an
   animated GLB carrying the clip set: five clips, because one live retarget task
   carries at most five animations; a victory clip returns in phase 2 as a second
   geometry-free task merged client-side), the spike on preset animation coverage
   and provider terms (see the ADR 0010 addendum), and the server-side async
   jobs: the model reference is its own player-iterated art kind derived
   from the chosen splash (one figure, one view; a multi-view sheet
   becomes a multi-body model), finalize re-uploads the CHOSEN reference
   and builds from that exact image,
   runs the second-pass classification hook (block and refund), then image-to-3D,
   auto-rigging (biped only in v1; the Creature beta waits for a provider with a
   full six-clip story), the weapon-family clip set, download-before-expiry with
   the per-champion asset budgets enforced (over budget fails and refunds), asset
   provenance, the creation debit with refunds on failure. REMAINING, needs a paid
   Tripo key and their written UGC authorization: verify the live task envelope
   and the upload endpoint, test whether v1.0 presets retarget onto v2.5 rigs,
   the weapon as a separate prop (house library or generated), a real image
   classifier behind the hook, compression tuning under the budgets.
6. **Forge queue**: DONE. The queue itself (a second Matchmaker instance behind the
   same wire, one seat across both queues), forged-definition distribution at match
   setup (ten clients, spectators, rejoins, and the saved replay all carry the defs),
   champion select showing the account's finalized forged roster next to the roster
   grid, the queue's own rating pair in the Forge store (same Elo policy, separate
   ladder, leaver penalties included), bot backfill from the roster. Sharing other
   creators' champions into this select is phase 7's community tab.
7. **The gallery**: DONE. The public browse space (every finalized champion listed
   by default, the creator can unlist and relist), sort by recent and popular,
   search over names and creators, likes (one per account), reports with automatic
   takedown at a configurable distinct-account threshold plus a warning on the
   creator's account, the free practice test-drive from the gallery card, the
   per-champion "others may play it" toggle (on by default, enforced by the Forge
   queue's resolver), and the community tab at Forge-queue select (all shared
   champions, popular first, search, your liked ones pinned in front). Takedown
   review tooling (lifting one, reading reports) is an ops surface for later.
8. **Quotas, moderation, ops**: DONE. Per-account daily quotas on a rolling window
   over an append-only event table (the generation meter backstops the weekly
   ledger today; the 2D and agent meters are wired and wait for their phase 4
   surfaces), a blanket per-address rate limit over /api (the login throttle keeps
   its own backoff), and server config for every number in this plan through
   environment variables listed in .env.example, empty-safe for compose
   pass-through. (The word filter landed early with phase 3, since draft saves
   needed it.)

Phase 2, after the Forge proves itself: Stripe Checkout on the existing ledger, bots
playing forged champions through author-declared hints, mastery and skins for forged
champions, marker-based rig correction in the workshop view when a provider API
accepts joint placement, a second provider behind the interface, the Reforge option
(redoing a finalized champion's splash or model), and gallery comments and kit remix.
