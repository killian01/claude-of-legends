// The neutral color a Strikepost wears (CONTEXT.md: Strikepost): its bar,
// its minimap dot and its name in the target frame. Kept apart from its
// figure (post_shapes.ts) so the HUD reads it without Three.js.

import type { StrikepostKind } from '../sim/content/strikeposts';

export const POST_COLOR = 0xe8d9b0;
export const POST_CSS = '#e8d9b0';

// The colors of a post's figure. Both wear the same red ring, where a hit
// is aimed; the body tells them apart: warm timber for the bare one, dark
// iron with bright steel bands and a steel dome for the plated one, so the
// two read apart from across the base on a phone.
export interface PostPalette {
  foot: number;
  body: number;
  cap: number;
  ring: number;
  bands: number | null;
}

export function postPalette(kind: StrikepostKind): PostPalette {
  if (kind === 'plated') {
    return { foot: 0x7d7a72, body: 0x4a525c, cap: 0x9aa6b3, ring: 0xd8463a, bands: 0xb4bfcb };
  }
  return { foot: 0x7d7a72, body: 0x8a6236, cap: 0x6e4c2a, ring: 0xd8463a, bands: null };
}
