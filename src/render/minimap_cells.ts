// One cell of the planet's minimap ground (planet_minimap.ts), its color
// worked out in numbers: the region's color or the water's, the relief
// over it, the night outside the light, the light's edge and the next
// cap's line, each laid over the last as a canvas lays a translucent fill
// (source over). The minimap writes the cells into one picture and puts it
// up whole, where it used to fill each layer of each cell with its own CSS
// color string: thousands of fills and parsed colors per repaint, the
// minimap's main cost on a phone.

export type Rgb = readonly [number, number, number];

// The ground under the water line, the minimap's own blue.
export const WATER_RGB: Rgb = [52, 112, 150];
const WATER_LINE = -0.4;
const NIGHT: Rgb = [8, 14, 46];
const EDGE: Rgb = [255, 140, 60];
const NEXT: Rgb = [255, 214, 90];

// What a cell knows of the Dusk: how far past the light's edge it lies
// (meters along the ground, negative inside), and how far from the next
// cap's line; null when there is none.
export interface CellDusk {
  past: number | null;
  next: number | null;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
// The color being laid, reused cell after cell.
const rgb = [0, 0, 0];

function over(c: Rgb, a: number): void {
  rgb[0] = c[0] * a + rgb[0]! * (1 - a);
  rgb[1] = c[1] * a + rgb[1]! * (1 - a);
  rgb[2] = c[2] * a + rgb[2]! * (1 - a);
}

// Writes the cell's color at `at` in an RGBA picture (opaque): `base` is
// the region's color, `h` the ground's height there, `span` the meters a
// cell spans.
export function paintCell(
  out: Uint8ClampedArray,
  at: number,
  base: Rgb,
  h: number,
  dusk: CellDusk,
  span: number,
): void {
  const ground = h < WATER_LINE ? WATER_RGB : base;
  rgb[0] = ground[0];
  rgb[1] = ground[1];
  rgb[2] = ground[2];
  // Relief: lighter up high, darker down low.
  const shade = Math.max(-0.25, Math.min(0.25, h * 0.12));
  if (shade > 0) over(WHITE, shade);
  else if (shade < 0) over(BLACK, -shade);
  if (dusk.past !== null) {
    if (dusk.past > 0) over(NIGHT, Math.min(0.72, 0.35 + dusk.past * 0.08));
    if (Math.abs(dusk.past) < span * 0.6) over(EDGE, 0.85);
  }
  if (dusk.next !== null && dusk.next < span * 0.5) over(NEXT, 0.9);
  out[at] = rgb[0]!;
  out[at + 1] = rgb[1]!;
  out[at + 2] = rgb[2]!;
  out[at + 3] = 255;
}
