// The Lull's card (CONTEXT.md: Lull, Bushel; docs/design/thornfray.md, The
// Lull, The HUD and the phone): the ten seconds over the globe before each
// bout, the next bout's drop. Its head says which bout, its rule and when
// it lands ("Bout 3 of 6 · Starglean", "Most gleaned wins", "Lands in 7");
// its table the seats in order of bushels, each with its place, champion,
// name (a bot with its mark), what the last bout paid it ("+4") and its
// total, all eight on a desktop and five on a phone (the top three, then
// the seat above the person's and the person's own; the 4th and 5th when
// the person is in the top four); its foot the prize ("Wren took Lastwick
// and picks a Graft") and what a tap on the globe does. The Final says it
// pays double. From the second Lull its first two seconds are the last
// bout's end beat (bout_text.ts END_BEAT_S), and the card comes after.
//
// And where it stands, as boxes a test checks (tests/lull_room.test.ts): on
// a phone inside the free column the Respawn wait already keeps
// (ui/royale_return.ts returnWashPhoneBox), right of the thumbs' bar and
// left of the globe, above the notices and the touch bar; on a desktop at
// the left, left of the globe, the top line and the announcements. While
// the prize winner's Graft cards are open it folds to its head's first row,
// above the cards' title. Pure; ui/lull_view.ts draws it.

import type { BoutStart, SnapRoyale } from '../net/royale_wire';
import { BOUTS } from '../sim/content/bouts/match';
import type { BoutKind } from '../sim/content/bouts/types';
import { boutOfText, END_BEAT_S, isFinal, lastWinner } from './bout_text';
import { cardsCoverBox } from './royale_grafts';
import { announceBox, type ScreenBox, topLineBox } from './royale_layout';
import { returnWashColumnPx, returnWashPhoneBox } from './royale_return';

export interface LullRow {
  place: number;
  seat: number;
  name: string;
  championId: string;
  bot: boolean;
  bushels: number;
  // What the last bout paid the seat ("+4"), null before the first bout.
  last: number | null;
  won: number;
  self: boolean;
}

export interface LullModel {
  // "Bout 3 of 6 · Starglean", "The Final · Lastwick".
  title: string;
  // The kind's rule in one line.
  rule: string;
  // The Final's line, "The Final: every place pays double"; null before it.
  final: string | null;
  // "Lands in 7"; on a phone "7 s".
  clock: string;
  rows: LullRow[];
  // "Wren took Lastwick and picks a Graft", "You took Lastwick: pick your
  // Graft"; on a phone "Wren picks a Graft", "Pick your Graft"; null when
  // no prize is offered (the first Lull).
  prize: string | null;
  // What a tap or a click on the globe does.
  ask: string;
}

export const FINAL_LINE = 'The Final: every place pays double';

// The rows a phone keeps of the eight, by place: the top five when the
// person is in it, else the top three, the seat above the person's and
// their own.
export const PHONE_ROWS = 5;

export function phoneRows<T extends { place: number; self: boolean }>(rows: readonly T[]): T[] {
  const own = rows.find((r) => r.self);
  if (!own || own.place <= PHONE_ROWS) return rows.slice(0, PHONE_ROWS);
  return rows.filter((r) => r.place <= 3 || r.place === own.place - 1 || r.place === own.place);
}

// What a tap or a click on the globe does in the Lull: the drop's own ask.
export function lullAsk(touch: boolean, picked: boolean): string {
  const verb = touch ? 'Tap' : 'Click';
  return picked
    ? `Landing picked: ${verb.toLowerCase()} to change it`
    : `${verb} the globe to land`;
}

// The prize line: the last bout's winner picks a Graft over this Lull.
export function prizeLine(
  winner: { name: string; kind: string; self: boolean },
  compact: boolean,
): string {
  if (compact) return winner.self ? 'Pick your Graft' : `${winner.name} picks a Graft`;
  return winner.self
    ? `You took ${winner.kind}: pick your Graft`
    : `${winner.name} took ${winner.kind} and picks a Graft`;
}

export function lullModel(
  start: BoutStart,
  kind: Pick<BoutKind, 'name' | 'rule'>,
  r: Pick<SnapRoyale, 'de' | 'drop'>,
  time: number,
  options: { touch: boolean; compact: boolean; kindName: (id: string) => string | null },
): LullModel {
  const b = start.b;
  const final = isFinal(b);
  const rows: LullRow[] = start.t.map((row, i) => ({
    place: i + 1,
    seat: row[0],
    name: row[2],
    championId: row[3],
    bot: row[4] === 1,
    bushels: row[5],
    last: b > 0 ? row[6] : null,
    won: row[7],
    self: row[0] === start.s,
  }));
  const winner = lastWinner(start, options.kindName);
  const prize = winner ? prizeLine(winner, options.compact) : null;
  const left = Math.max(0, Math.ceil(r.de - time));
  return {
    title: final ? `The Final · ${kind.name}` : `${boutOfText(b)} · ${kind.name}`,
    rule: kind.rule,
    final: final ? FINAL_LINE : null,
    clock: options.compact ? `${left} s` : `Lands in ${left}`,
    rows: options.compact ? phoneRows(rows) : rows,
    prize,
    ask: lullAsk(options.touch, r.drop !== undefined),
  };
}

