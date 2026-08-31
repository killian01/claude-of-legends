# Forged champions are player-authored data, never player code

Players author their own champions in game (the Forge): name, appearance, stats, four
abilities, and a passive. A forged champion is pure data on the exact primitives the roster
already uses (the CastSpec deliveries, the EffectSpec payloads, the predicates); the content
declares, the engine executes, and nothing a player writes ever runs as code inside the sim.
Free-text passives are accepted, but an LLM agent compiles the description into those same
primitives or into one of the parameterized passive templates, and the compiled result, like
every kit, must pass the deterministic validator (hard per-field bounds plus the power
budget), which is the sole balance authority. We rejected player-written code judged by an
agent: the sim is one deterministic core running identically in ten browsers, on the server,
and in the headless environment, and an LLM judge is itself non-deterministic and promptable
around. Forged champions are playable only in the Forge queue, mixed with roster champions,
on that queue's own rating.

## Appearance pipeline

Appearance is created in game, nothing imported, and it starts with the art, not the tech.
The player's first act is making the splash art: the painted 3:4 illustration in the shared
style block of docs/design/portrait-prompts.md, weapon included if the champion carries one.
Iteration lives at this 2D stage, free within a generous daily quota, because images are
cheap and the 3D is not. Finalizing the draft spends a creation: the pipeline derives from
the validated splash a technical model sheet (one character, full body, front-facing A-pose,
empty hands, neutral background) plus a separate weapon reference, then runs image-to-3D and
auto-rigging, with two or three model attempts included and technical failures refunded. The
splash is sealed at finalization; a Reforge option is deferred.

- **The weapon is never part of the body mesh.** The player draws one picture; the machine
  does the split. The body generates empty-handed, the weapon separately (house library or
  its own generation inside the same creation), hung on the hand bone as a prop and adjusted
  in the workshop view. A fused weapon was rejected: it degrades the rig exactly where it
  shows most, the attack.
- **Animations** come as per-weapon-family clip sets (slashing melee, blunt melee, bow,
  staff, unarmed) mapped from the provider's preset library onto the six clips the renderer
  expects, with a per-clip override menu for the player.
