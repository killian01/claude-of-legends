// The battle royale's state (ADR 0031, docs/plan-royale.md): what the sim
// holds for a match on the Wanderseed and what every host reads off it, the
// server's snapshots, the client's HUD, the bots. Types and constants only;
// the rules live beside this file.

import type { Vec3 } from '../geo';

export type RoyaleVariant = 'respawn' | 'one_life';

// Seats in a match: house bots fill whatever people do not take.
export const ROYALE_SEATS = 50;
// The drop: seconds over the globe to pick a landing point.
export const DROP_S = 10;
// The calm after landing, before the Dusk starts to close.
export const CALM_S = 90;
// From landing to the last light going out.
export const PLAY_S = 600;
// Respawn: seconds a death costs.
export const RESPAWN_S = 5;
// Respawn: people may join until this long before the end.
export const JOIN_UNTIL_END_S = 120;
// Seconds of standing beside a cache to open it; damage breaks it.
export const CACHE_OPEN_S = 1.5;
// Reach from a cache's center within which a champion opens it.
export const CACHE_REACH_M = 1.6;
// Respawn: a cache comes back this long after it was opened.
export const CACHE_BACK_S = 90;
// A camp comes back this long after it fell.
export const CAMP_BACK_S = 90;
// The champion's level on landing, Q, W and E learned.
export const START_LEVEL = 3;
// Health back for a takedown and for a camp, as a share of the maximum.
export const TAKEDOWN_HEAL = 0.3;
export const CAMP_HEAL = 0.3;
// Out of combat (no damage dealt or taken for this long), speed grows.
export const OUT_OF_COMBAT_S = 5;
export const OUT_OF_COMBAT_SPEED = 0.4;
// There is no fountain to refill at: out of combat, a share of the maximum
// mana comes back every second (a playtest, 2026-10-03: a match ended with
// no mana left), and a takedown, a camp and a cache each give some back.
export const OUT_OF_COMBAT_MANA = 0.04;
export const TAKEDOWN_MANA = 0.3;
export const CAMP_MANA = 0.3;
export const CACHE_MANA = 0.25;
// A takedown's heal and mana fall off with the killer's streak: the share
// is 1 / (1 + STREAK_FALLOFF * (streak - 1)). A fed assassin otherwise came
// out of every kill healed for the next and emptied a match alone.
export const STREAK_FALLOFF = 0.5;
// A launch pad throws a champion this far (chord, meters), over this long.
export const PAD_THROW_M = 50;
export const PAD_FLIGHT_S = 1.6;
// Reach of a pad's center that triggers it.
export const PAD_REACH_M = 1.4;
// Respawn: the score leader shows to everyone this often, and a takedown
// on them counts this much.
export const LEADER_SHOW_EVERY_S = 30;
export const LEADER_TAKEDOWN_SCORE = 2;
// When the big creatures rise, seconds after landing.
export const RING_CREATURES_AT_S = 180;
export const WARDEN_AT_S = 360;

// One of the Dusk's caps: a circle on the sphere, its radius a chord.
export interface DuskCap {
  center: Vec3;
  radius: number;
}

export interface DuskState {
  // 0 the calm, 1 to 5 the five closing phases, 6 the last light out.
  phase: number;
  // The lit cap now (it moves while shrinking).
  now: DuskCap;
  // The cap the current phase closes to, drawn ahead; null once dark.
  next: DuskCap | null;
  // Sim time the current phase ends.
  phaseEndsAt: number;
  // True while the light is closing, false while it holds.
  shrinking: boolean;
  // Outside the light, the share of maximum health burned per second.
  burn: number;
}

export interface CacheState {
  id: number;
  pos: Vec3;
  golden: boolean;
  present: boolean;
  // Respawn: when an opened cache comes back.
  respawnAt: number | null;
  // The champion opening it and since when, or null.
  opener: number | null;
  openSince: number;
}

export interface PadSite {
  id: number;
  at: Vec3;
  to: Vec3;
}

export type RoyaleStage = 'drop' | 'play' | 'over';

export interface RoyaleState {
  variant: RoyaleVariant;
  stage: RoyaleStage;
  // Sim time the drop ends and everyone lands.
  dropEndsAt: number;
  // Sim time the last light goes out and the match ends.
  endsAt: number;
  dusk: DuskState;
  caches: CacheState[];
  pads: PadSite[];
  // Landing points picked during the drop, by unit id.
  drops: Map<number, Vec3>;
  // Takedowns scored, by unit id (Respawn ranks by this).
  scores: Map<number, number>;
  // One life: champions in the order they fell, first out first.
  eliminated: number[];
  // The winner once the match is over: the last standing, or the best score.
  winnerId: number | null;
  // Respawn: the score leader, and when they were last shown to everyone.
  leaderId: number | null;
  leaderShownAt: number;
}

// The events the mode adds to the sim's stream.
export type RoyaleEvent =
  | { type: 'royale_land'; unitId: number }
  | { type: 'royale_loot'; unitId: number; itemId: string; source: 'cache' | 'camp' | 'takedown' }
  | { type: 'royale_cache'; unitId: number; cacheId: number }
  | { type: 'royale_pad'; unitId: number; padId: number }
  | { type: 'royale_dusk'; phase: number }
  | { type: 'royale_out'; unitId: number; killerId: number; place: number }
  | { type: 'royale_leader'; unitId: number }
  | { type: 'royale_end'; winnerId: number | null };