// Whether the card stands now: through the Lull (the bout's drop), after
// the end beat from the second Lull on.
export function lullUp(start: BoutStart, r: Pick<SnapRoyale, 'st'>, time: number): boolean {
  if (r.st !== 'drop') return false;
  return start.b === 0 || time >= END_BEAT_S;
}

// Whether the Lull opens on the end beat: from the second, in its first
// seconds.
export function endBeatDue(start: BoutStart, r: Pick<SnapRoyale, 'st'>, time: number): boolean {
  return start.b > 0 && start.b < BOUTS && r.st === 'drop' && time < END_BEAT_S;
}

// The card's sizes, at interface size 1. A phone: a 40 px head (its title
// row of LULL_PHONE_TITLE_PX, the rule's), five rows of 22 px and an 18 px
// foot, 168 px in all; a desktop: a head of 40 px, eight rows of 25 px, the
// prize on up to two lines and the ask; in the Final its line stands in
// the head and the ask goes, the card no taller.
export const LULL_PHONE_HEAD_PX = 40;
export const LULL_PHONE_TITLE_PX = 16;
export const LULL_PHONE_ROW_PX = 22;
export const LULL_PHONE_FOOT_PX = 18;
export const LULL_PHONE_MARGIN_PX = 12;
export const LULL_DESK_LEFT_PX = 12;
export const LULL_DESK_TOP_PX = 52;
export const LULL_DESK_W_PX = 300;
export const LULL_DESK_PAD_PX = 10;
export const LULL_DESK_TITLE_PX = 22;
export const LULL_DESK_LINE_PX = 18;
export const LULL_DESK_ROW_PX = 25;
export const LULL_DESK_GAP_PX = 6;
// What the card keeps clear of its neighbors on a desktop: the top line
// and the announcements to its right.
export const LULL_DESK_CLEAR_PX = 8;

// The card's border, each side.
export const LULL_BORDER_PX = 1;

export function lullPhoneHeight(): number {
  return (
    LULL_PHONE_HEAD_PX + PHONE_ROWS * LULL_PHONE_ROW_PX + LULL_PHONE_FOOT_PX + 2 * LULL_BORDER_PX
  );
}

export function lullDeskHeight(final: boolean): number {
  // The Final's line in the head, the ask's line out of the foot.
  const head = LULL_DESK_TITLE_PX + LULL_DESK_LINE_PX + (final ? LULL_DESK_LINE_PX : 0);
  const foot = 2 * LULL_DESK_LINE_PX + (final ? 0 : LULL_DESK_LINE_PX);
  return (
    2 * LULL_BORDER_PX +
    2 * LULL_DESK_PAD_PX +
    head +
    LULL_DESK_GAP_PX +
    8 * LULL_DESK_ROW_PX +
    LULL_DESK_GAP_PX +
    foot
  );
}

// The desktop card's right edge: left of the globe's column, of the top
// line and of the announcements' band, never wider than LULL_DESK_W_PX.
export function lullDeskRight(width: number, height: number): number {
  return Math.min(
    LULL_DESK_LEFT_PX + LULL_DESK_W_PX,
    returnWashColumnPx(width, height),
    topLineBox(width, false).left - LULL_DESK_CLEAR_PX,
    announceBox(width).left - LULL_DESK_CLEAR_PX,
  );
}

// The card's box on a screen `width` by `height`: on a phone (`compact`)
// past the thumbs' bar when it stands at the left (`barLeft`), `folded`
// while the Graft cards are open.
export function lullBox(
  width: number,
  height: number,
  compact: boolean,
  options: { barLeft?: boolean; folded?: boolean; final?: boolean } = {},
): ScreenBox {
  if (compact) {
    const col = returnWashPhoneBox(width, height, options.barLeft === true);
    const left = Math.max(col.left, LULL_PHONE_MARGIN_PX);
    const h = options.folded ? LULL_PHONE_TITLE_PX + 2 * LULL_BORDER_PX : lullPhoneHeight();
    return { left, top: col.top, right: col.right, bottom: col.top + h };
  }
  const right = lullDeskRight(width, height);
  const h = options.folded
    ? 2 * (LULL_BORDER_PX + LULL_DESK_PAD_PX) + LULL_DESK_TITLE_PX
    : lullDeskHeight(options.final === true);
  return { left: LULL_DESK_LEFT_PX, top: LULL_DESK_TOP_PX, right, bottom: LULL_DESK_TOP_PX + h };
}

// Whether the folded card keeps above the open Graft cards.
export function lullClearOfCards(width: number, height: number, compact: boolean): boolean {
  const folded = lullBox(width, height, compact, { folded: true, barLeft: true });
  return folded.bottom <= cardsCoverBox(width, compact).top;
}
