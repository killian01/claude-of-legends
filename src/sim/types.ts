// Core sim constants and shared types. The sim is a fixed-rate deterministic
// simulation: everything time-based counts ticks, never wall-clock.

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

export type TeamId = 0 | 1;

export type AbilityKey = 'Q' | 'W' | 'E' | 'R';

// Champion level required to rank the ultimate (game definition).
export const ULT_LEVEL = 6;

export type DamageType = 'physical' | 'magic' | 'true';

// Ground-plane coordinates. Named x/z so the Three.js renderer maps them onto
// its ground plane without translation.
export interface Vec2 {
  x: number;
  z: number;
}

// One scoreboard line per champion; shared by the sim, the wire protocol,
// and the IWorld seam. Carries no position, so it can safely cross the fog.
export interface ScoreRow {
  unitId: number;
  // The champion's short name, always: the sim owns this one.
  name: string;
  championId: string;
  // Who holds the seat (player or bot label). The sim cannot know it, so it
  // is null offline and filled by the server, which does. Kept apart from
  // `name` so a scoreboard can show both the person and the champion.
  player: string | null;
  team: TeamId;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  // The build so far, in inventory order: item ids, for the scoreboard.
  items: readonly string[];
}
