// The Dusk (CONTEXT.md; ADR 0031, docs/plan-royale.md), data-as-code: the
// five caps the light closes to and when, and how hard the dark burns. All
// times are seconds from landing; the calm runs until the first phase
// starts to close (CALM_S), and the last light goes out at PLAY_S. The
// edge moves at about a fifth of a champion's 3.7 m/s: a closing phase
// lasts as long as its shrink, plus the most its center may travel, takes
// at DUSK_EDGE_SPEED (src/sim/royale/dusk.ts draws the centers inside that
// allowance). Radii are chords (src/sim/geo.ts), so a cap of radius r holds
// exactly pi r^2 of ground: 110 m is about half the planet, 10 m the
// last light, about 310 m2.

export interface DuskPhaseDef {
  // The chord radius this phase closes to, meters.
  radius: number;
  // When the closing starts and ends, and when the hold that follows ends.
  closeFrom: number;
  closeTo: number;
  holdTo: number;
  // Outside the light, the share of maximum health burned each second.
  burn: number;
}

export const DUSK_EDGE_SPEED = 0.74;

// The first closing leaves about half the planet lit, then a quarter, a
// tenth: at 88 m it left a third, and fifty champions crammed into it
// fought all at once (a playtest, 2026-10-03).
export const DUSK_PHASES: readonly DuskPhaseDef[] = [
  { radius: 110, closeFrom: 90, closeTo: 195, holdTo: 240, burn: 0.01 },
  { radius: 78, closeFrom: 240, closeTo: 300, holdTo: 350, burn: 0.02 },
  { radius: 50, closeFrom: 350, closeTo: 402, holdTo: 450, burn: 0.04 },
  { radius: 28, closeFrom: 450, closeTo: 487, holdTo: 528, burn: 0.07 },
  { radius: 10, closeFrom: 528, closeTo: 552, holdTo: 600, burn: 0.12 },
];

// Once the last light is out, everyone still standing burns at this share,
// and harder for every DARK_ESCALATE_S past it, so a match of two healers
// still ends.
export const DARK_BURN = 0.12;
export const DARK_ESCALATE_S = 10;

// The most a cap's center travels during its closing, as a share of the
// shrink, whatever the edge allowance says: the next cap stays well inside
// the one before.
export const DUSK_MAX_SHIFT = 0.8;

// The final point stands on ground with room around it: this many of the
// eight points on a ring of this chord radius around it are walkable.
export const FINAL_RING_M = 4;
export const FINAL_RING_MIN = 6;

export const DUSK_CONTENT = {
  edgeSpeed: DUSK_EDGE_SPEED,
  phases: DUSK_PHASES,
  darkBurn: DARK_BURN,
  darkEscalateS: DARK_ESCALATE_S,
  maxShift: DUSK_MAX_SHIFT,
  finalRing: FINAL_RING_M,
  finalRingMin: FINAL_RING_MIN,
};
