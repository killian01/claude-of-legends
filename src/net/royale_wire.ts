// The battle royale on the wire (ADR 0031): what a snapshot carries of the
// mode, what a player sends for it. The positions themselves ride the usual
// unit, projectile and zone records with a y beside x and z on the sphere
// (src/sim/geo.ts). Types only; protocol.ts embeds them.

import type {
  GraftGrade,
  MarkKind,
  RisingKind,
  RoyaleStage,
  RoyaleVariant,
} from '../sim/royale/types';

export type {
  GraftGrade,
  LastLightStep,
  MarkKind,
  RisingKind,
  RoyaleStage,
  RoyaleVariant,
} from '../sim/royale/types';

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

// A cache still standing: id, position, and its kind: 0 plain, 1 golden,
// 2 a Seedfall's (CacheKind).
export type SnapCache = [number, number, number, number, 0 | 1 | 2];

// A Seedfall announced and not yet opened: id, where it falls, when it
// lands, and whether it has (1) or not (0).
export type SnapSeedfall = [number, number, number, number, number, 0 | 1];

// A Rising: what, where, when it rises, up (1) or called (0), and the
// standing body's health as a share.
export type SnapRising = [RisingKind, number, number, number, number, 0 | 1, number];

// A mark shown to everyone: the champion, why, the last point shown, and
// when it was shown.
export type SnapMark = [number, MarkKind, number, number, number, number];

// A Clamor: where a takedown rang out, and when.
export type SnapClamor = [number, number, number, number];

// A champion in its Grace: its unit id, when the Grace runs out, and where
// it stands.
export type SnapGrace = [number, number, number, number, number];

// The recipient's own open Graft offer: its grade, the three cards, and
// when card 0 is taken for them.
export interface SnapGraftOffer {
  g: GraftGrade;
  c: [string, string, string];
  // When it was offered (it stays open until the pick): with the cards,
  // what tells one offer from the next.
  u: number;
}

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
  // The recipient's own cache being opened: its id and since when, and how
  // long it takes when that is not CACHE_OPEN_S.
  opening?: { c: number; since: number; d?: number };
  // The recipient's own landing pick during the drop.
  drop?: WirePoint;
  // Everyone else's landing picks during the drop, sent with the caches
  // once a second: the drop shows where the others mean to land.
  picks?: WirePoint[];
  // Optional blocks, absent until their rules ship
  // (server/royale_snapshot_blocks.ts builds each one):
  // The recipient's open Graft offer, and the Grafts they hold.
  offer?: SnapGraftOffer;
  gr?: string[];
  // The Seedfalls, the Risings, the marks and the Clamors: sent when they
  // change (and the Seedfalls once a second), the client keeping the last
  // of each between sends (src/net/client_world.ts).
  sf?: SnapSeedfall[];
  ri?: SnapRising[];
  mk?: SnapMark[];
  cl?: SnapClamor[];
  // Respawn: the recipient's rank and how far behind the seat above it.
  rk?: number;
  gap?: number;
  // One life: when the recipient's Reprieve brings them back, while pending.
  rp?: number;
  // The champions in their Grace the recipient sees, itself included (a
  // drop-in's Arrival, a Respawn return; src/sim/royale/grace.ts): each
  // [unit id, when it runs out, x, y, z]; absent when none. Sent every
  // snapshot while any is graced.
  ar?: SnapGrace[];
  // Respawn's Last light: 1 once a death is final.
  fi?: 1;
  // The champion the recipient watches once out, when not their own.
  wa?: number;
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
  // Optional fields, absent until their rules ship (the end card reads them
  // tolerantly): seconds lived, the best run of takedowns without dying,
  // caches and Seedfall caches opened, big creatures slain, seconds holding
  // the Wrath, the Grafts taken, the runs snuffed out.
  lived?: number;
  bestRun?: number;
  caches?: number;
  seedfalls?: number;
  creatures?: number;
  wrathS?: number;
  grafts?: string[];
  shutdowns?: number;
  // Who took the recipient down, as the Death beat shows them.
  killer?: {
    name: string;
    championId: string;
    level: number;
    hp: number;
    heartwood?: string;
    bot?: boolean;
  };
  // The near miss: the seat just above, and by how much.
  gap?: { name: string; by: number };
  // The winner's health share at the end (One life).
  winnerHp?: number;
  // Respawn: the standing since the recipient landed (a drop-in's window).
  window?: { rank: number; of: number; score: number };
  // The ranking around the recipient: the podium and their own row with
  // two above and two below, people first.
  slice?: { place: number; name: string; championId: string; score: number; bot: boolean }[];
}

// What a player sends for the mode.
export type RoyaleClientMsg =
  // Enter a battle royale: joins a running match when one takes people
  // (ADR 0025's drop in), else starts one at once.
  | { t: 'royale'; v: RoyaleVariant; championId: string; sigils: [string, string]; skin?: number }
  // The landing point picked during the drop.
  | { t: 'drop'; x: number; y: number; z: number }
  // A card of the open Graft offer.
  | { t: 'graft'; pick: number }
  // Once out: the next survivor to watch.
  | { t: 'watch'; next?: boolean };

// The mode as the online mirror keeps it (src/net/client_world.ts,
// IWorld.royale): the last snapshot's block, with the last caches list
// and, during the drop, everyone else's last picks, which the block only
// carries once a second.
export type RoyaleView = SnapRoyale & { caches: SnapCache[] };

// Who holds a champion's seat in a battle royale: the name the seat plays
// under (a person's, or a bot's invented one) and the bot mark.
export interface SeatLabel {
  name: string;
  bot: boolean;
}
