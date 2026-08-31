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

// Per-weapon-family clip sets (ADR 0006): the family picks the attack.
export const WEAPON_FAMILIES = ['slashing', 'blunt', 'bow', 'staff', 'unarmed'] as const;
export type WeaponFamily = (typeof WEAPON_FAMILIES)[number];

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
  // Apply the family's six-clip set onto a rigged model; one animated GLB
  // carrying every clip.
  animate(req: { riggedTaskId: string; family: WeaponFamily }): Promise<ProviderAsset>;
}
