// Display tuning for a forged champion (ADR 0010, the workshop's "scale,
// clip swaps" adjustments): how the generated model is presented, never how
// it plays. Pure data plus one sanitizer shared by the server route that
// stores it and the clients that apply it; zero engine effect, exactly like
// skins. All fields optional: absent means the renderer default.

// Weapon kinds the renderer can attach: the house 3D weapon models (the
// roster's own generated GLBs, mapped in src/render/champions/forged.ts),
// plus 'generated' for the champion's OWN weapon built by the Forge, and
// 'none' for an empty hand. The old procedural shapes are gone: boxes and
// cylinders read as clutter next to a generated model.
export const DISPLAY_PROP_KINDS = ['none', 'maul', 'shield', 'rifle', 'generated'] as const;
export type DisplayPropKind = (typeof DISPLAY_PROP_KINDS)[number];

export interface ForgedDisplayProp {
  kind: DisplayPropKind;
  // Rig bone the prop rides (raw GLB node name).
  bone: string;
  // Euler XYZ rotation inside the anchor, radians, and position offset in
  // world units: the grip correction the workshop tunes by hand.
  rot: [number, number, number];
  pos: [number, number, number];
  // Uniform multiplier on the weapon's derived base size; absent means 1.
  scale?: number;
}

export interface ForgedDisplay {
  // World-space height the model is normalized to (roster range 1.6..3.6).
  height?: number;
  // Extra lift after grounding (hovering champions).
  yOffset?: number;
  // Forward correction, radians, for models not generated facing +Z.
  yawOffset?: number;
  prop?: ForgedDisplayProp;
}

export const DISPLAY_BOUNDS = {
  height: { min: 1.2, max: 4.5, fallback: 2.4 },
  // Zero is feet on the ground; the offset only ever lifts (hovering
  // champions), never sinks the model into the floor.
  yOffset: { min: 0, max: 1.5, fallback: 0 },
  yawOffset: { min: -Math.PI, max: Math.PI, fallback: 0 },
  propOffset: { min: -2, max: 2 },
  // Enough to fix a sword lost in a fist or swallowing the arm; a per-axis
  // stretch would shear the texture, so the scale stays uniform.
  propScale: { min: 0.4, max: 2.5, fallback: 1 },
  boneNameMax: 64,
} as const;

function clamp(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, v));
}

function triple(v: unknown, min: number, max: number): [number, number, number] {
  const raw = Array.isArray(v) ? v : [];
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = clamp(raw[i], min, max) ?? 0;
  return out;
}

// Accepts anything a client sent and returns only the recognized, clamped
// fields; null when the input is not an object at all. An unknown prop kind
// or a missing bone drops the prop rather than the whole payload.
export function sanitizeForgedDisplay(raw: unknown): ForgedDisplay | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const out: ForgedDisplay = {};
  const height = clamp(r.height, DISPLAY_BOUNDS.height.min, DISPLAY_BOUNDS.height.max);
  if (height !== undefined) out.height = height;
  const yOffset = clamp(r.yOffset, DISPLAY_BOUNDS.yOffset.min, DISPLAY_BOUNDS.yOffset.max);
  if (yOffset !== undefined) out.yOffset = yOffset;
  const yawOffset = clamp(r.yawOffset, DISPLAY_BOUNDS.yawOffset.min, DISPLAY_BOUNDS.yawOffset.max);
  if (yawOffset !== undefined) out.yawOffset = yawOffset;
  const prop = r.prop as Record<string, unknown> | null | undefined;
  if (typeof prop === 'object' && prop !== null) {
    const kind = DISPLAY_PROP_KINDS.find((k) => k === prop.kind);
    const bone =
      typeof prop.bone === 'string' ? prop.bone.slice(0, DISPLAY_BOUNDS.boneNameMax) : '';
    if (kind !== undefined && (bone !== '' || kind === 'none')) {
      const scale = clamp(prop.scale, DISPLAY_BOUNDS.propScale.min, DISPLAY_BOUNDS.propScale.max);
      out.prop = {
        kind,
        bone,
        rot: triple(prop.rot, DISPLAY_BOUNDS.yawOffset.min, DISPLAY_BOUNDS.yawOffset.max),
        pos: triple(prop.pos, DISPLAY_BOUNDS.propOffset.min, DISPLAY_BOUNDS.propOffset.max),
        ...(scale !== undefined ? { scale } : {}),
      };
    }
  }
  return out;
}
