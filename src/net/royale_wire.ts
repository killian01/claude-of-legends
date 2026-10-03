// The battle royale on the wire (ADR 0031): what a snapshot carries of the
// mode, what a player sends for it. The positions themselves ride the usual
// unit, projectile and zone records with a y beside x and z on the sphere
// (src/sim/geo.ts). Types only; protocol.ts embeds them.

import type { RoyaleStage, RoyaleVariant } from '../sim/royale/types';

export type { RoyaleStage, RoyaleVariant } from '../sim/royale/types';

// A point on the sphere, compact: x, y, z.
export type WirePoint = [number, number, number];

export interface SnapDusk {
  // Phase: 0 calm, 1 to 5 closing, 6 dark.
  p: number;
  c: WirePoint;
  r: number;
  // The cap this phase closes to, drawn ahead.
  nc?: WirePoint;
  nr?: number;
  // Sim time the phase ends; 1 while shrinking, 0 while holding.
  pe: number;
  sh: 0 | 1;
  // Share of maximum health burned per second outside the light.
  b: number;
}

// A cache still standing: id, position, golden (1) or not (0).
export type SnapCache = [number, number, number, number, 0 | 1];

export interface SnapRoyale {
  v: RoyaleVariant;
  st: RoyaleStage;
  // Sim time the drop ends, and the last light goes out.
  de: number;
  end: number;
  dusk: SnapDusk;
  // Every cache still standing, sent once a second (absent in between: the
  // client keeps the last list).
  caches?: SnapCache[];
  // Champions still in (One life) or in the match (Respawn), and how many
  // of them are people.
  alive: number;
  people: number;
  // The recipient's own takedowns and, once out or over, their place.
  score?: number;
  place?: number;
  // Respawn: the score leader; where they stand only while shown.
  leader?: { i: number; s: number; at?: WirePoint };
  // The recipient's own cache being opened: its id and since when.
  opening?: { c: number; since: number };
  // The recipient's own landing pick during the drop.
  drop?: WirePoint;
  // During the drop, everyone else's landing picks so far, the globe's
  // dots ("others' picks show", docs/plan-royale.md).
  picks?: WirePoint[];
}

// Sent to each person when their match ends or they are out for good.
export interface RoyaleResult {
  t: 'royale_result';
  v: RoyaleVariant;
  place: number;
  of: number;
  score: number;
  winner: string | null;
  // The top of the final ranking: name, champion, takedowns, bot or not.
  top: { name: string; championId: string; score: number; bot: boolean }[];
}

// What a player sends for the mode.
export type RoyaleClientMsg =
  // Enter a battle royale: joins a running match when one takes people
  // (ADR 0025's drop in), else starts one at once.
  | { t: 'royale'; v: RoyaleVariant; championId: string; sigils: [string, string]; skin?: number }
  // The landing point picked during the drop.
  | { t: 'drop'; x: number; y: number; z: number };
