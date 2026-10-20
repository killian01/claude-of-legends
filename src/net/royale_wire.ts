// The battle royale on the wire (ADR 0031): what a snapshot carries of the
// mode, what a player sends for it. The positions themselves ride the usual
// unit, projectile and zone records with a y beside x and z on the sphere
// (src/sim/geo.ts). Types only; protocol.ts embeds them.

import type { GoalShape } from '../sim/content/bouts/types';
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

// The recipient's own Burr (CONTEXT.md: Burr; src/sim/royale/burr.ts): the
// carrier's unit id, when the Burr runs out, and where the carrier stands
// while it stands (absent while it is dead).
export interface SnapBurr {
  i: number;
  u: number;
  at?: WirePoint;
}

// A Clamor: where a takedown rang out, and when.
export type SnapClamor = [number, number, number, number];

// A champion in its Grace: its unit id, when the Grace runs out, where it
// stands, and for a Grace that waits on the seat's first order (a Respawn
// Arrival's, src/sim/royale/grace.ts) from when an order ends it.
export type SnapGrace = [number, number, number, number, number, number?];

// The killer a fallen Respawn seat watches through its wait (the Death
// beat, src/game/death_beat.ts): a dead champion sees nothing, so the
// mirror draws the killer from this alone. Its unit id, champion, skin and
// team, where it stands, and its health and maximum for the bar.
export interface SnapWatch {
  i: number;
  c: string;
  sk: number;
  t: number;
  at: WirePoint;
  h: number;
  m: number;
}

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
  // once a second: the drop shows where the others mean to land; in Crews
  // the other crews' here and the recipient's crewmates' in `cp`.
  picks?: WirePoint[];
  cp?: WirePoint[];
  // Crews only (ADR 0034), every snapshot: the crews still in (One life)
  // or in the match (Respawn), and the takedowns the recipient's crew
  // scored. In Crews `place`, `rk` and `gap` are the crew's, among crews.
  cw?: { n: number; s: number };
  // Respawn: where the recipient picked to come back, while dead and once
  // picked (src/sim/royale/return_pick.ts); absent otherwise.
  bk?: WirePoint;
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
  // Respawn: the recipient's own Burr while it lasts, every snapshot, so
  // its absence says none does (the mirror keeps nothing between sends).
  bu?: SnapBurr;
  // Respawn: the recipient's rank and how far behind the seat above it.
  rk?: number;
  gap?: number;
  // 1: rk and gap count since the recipient landed (a drop-in's window,
  // server/royale_ranking.ts windowStanding). The three are sent from the
  // recipient's first takedown since landing.
  rs?: 1;
  // One life: when the recipient's Reprieve brings them back, while pending.
  rp?: number;
  // The champions in their Grace the recipient sees, itself included (a
  // drop-in's Arrival, a Respawn return; src/sim/royale/grace.ts): each
  // [unit id, when it runs out, x, y, z, and for a Respawn Arrival's from
  // when an order ends it]; absent when none. Sent every snapshot while any
  // is graced.
  ar?: SnapGrace[];
  // Respawn: the champion that took the recipient down, through the wait
  // (CONTEXT.md: Death beat), while it stands; absent otherwise.
  wa?: SnapWatch;
  // A Thornfray's bout (ADR 0035): the recipient's count and place, the
  // best count and the goals, sent when they change (the client keeps the
  // last), each bout starting over; absent in a battle royale.
  tf?: SnapBout;
}

// A goal primitive of a bout (ADR 0035; src/net/goal_wire.ts): its shape,
// where it stands, its radius, and the unit id of the champion holding it
// (null for none).
export type SnapGoal = [GoalShape, number, number, number, number, number | null];

// A Thornfray's bout in the recipient's snapshot: their own count and
// their place as the bout stands, the best count, and the kind's goals
// (absent when it stands none). The HUD's top line reads it; nothing in it
// is hidden from anyone (ObsRoyale.bout reads the same numbers).
export interface SnapBout {
  c: number;
  pl: number;
  bc: number;
  g?: SnapGoal[];
}

// One seat of a Thornfray's table (CONTEXT.md: Bushel): its seat index,
// its champion's unit id in this bout, the name it plays under, its
// champion, whether a bot (1) or a person (0) holds it now, its bushels,
// the bushels the last bout paid it, and the bouts it won.
export type BoutTableRow = [number, number, string, string, 0 | 1, number, number, number];

