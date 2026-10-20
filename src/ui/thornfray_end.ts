// A Thornfray's end screen, decided (CONTEXT.md: Thornfray, Bushel; ADR
// 0035; docs/design/thornfray.md, The end): built from the result the
// server sends each person still in after the Final (ThornfrayResult). The
// place ("2nd of 8", or the win), the bushels and the bouts won, the ladder
// points the match banked, and the table: every seat's place, champion,
// name with a bot mark, bushels and bouts won; on a desktop the person's
// seat bout by bout ("Lastwick 1st +5"). Its three ways on: Play again (a
// new gathering with the same pick), Battle royale (the Respawn quick
// pick), Home. Pure; ui/royale_hud.ts draws it on the battle royale's end
// screen (ui/end_screen.ts, the 'royale' card of ui/end_layout.ts).

import type { ThornfrayResult } from '../net/royale_wire';
import { bushelsText, THORNFRAY_TITLE } from './bout_text';
import { ordinal, placeText } from './royale_text';

export interface ThornfrayEndRow {
  place: number;
  name: string;
  championId: string;
  bushels: number;
  won: number;
  bot: boolean;
  self: boolean;
}

export interface ThornfrayEndModel {
  kicker: string;
  title: string;
  won: boolean;
  lines: string[];
  heading: string;
  rows: ThornfrayEndRow[];
  // The person's seat bout by bout, "Lastwick 1st +5"; a desktop's.
  bouts: string[];
  again: string;
  againNote: string | null;
  other: string;
  home: string;
}

export function boutsWonText(n: number): string {
  return n === 1 ? '1 bout won' : `${n} bouts won`;
}

// One bout of the person's seat: its number, its kind's name, its place
// and what it paid, "2. Starglean 4th +2".
export function boutLine(n: number, name: string, place: number, paid: number): string {
  return `${n}. ${name} ${place > 0 ? ordinal(place) : '-'} +${Math.max(0, paid)}`;
}

export function thornfrayEnd(
  r: ThornfrayResult,
  kindName: (id: string) => string | null,
): ThornfrayEndModel {
  const won = r.place === 1;
  const rows: ThornfrayEndRow[] = r.table.map((row, i) => ({
    place: i + 1,
    name: row[1],
    championId: row[2],
    bot: row[3] === 1,
    bushels: row[4],
    won: row[5],
    self: row[0] === r.seat,
  }));
  const lines = [`${bushelsText(r.bushels)} · ${boutsWonText(r.won)}`];
  if (!won) {
    const first = rows[0];
    if (first) lines.push(`${first.name} takes the Thornfray, ${bushelsText(first.bushels)}.`);
  }
  if (r.points > 0) lines.push(`+${r.points} ladder points this match`);
  return {
    kicker: `${THORNFRAY_TITLE} · six bouts`,
    title: won ? 'Thornfray won' : `You placed ${placeText(r.place, r.of)}`,
    won,
    lines,
    heading: 'The table',
    rows,
    bouts: r.bouts.map((b, i) => boutLine(i + 1, kindName(b.k) ?? b.k, b.pl, b.paid)),
    again: 'Play again',
    againNote: null,
    other: 'Battle royale',
    home: 'Back home',
  };
}
