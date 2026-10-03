// The Dusk (CONTEXT.md; ADR 0031, docs/plan-royale.md), data-as-code: the
// five caps the light closes to and when, and how hard the dark burns. All
// times are seconds from landing; the calm runs until the first phase
// starts to close (CALM_S), and the last light goes out at PLAY_S. The
// edge moves at about a fifth of a champion's 3.7 m/s: a closing phase
// lasts as long as its shrink, plus the most its center may travel, takes
// at DUSK_EDGE_SPEED (src/sim/royale/dusk.ts draws the centers inside that
// allowance). Radii are chords (src/sim/geo.ts), so a cap of radius r holds
// exactly pi r^2 of ground: 88 m is about a third of the planet, 8 m the
// last light, about 200 m2.

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

export const DUSK_PHASES: readonly DuskPhaseDef[] = [
  { radius: 88, closeFrom: 90, closeTo: 185, holdTo: 235, burn: 0.01 },
  { radius: 56, closeFrom: 235, closeTo: 295, holdTo: 345, burn: 0.02 },
  { radius: 34, closeFrom: 345, closeTo: 390, holdTo: 440, burn: 0.04 },
  { radius: 18, closeFrom: 440, closeTo: 472, holdTo: 525, burn: 0.07 },
  { radius: 8, closeFrom: 525, closeTo: 545, holdTo: 600, burn: 0.12 },
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
