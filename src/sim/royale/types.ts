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
// The genre keeps a match alive with what a fight leaves to recover from
// (a playtest, 2026-10-03: bots that fought on sight brought fifty
// champions down to a handful in two minutes): champions on the Wanderseed
// carry two fifths more health than in the 5v5, and out of combat, inside
// the light, a share of the maximum health comes back every second. Much
// more health made a fresh duel last over a minute. A quarter more left a
// Respawn stand-in a median life of 14 s; two fifths more, 18 s (31 s for
// the lives begun before 6:00), with a post-calm duel at 16.5 s (the
// report and scripts/royale_duel.ts, 2026-10-04).
export const ROYALE_HP_SCALE = 1.4;
export const OUT_OF_COMBAT_HEAL = 0.04;
// A takedown's heal and mana fall off with the killer's streak: the share
// is 1 / (1 + STREAK_FALLOFF * (streak - 1)). A fed assassin otherwise came
// out of every kill healed for the next and emptied a match alone.
export const STREAK_FALLOFF = 0.5;
// A launch pad throws a champion this far (chord, meters), over this long.
export const PAD_THROW_M = 50;
export const PAD_FLIGHT_S = 1.6;
// Reach of a pad's center that triggers it.
export const PAD_REACH_M = 1.4;
// A takedown on the Lodestar counts this much (marks.ts markPayout).
export const LEADER_TAKEDOWN_SCORE = 2;
// When the big creatures first rise, seconds after landing, and the
// Warden in Respawn (One life's earlier: content/royale_events.ts
// WARDEN_RISE_AT_S).
export const RING_CREATURES_AT_S = 180;
export const WARDEN_AT_S = 360;
// How long a mark stays shown on everyone's globe after each show: the one
// figure the observation and the snapshot both read (marks.ts).
export const MARK_SHOWN_S = 4;
// How long a Clamor rings out after its takedown: the one figure the
// observation and the snapshot both read (clamors.ts).
export const CLAMOR_S = 3;
// The battle royale's rules as a replay records them (RoyaleReplay.royale.rules):
// the planet's rules move with each tranche of play changes without moving the
// 5v5's REPLAY_VERSION or the content fingerprint, and a royale replay loader
// refuses a record made under other rules. Bumped once per merged tranche.
export const ROYALE_RULES_VERSION = 3;

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

// What a cache is: a plain one, a region's golden one, or what a Seedfall
// leaves (seedfall.ts). Its opening time and reach are read by kind.
export type CacheKind = 'plain' | 'golden' | 'seedfall';

export interface CacheState {
  id: number;
  pos: Vec3;
  kind: CacheKind;
  present: boolean;
  // Respawn: when an opened cache comes back.
  respawnAt: number | null;
  // The champion opening it, or null.
  opener: number | null;
  // With an opener: the start its count implies, so `time - openSince` is
  // the time counted (a held opening's slowed ticks move it later). With no
  // opener: zero, except a Respawn Seedfall's held cache, which keeps here
  // the seconds already counted for the next opener (caches.ts).
  openSince: number;
}

export interface PadSite {
  id: number;
  at: Vec3;
  to: Vec3;
}

export type RoyaleStage = 'drop' | 'play' | 'over';

// A Graft's grade (CONTEXT.md: Graft): raw stats, a changed rule, a changed kit.
export type GraftGrade = 'sprout' | 'bough' | 'heartwood';

// A Graft offered to a seat: three cards of a grade, queued; the head of the
// queue is open until `until` (null while it waits behind another).
export interface GraftOffer {
  grade: GraftGrade;
  cards: string[];
  offeredAt: number;
  until: number | null;
}

// A Seedfall announced (CONTEXT.md: Seedfall): where it falls and when, and
// the cache it left once it landed (null before).
export interface SeedfallState {
  id: number;
  pos: Vec3;
  announcedAt: number;
  landsAt: number;
  landed: boolean;
  cacheId: number | null;
}

// What comes up on the planet (CONTEXT.md: Rising).
export type RisingKind = 'pyrefang' | 'voidmaul' | 'warden';

// A Rising called ahead: where and when, and the body once it stands.
export interface RisingState {
  kind: RisingKind;
  pos: Vec3;
  risesAt: number;
  up: boolean;
  unitId: number | null;
}

// Why a champion is shown to everyone (marks.ts): the Lodestar, an Ablaze
// run, the Wrath's holder, the slayer of a big creature.
export type MarkKind = 'lodestar' | 'ablaze' | 'wrath' | 'slayer';

// A mark: whom, why, the run behind an Ablaze, and the last point shown
// with when; `at` is never updated while the mark is hidden.
export interface MarkState {
  unitId: number;
  kind: MarkKind;
  streak?: number;
  at: Vec3;
  shownAt: number;
}

// A Clamor (CONTEXT.md): where a takedown rang out and when.
export interface ClamorState {
  pos: Vec3;
  at: number;
}

// Respawn's Last light as its events tell it: the heads-up, the double
// takedowns, the final seconds where a death is final.
export type LastLightStep = 'heads_up' | 'double' | 'final';

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
  // What makes a match on the planet a story (Seedfalls, Risings, marks,
  // Grafts, Reprieves, Arrivals), every field public state with its
  // default, so a checkpoint carries it:
  // Seedfalls announced and not yet opened (seedfall.ts).
  seedfalls: SeedfallState[];
  // Risings called ahead and standing (risings.ts).
  risings: RisingState[];
  // Champions shown to everyone (marks.ts).
  marks: MarkState[];
  // Takedowns still ringing out, for CLAMOR_S each (clamors.ts).
  clamors: ClamorState[];
  // Who carries the Wrath on the planet, and until when.
  wrathHolder: { unitId: number; until: number } | null;
  // Graft offers queued per seat, head first (grafts.ts).
  offers: Map<number, GraftOffer[]>;
  // Grafts held per seat, in the order taken.
  grafts: Map<number, string[]>;
  // One life: the seats whose Reprieve is spent.
  reprieveUsed: Set<number>;
  // One life: seconds the Dusk's clock runs ahead of the match's (the
  // Hastening).
  duskOffset: number;
  // Respawn: where a dead or arriving seat picked to come back.
  respawnPicks: Map<number, Vec3>;
  // The champions in their Grace (grace.ts): a drop-in's Arrival or a
  // Respawn return, untouchable until it runs out or they act.
  arriving: Set<number>;
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
  | { type: 'royale_end'; winnerId: number | null }
  // The Seedfalls, Risings, marks, Reprieves, the Hastening, the Last light
  // and the Pad slam, typed and forwarded before any rule emits them
  // (server/royale_snapshot.ts, src/net/royale_client.ts).
  | { type: 'royale_seedfall'; seedfallId: number; at: Vec3; landsAt: number }
  | { type: 'royale_seedfall_land'; seedfallId: number; at: Vec3 }
  | { type: 'royale_rising'; kind: RisingKind; at: Vec3; risesAt: number }
  | { type: 'royale_wrath_passed'; from: number; to: number | null }
  | { type: 'royale_mark'; unitId: number; kind: MarkKind }
  | { type: 'royale_snuffed'; unitId: number; killerId: number; streak: number }
  | { type: 'royale_reprieve'; unitId: number; backAt: number }
  | { type: 'royale_dusk_hastens'; by: number; alive: number }
  | { type: 'royale_last_light'; step: LastLightStep }
  | { type: 'royale_pad_slam'; unitId: number; at: Vec3; hit: number[] };
