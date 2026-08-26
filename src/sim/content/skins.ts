// Champion skins: purely cosmetic appearance variants (CONTEXT.md). Data
// only, zero engine logic and zero gameplay effect; the renderer maps these
// palettes onto the champion silhouettes, and the Policy observation never
// sees them. Index 0 is the default skin: a null body means "use the team
// color", which is how default skins keep team readability.

export interface SkinDef {
  name: string;
  // Body color, or null for the team color (default skins).
  body: number | null;
  // Head and prop color.
  accent: number;
}

export const SKINS: Readonly<Record<string, readonly SkinDef[]>> = {
  korrath: [
    { name: 'Default', body: null, accent: 0x8f9aa8 },
    { name: 'Obsidian Ward', body: 0x2b2b33, accent: 0xb8c4d6 },
    { name: 'Dawnplate', body: 0xc9a84a, accent: 0xf0e3b0 },
  ],
  dain: [
    { name: 'Default', body: null, accent: 0xe07a3a },
    { name: 'Coldsnap', body: 0x3a5a78, accent: 0xa8d8f0 },
    { name: 'Ashen Ring', body: 0x4a4442, accent: 0xd6d0c8 },
  ],
  sylra: [
    { name: 'Default', body: null, accent: 0x64c95e },
    { name: 'Nightbloom', body: 0x3a2b52, accent: 0xb07ee8 },
    { name: 'Amber Grove', body: 0x6b5a2e, accent: 0xe8c862 },
  ],
  fenn: [
    { name: 'Default', body: null, accent: 0x9a63d8 },
    { name: 'Ghostedge', body: 0x9aa8b0, accent: 0xe8f0f5 },
    { name: 'Crimson Hour', body: 0x5c2430, accent: 0xe86a6a },
  ],
  elowen: [
    { name: 'Default', body: null, accent: 0xbfe4f0 },
    { name: 'Deepmist', body: 0x2e4452, accent: 0x7fb8cc },
    { name: 'Sunveil', body: 0xb08a3e, accent: 0xf5e3a8 },
  ],
  vesk: [
    { name: 'Default', body: null, accent: 0xc9b458 },
    { name: 'Ironsight', body: 0x44484f, accent: 0xaab4c0 },
    { name: 'Verdigris', body: 0x3e6650, accent: 0x8fd0a8 },
  ],
  ashvyn: [
    { name: 'Default', body: null, accent: 0x5f5f8a },
    { name: 'Duskfeather', body: 0x33283f, accent: 0xc0a8e0 },
    { name: 'Snowstring', body: 0xb8c4cc, accent: 0xf0f5f8 },
  ],
  maera: [
    { name: 'Default', body: null, accent: 0x4fb8c9 },
    { name: 'Coral Deep', body: 0x8a4a52, accent: 0xf0a8a0 },
    { name: 'Stormtide', body: 0x2e3a5c, accent: 0x9dbcf5 },
  ],
  torv: [
    { name: 'Default', body: null, accent: 0xb0733a },
    { name: 'Basalt', body: 0x33302e, accent: 0x8f8a85 },
    { name: 'Tundra Horn', body: 0x6e7f8a, accent: 0xd8e6f0 },
  ],
  rhoka: [
    { name: 'Default', body: null, accent: 0xd85e5e },
    { name: 'Nightprowl', body: 0x262b33, accent: 0x7f8ca8 },
    { name: 'Emberpelt', body: 0x7a3a24, accent: 0xf0a04a },
  ],
};

// Resolves a skin index to a valid SkinDef (unknown champion or out-of-range
// index falls back to the default look).
export function skinOf(championId: string | null, index: number): SkinDef {
  const list = championId ? SKINS[championId] : undefined;
  return list?.[index] ?? list?.[0] ?? { name: 'Default', body: null, accent: 0xffffff };
}

// Clamps a client-supplied skin index to the champion's skin list.
export function clampSkin(championId: string, index: unknown): number {
  const list = SKINS[championId];
  if (!list || typeof index !== 'number' || !Number.isInteger(index)) return 0;
  return index >= 0 && index < list.length ? index : 0;
}
