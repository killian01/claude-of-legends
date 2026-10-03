// The planet's chart moving under the effects (src/render/planet_chart.ts):
// on the Wanderseed the renderer draws in a flat chart around the camera,
// and when the chart re-centers every point already placed in it is
// carried to where the same spot of ground lands in the new chart. The
// pooled primitives hold their points in their own slots, so each takes
// the carry itself (`rechart`); a beat queued under an older chart fires
// with the points it captured then, carried through the spawn frame. On
// the plane none of this ever runs: the frame's map stays null.

export type ChartRemap = (x: number, z: number) => { x: number; z: number };

// The carry applied to whatever is spawned right now, null for none.
export interface SpawnFrame {
  map: ChartRemap | null;
}

// A spawn point through the frame.
export function framed(frame: SpawnFrame | undefined, x: number, z: number): { x: number; z: number } {
  return frame?.map ? frame.map(x, z) : { x, z };
}