// A Thornfray's bout at its match_start, and again on a rejoin (ADR 0035):
// the bout's index (0 the first, 5 the Final), the six kinds in order, the
// recipient's seat, the table best first, and the seat offered a prize
// this bout (the last bout's winner; absent in the first).
export interface BoutStart {
  b: number;
  k: string[];
  s: number;
  t: BoutTableRow[];
  p?: number;
}

// A Thornfray gathering for the people in it (ADR 0035): how many people
// are in, of how many seats, the seconds until it starts, and whether the
// recipient holds Start now (its opener).
export interface ThornfrayGather {
  t: 'thornfray_gather';
  people: number;
  of: number;
  startsIn: number;
  opener: boolean;
}

// One seat at a Thornfray's end: its seat index, name, champion, a bot (1)
// or a person (0), its bushels and the bouts it won.
export type ThornfrayEndRow = [number, string, string, 0 | 1, number, number];

// Sent to each person still in a Thornfray when its Final ends: their
// place of the seats, their seat, bushels and bouts won, the ladder points
// they banked over the match, the table best first, their seat bout by
// bout (the kind, its place, the bushels it paid), and the bouts' replay
// ids in order.
export interface ThornfrayResult {
  t: 'thornfray_result';
  place: number;
  of: number;
  seat: number;
  bushels: number;
  won: number;
  points: number;
  table: ThornfrayEndRow[];
  bouts: { k: string; pl: number; paid: number }[];
  replays: number[];
}

// What a player sends for a Thornfray: entering one with the quick pick's
// champion, skin and sigils (a gathering, a held seat, or a late seat at
// the second Lull), and the gathering's Start now, its opener's.
export type ThornfrayClientMsg =
  | {
      t: 'thornfray';
      championId: string;
      sigils: [string, string];
      skin?: number;
    }
  | { t: 'thornfray_start' };

// Sent to each person when their match ends or they are out for good.
export interface RoyaleResult {
  t: 'royale_result';
  v: RoyaleVariant;
  place: number;
  of: number;
  score: number;
  winner: string | null;
  // The top of the final ranking: name, champion, takedowns, bot or not;
  // in Crews (ADR 0034) whole crews, each row with its crew's place.
  top: { name: string; championId: string; score: number; bot: boolean; cr?: number }[];
  // Crews only: the place and `of` above are the recipient's crew's, out
  // of the crews. The crew's takedowns, its other champions in rank order,
  // and the names of the winning crew, its best first.
  crew?: {
    size: 3 | 5;
    score: number;
    mates: { name: string; championId: string; score: number; bot: boolean }[];
    winners: string[];
    // The winning crew's takedowns.
    winnerScore: number;
  };
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
  // The near miss: the seat just above (since the recipient landed when
  // they dropped in, else in the whole match), and by how many takedowns,
  // when that is one or two (Respawn).
  gap?: { name: string; by: number };
  // The winner's health share at the end (One life).
  winnerHp?: number;
  // Respawn: the standing since the recipient landed (a drop-in's window).
  window?: { rank: number; of: number; score: number };
  // Respawn: seconds since the recipient landed (a drop-in's Arrival, else
  // the drop's end).
  held?: number;
  // The ranking around the recipient: the podium and their own row with
  // two above and two below, people first.
  slice?: { place: number; name: string; championId: string; score: number; bot: boolean }[];
  // Respawn: the best the recipient's line held before this match (ADR
  // 0033), the most takedowns one seat scored, counted since landing for a
  // drop-in; 0 before the first. Absent when the line is gone or the
  // server is older.
  bestBefore?: number;
}

// What a player sends for the mode.
export type RoyaleClientMsg =
  // Enter a battle royale: joins a running match when one takes people
  // (ADR 0025's drop in), else starts one at once; `c` the crew size,
  // Trios or Fives (ADR 0034), Solo when absent.
  | {
      t: 'royale';
      v: RoyaleVariant;
      championId: string;
      sigils: [string, string];
      skin?: number;
      c?: 3 | 5;
    }
  // The landing point picked during the drop; in Respawn, while dead, the
  // point picked to come back at.
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