- **Body plans**: bipeds in v1, plus a Creature option flagged beta (quadruped, serpentine,
  and kin through the provider's non-humanoid rigging), same creation cost, generous refunds
  while the beta flag stands.
- **Ability icons**: the spec-derived procedural icons by default; optionally generated per
  spell under a dedicated flat icon template (not the painterly splash style), on the 2D
  quota, previewed at full size and at in-match size before compression.
- **Card texts**: the author writes name, title, and tagline, the agent pre-filling
  suggestions from the kit, a word filter on all three. Every surface shows the creator's
  signature (by account name).
- **In-game corrections** are the ones that cover real cases without expert UI: prop grip,
  scale, clip swaps, all in the workshop view. Marker-based rig correction (moving joint
  points) exists only in provider webapps today; it joins the Forge the day a provider API
  accepts joint placement.
- **Provider**: Tripo first, behind a neutral interface (generate2D, imageTo3D, rig,
  animate). Meshy was rejected as primary: its rigging API is humanoid-only, accepts no
  joint hints, and cannot apply its animation library programmatically. Rodin optimizes
  geometry fidelity, not rigging. The interface is the insurance on a market that ships a
  capability per quarter.

The engine's stylized figure remains only as the in-match render fallback when a client
cannot load a model, exactly as it already is for the roster.

## Sharing and the gallery

Every finalized forged champion is public in the gallery by default (the creator can remove
it) and playable by anyone by default (a per-champion toggle turns it off): openness is the
default because a gallery that starts empty kills the mode it serves. The Forge-queue select
gains a community tab listing every shared champion directly, popular first, with search and
pinned favorites; no bookmark step stands between seeing a champion and picking it. Gallery
v1 ships browse, sort (recent, popular), like, report, and a free practice test-drive;
comments and kit remix are deferred. A public gallery changes the exposure that justified
light moderation, so finalization adds a second-pass image classification (block and refund
on failure), and a validated report removes the champion from gallery and community select
and warns the creator's account.

## Considered options

- Player-written passive or ability code, sandboxed or agent-reviewed: rejected outright.
  Determinism, security on nine other clients and the server, and a judge that a motivated
  cheater will eventually talk past.
- Importing outside assets or definitions (GLB files, JSON): rejected; the whole flow lives
  in game, nothing is imported.
- The stylized figure as a legitimate final look, with generation as an optional upgrade:
  rejected. A finished forged champion is its generated model; drafts stay free and
  unlimited for iteration, previewed on the stylized figure.
- Starting from a technical model sheet and deriving the splash at the end: rejected in
  favor of the reverse. The splash is the creative anchor; the model sheet is machinery.
- Relying on multi-part generation to separate a weapon drawn on the splash: rejected as a
  foundation; natively separated parts help topology, but nothing guarantees the weapon
  comes out detachable with a usable grip.

## Consequences

- The first runtime content registry and the first content validator in the codebase: the
  champion table stops being a compile-time constant and is resolved per match instead.
- Forged definitions travel on the wire: match setup delivers them to all ten clients and to
  spectators, and the replay file embeds them, where it otherwise stores ids only.
- Policy contract v0 is untouched: actions name slots (Q, W, E, R), never ability ids.
  Scripted bots play forged champions through the existing default hints; author-declared
  roles can feed better hints later.
- Icons, spell VFX schools, and tooltips are already derived from the spec itself, so a
  forged kit is self-presenting with zero authored assets.
- Finalization enforces per-champion asset budgets (splash, model, weapon; numbers in server
  config), and every generated asset records its provenance (provider, model version, date).
  The phase 5 spike verifies provider terms on ownership, commercial use, and redistribution
  of generated assets.
- Phase 5 of the plan opens with a spike on preset animation coverage per body plan; the
  Creature beta ships only for plans with a full six-clip story.
- Moderation in v1: the word filter on names and card texts, the provider's image safety,
  the second-pass classification at finalization, and gallery reports with takedown and
  account warnings.

## Addendum (2026-08-31): what the phase 5 spike found

The provider spike (docs/research/generation-providers-spike.md, local note, primary
sources only) confirms the pipeline on Tripo for bipeds and corrects three things:

- **The Creature beta does not ship in v1**, by this ADR's own bar. Tripo's creature rig
  (model v2.5, seven body plans) offers one locomotion preset per non-biped plan and no
  cast, death, or victory clip; no provider offers more. The full six-clip preset story
  exists only in Tripo's biped v1.0 rig library. The neutral interface therefore carries
  the rig model version as part of the provider contract, and the single most load-bearing
  unknown to test with a live key is whether v1.0 presets retarget onto v2.5 rigs.
- **The launch gate is contractual, not technical.** Tripo's terms (s. 3.2) forbid making
  the generation service available to end users without prior written authorization. The
  Forge is exactly that. A written agreement with Tripo precedes any player-facing
  launch; development against the API with our own paid key is unaffected. Paid-tier
  outputs are otherwise fully owned by us with a no-training commitment (s. 5.2.2).
- **Meshy's rejection stands on new grounds.** The old reasons are stale: Meshy now
  applies library clips programmatically (action_id, 600+ clips) and can force A-pose on
  image-to-3D. It remains rejected as primary because rigging is humanoid-only, animation
  runs only on Meshy rigs, non-Enterprise API output is deleted after 3 days, and Meshy
  trains on non-Enterprise inputs and outputs. It stays the documented fallback behind
  the interface, with those caveats on record.

Asset provenance gains a duty: pin provider, model version, task id, and date per asset,
so any future terms or capability change can be scoped to exactly the assets it affects.
