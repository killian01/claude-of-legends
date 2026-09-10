// The two teams' colors in the 3D scene: the body color (crystals, minion
// cloth, the map dressing), the light tint (sparks, hit flashes, pings),
// and the bright ring the authored terrain draws under a team's structures.
// src/ui/minimap.ts mirrors the body colors as CSS strings.

export const TEAM_COLORS: readonly number[] = [0x4a7dd6, 0xd65c5c];
export const TEAM_LIGHT: readonly number[] = [0x9dbcf5, 0xf5a3a3];
export const TEAM_RING: readonly number[] = [0x59bdff, 0xff7970];
