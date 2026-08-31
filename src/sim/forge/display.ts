// Display tuning for a forged champion (ADR 0010, the workshop's "scale,
// clip swaps" adjustments): how the generated model is presented, never how
// it plays. Pure data plus one sanitizer shared by the server route that
// stores it and the clients that apply it; zero engine effect, exactly like
// skins. All fields optional: absent means the renderer default.

// Procedural weapon kinds the renderer can attach (src/render/champions/
// props.ts); 'none' hides the weapon outright.
export const DISPLAY_PROP_KINDS = [
  'none',
  'sword',
  'shield',
  'daggers',
  'staff',
  'rifle',
  'bow',
] as const;
export type DisplayPropKind = (typeof DISPLAY_PROP_KINDS)[number];

export interface ForgedDisplayProp {
  kind: DisplayPropKind;
  // Rig bone the prop rides (raw GLB node name).
  bone: string;
  // Euler XYZ rotation inside the anchor, radians, and position offset in
  // world units: the grip correction the workshop tunes by hand.
  rot: [number, number, number];
  pos: [number, number, number];
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
  yOffset: { min: -0.5, max: 1.5, fallback: 0 },
  yawOffset: { min: -Math.PI, max: Math.PI, fallback: 0 },
  propOffset: { min: -2, max: 2 },
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
      out.prop = {
        kind,
        bone,
        rot: triple(prop.rot, DISPLAY_BOUNDS.yawOffset.min, DISPLAY_BOUNDS.yawOffset.max),
        pos: triple(prop.pos, DISPLAY_BOUNDS.propOffset.min, DISPLAY_BOUNDS.propOffset.max),
      };
    }
  }
  return out;
}
