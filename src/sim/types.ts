// Core sim constants and shared types. The sim is a fixed-rate deterministic
// simulation: everything time-based counts ticks, never wall-clock.

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

export type TeamId = 0 | 1;

// Ground-plane coordinates. Named x/z so the Three.js renderer maps them onto
// its ground plane without translation.
export interface Vec2 {
  x: number;
  z: number;
}
