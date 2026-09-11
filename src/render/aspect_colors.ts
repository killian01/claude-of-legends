// The color of each aspect (CONTEXT.md: Aspect), shared by every surface
// that shows a ring creature or the favor it carries: the figure's veins
// and beacon, the minimap blotch, the HUD chip, the ground flash. One
// palette, so a red beacon on the bot ring and a red chip on the bar say
// the same thing. Presentation only; the sim never reads it.

import type { AspectId } from '../sim/content/rings';

export interface AspectColor {
  hex: number;
  css: string;
  // A darker ground for a chip or a portrait behind the color.
  dark: string;
}

export const ASPECT_COLORS: Readonly<Record<AspectId, AspectColor>> = {
  might: { hex: 0xff6a3d, css: '#ff6a3d', dark: '#3d1a10' },
  tide: { hex: 0x3fb4f5, css: '#3fb4f5', dark: '#0f2a3d' },
  tempo: { hex: 0xffd23f, css: '#ffd23f', dark: '#3d3210' },
  bulwark: { hex: 0xa6bdd4, css: '#a6bdd4', dark: '#1e2833' },
  swiftness: { hex: 0x7ef0a0, css: '#7ef0a0', dark: '#123d20' },
  resolve: { hex: 0xff9ad5, css: '#ff9ad5', dark: '#3d1a30' },
};

// The Wrath's color (CONTEXT.md): what an Ascendant wears and what its
// chip, its beacon and the mark on a doomed enemy say.
export const WRATH_COLOR: AspectColor = { hex: 0xf3ecff, css: '#f3ecff', dark: '#2b2340' };

// A creature's color: its aspect's, the Wrath's for an Ascendant (no
// aspect), a plain ember for anything unnamed.
export function aspectColor(aspect: AspectId | null | undefined, ascendant = false): AspectColor {
  if (ascendant) return WRATH_COLOR;
  return aspect ? ASPECT_COLORS[aspect] : { hex: 0xe8944a, css: '#e8944a', dark: '#3d2410' };
}
