// The neutral generation provider interface (ADR 0006): generate2D,
// imageTo3D, rig, animate, spoken in OUR vocabulary (weapon families and
// the renderer clip roles), never a vendor's. Tripo is the first
// implementation (tripo.ts); the mock (mock.ts) runs the pipeline in
// tests and keyless dev. The interface is the insurance on a market that
// ships a capability per quarter: swapping vendors must never touch the
// pipeline.
//
// The spike (docs/research/generation-providers-spike.md, 2026-08-31)
// pinned two contract points: v1 rigs BIPEDS ONLY (no provider has a
// six-clip story for creatures), and provenance must pin provider, model
// version, task id, and date per asset.

// The clips the renderer actually consumes in match, and exactly what one
// Tripo retarget task may carry (live 2026-08-31: animations size <= 5).
// A victory clip returns in phase 2 as a second, geometry-free task
// merged client-side; the in-match renderer never consumed one.
export const CLIP_ROLES = ['idle', 'run', 'attack', 'cast', 'death'] as const;
export type ClipRole = (typeof CLIP_ROLES)[number];

// Optional per-spell overrides riding beside the five roles: an ability
// key's own cast animation (playtest round 6 ask). A slot's pick comes
// from the cast and attack catalogs (a spell may be a strike); a slot
// without a pick plays the shared cast clip. Slots travel the same
// clips/clipFiles maps as the roles, so the wire and the store need no
// new shape.
export const SPELL_CLIP_SLOTS = ['castQ', 'castW', 'castE', 'castR'] as const;
export type SpellClipSlot = (typeof SPELL_CLIP_SLOTS)[number];

// Per-weapon-family clip sets (ADR 0006): the family is the quick-pick
// that PREFILLS the five clips; the player then picks each one from the
// provider's catalog (playtest: not a bundle, every animation their own).
export const WEAPON_FAMILIES = ['slashing', 'blunt', 'bow', 'staff', 'unarmed'] as const;
export type WeaponFamily = (typeof WEAPON_FAMILIES)[number];

// One pickable animation in a provider's catalog: the provider's own clip
// id (what animate accepts and what the baked GLB names the clip) and a
// player-facing label.
export interface ClipChoice {
  id: string;
  label: string;
}

// v1 body plan: bipeds only (spike verdict; the Creature beta waits for a
// provider with a full six-clip story).
export type RigType = 'biped';

// One produced asset: the provider's durable task id, a download URL that
// EXPIRES provider-side (the pipeline downloads immediately), and the
// provenance facts the ADR requires pinned.
export interface ProviderAsset {
  taskId: string;
  url: string;
  provenance: {
    provider: string;
    model: string;
    at: number;
    taskId: string;
  };
  // What the task actually cost, in the provider's own units, when the
  // provider says so on the settled task (Tripo's consumed_credit). This
  // is the calibration input ADR 0017 asks for: exact, per act, and never
  // a balance difference that a concurrent job could poison. Absent when
  // a provider does not report it.
  cost?: number;
}

// A failed operation. Every generation failure refunds the creation
// (ADR 0007); `blocked` marks a content refusal (the provider's image
// safety or our second-pass classification) as opposed to a technical
// failure, so the player-facing message can differ.
export class GenerationError extends Error {
  constructor(
    message: string,
    readonly blocked = false,
  ) {
    super(message);
    this.name = 'GenerationError';
  }
}

export interface GenerationProvider {
  readonly id: string;
  // True when generate2D with an image performs instruction-guided
  // EDITING that preserves the input character (the prompt says only the
  // change). Absent or false means the image is loose inspiration and the
  // prompt must restate everything; art.ts composes prompts on this flag.
  readonly editsImages?: boolean;
  // Text (and optionally a source image) to a 2D image: the splash
  // iteration and the model sheet derivation both live here. `image` is a
  // provider file token or URL, whichever uploadImage returned. `tPose`
  // asks the provider to stand the character in a rig-ready pose while
  // keeping its look (the model reference derivation sets it).
  generate2D(req: { prompt: string; image?: string; tPose?: boolean }): Promise<ProviderAsset>;
  // Push a local file to the provider and get back a reference usable as
  // an image input. Optional: a provider without it limits generate2D to
  // text (the pipeline then derives the model sheet from the prompt
  // alone instead of the splash).
  uploadImage?(file: { data: Uint8Array; name: string }): Promise<string>;
  // One 2D image to a textured GLB model. `image` is an uploadImage
  // token (the staged flow: the chosen reference is a local file the
  // pipeline re-uploads); imageUrl and imageTaskId remain for
  // provider-fresh outputs still inside their URL validity.
  imageTo3D(req: {
    image?: string;
    imageUrl?: string;
    imageTaskId?: string;
    seed?: number;
  }): Promise<ProviderAsset>;
  // Auto-rig a generated model.
  rig(req: { modelTaskId: string; rigType: RigType }): Promise<ProviderAsset>;
  // The catalog the player picks from, per renderer clip role: all the
  // deaths for death, all the strikes for attack. Ids are the provider's
  // own; the pipeline validates picks against this exact list.
  clipChoices(): Readonly<Record<ClipRole, readonly ClipChoice[]>>;
  // The family's suggested pick per role: the quick-pick prefill and the
  // fallback for any role the player left untouched.
  clipDefaults(family: WeaponFamily): Readonly<Record<ClipRole, string>>;
  // Bake a batch of preset clips onto a rigged model (at most 5 per
  // task, the live retarget limit): one GLB naming each clip by its
  // preset id. withGeometry false asks for an animation-only file, the
  // per-clip bake architecture's small artifact; true bakes a full
  // self-contained model (how pre-split champions were sealed).
  animate(req: {
    riggedTaskId: string;
    animations: readonly string[];
    withGeometry: boolean;
  }): Promise<ProviderAsset>;
}
