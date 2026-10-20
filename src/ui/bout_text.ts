// What a Thornfray's HUD says over a bout (CONTEXT.md: Thornfray, Bout,
// Final, Bushel; ADR 0035; docs/design/thornfray.md, The HUD and the
// phone): the top line's count ("Lastwick · 0:41 · 5 left", "Starglean ·
// 0:48 · 7 gleaned, 2nd"), the win line under it ("Most gleaned wins · Bout
// 3 of 6"), the bushels chip in the leader badge's slot ("17 bushels ·
// 2nd"), the Final's x2 pill, the bout's end beat at the next Lull
// ("LASTWICK · Wren"), and the words of the gathering and the quick pick.
// Pure: the HUD hands in the bout's kind, the table the bout started with
// (BoutStart, the match_start's tf) and the snapshot's mode block with its
// tf line, and draws what this answers (ui/royale_hud.ts).

import type { BoutStart, SnapBout, SnapRoyale } from '../net/royale_wire';
import { BOUT_SEATS, BOUTS, FINAL_FACTOR } from '../sim/content/bouts/match';
import type { BoutKind } from '../sim/content/bouts/types';
import { clockText, ordinal } from './royale_text';

// The mode's name and what it is, for the quick pick and the gathering,
// under the planet it is played on.
export const THORNFRAY_LABEL = 'Wanderseed';
export const THORNFRAY_TITLE = 'Thornfray';
export const THORNFRAY_LINE =
  'Eight champions, six short bouts, each to a rule of its own. Places pay bushels; the Final ' +
  'pays double, and the most bushels wins.';
// What its button says where it has one of its own: the landing's way in
// and the home's tile (ui/landing_modes.ts, ui/royale_tiles.ts).
export const THORNFRAY_CALL = 'Play Thornfray';

// Whether a bout is the Final (the sixth, every place paying double).
export function isFinal(b: number): boolean {
  return b === BOUTS - 1;
}

// "Bout 3 of 6", counted from one.
export function boutOfText(b: number): string {
  return `Bout ${b + 1} of ${BOUTS}`;
}

// A count as the top line shows it: whole, or to a tenth for a count of
// seconds held.
export function countText(c: number): string {
  const n = Math.max(0, c);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// The seconds a bout has left on the top line: to its clock, or to the
// light going out when that comes first (Lastwick's clock stands past the
// dark as a backstop), from the landing (`de`).
export function boutClockLeft(
  kind: Pick<BoutKind, 'playS' | 'dusk'>,
  r: Pick<SnapRoyale, 'de'>,
  time: number,
): number {
  return Math.max(0, r.de + Math.min(kind.playS, kind.dusk.lightOutS) - time);
}

// The count's part of the top line: those still standing for a kind whose
// count reads as a place ("5 left"), else the seat's own count and its
// place ("7 gleaned, 2nd"). On a phone (`compact`) a number drops its word
// ("7, 2nd"), so the line keeps inside the top line's box.
export function boutCount(
  kind: Pick<BoutKind, 'hud'>,
  r: Pick<SnapRoyale, 'alive'> & { tf?: SnapBout },
  compact = false,
): string {
  if (kind.hud.place) return `${r.alive} ${kind.hud.word}`;
  const tf = r.tf;
  if (!tf) return compact ? '0' : `0 ${kind.hud.word}`;
  const c = countText(tf.c);
  const place = tf.pl > 0 ? `, ${ordinal(tf.pl)}` : '';
  return compact ? `${c}${place}` : `${c} ${kind.hud.word}${place}`;
}

// The top line's count in a bout: during the Lull the bout's name and
// number ("Starglean · Bout 3 of 6", "Lastwick · the Final"), then its
// name, its clock and its count. On a phone the row beside the Dusk's line
// holds the clock and the count alone ("0:48 · 7, 2nd"): the closing Dusk's
// line and the name ran past the top line's box (COMPACT_TOP_LINE_HALF_W_PX),
// and the win line under it says the bout's rule.
export function boutTopLine(
  kind: Pick<BoutKind, 'name' | 'hud' | 'playS' | 'dusk'>,
  b: number,
  r: Pick<SnapRoyale, 'st' | 'de' | 'alive'> & { tf?: SnapBout },
  time: number,
  compact = false,
): string {
  if (r.st === 'drop') return `${kind.name} · ${isFinal(b) ? 'the Final' : boutOfText(b)}`;
  const clock = clockText(boutClockLeft(kind, r, time));
  const count = `${clock} · ${boutCount(kind, r, compact)}`;
  return compact ? count : `${kind.name} · ${count}`;
}

// The win line in a bout: the rule and the bout's number, "Most gleaned
// wins · Bout 3 of 6", and in the Final "· the Final" after it; nothing
// during the Lull, whose card says it. On a phone, where the row holds the
// Dusk's pill or the bushels chip beside it, the number short ("Most
// gleaned wins · 3 of 6") and the Final named alone.
export function boutWinLine(
  kind: Pick<BoutKind, 'rule'>,
  b: number,
  r: Pick<SnapRoyale, 'st'>,
  compact = false,
): string | null {
  if (r.st !== 'play') return null;
  if (compact) return `${kind.rule} · ${isFinal(b) ? 'the Final' : `${b + 1} of ${BOUTS}`}`;
  if (!isFinal(b)) return `${kind.rule} · ${boutOfText(b)}`;
  return `${kind.rule} · ${boutOfText(b)} · the Final`;
}

// The x2 pill beside the count in the Final: every place pays double.
export function finalBadge(b: number): string | null {
  return isFinal(b) ? `x${FINAL_FACTOR}` : null;
}

export function bushelsText(n: number): string {
  return n === 1 ? '1 bushel' : `${n} bushels`;
}

// The seat's own row of the table a bout started with, and its place on it
// (the table is best first); null when the seat is not on it.
export function ownStanding(start: BoutStart): { bushels: number; place: number } | null {
  const i = start.t.findIndex((row) => row[0] === start.s);
  if (i < 0) return null;
  return { bushels: start.t[i]![5], place: i + 1 };
}

// The bushels chip in the leader badge's slot: "17 bushels · 2nd".
export function bushelsChip(start: BoutStart): string | null {
  const own = ownStanding(start);
  return own ? `${bushelsText(own.bushels)} · ${ordinal(own.place)}` : null;
}

// The last bout's winner, read from the table the next bout starts with:
// the seat offered the prize (p), its name and the kind it won. Null in
// the first bout, or when the table does not name it.
export function lastWinner(
  start: BoutStart,
  kindName: (id: string) => string | null,
): { seat: number; name: string; kind: string; self: boolean } | null {
  if (start.b <= 0 || start.p === undefined) return null;
  const row = start.t.find((r) => r[0] === start.p);
  const id = start.k[start.b - 1];
  const kind = id !== undefined ? kindName(id) : null;
  if (!row || kind === null) return null;
  return { seat: row[0], name: row[2], kind, self: row[0] === start.s };
}

// The bout's end beat, said in the spotlight at the start of the next
// Lull: the kind, then who took it, "LASTWICK · Wren" ("LASTWICK · You").
export function endBeatText(winner: { name: string; kind: string; self: boolean }): string {
  return `${winner.kind.toUpperCase()} · ${winner.self ? 'You' : winner.name}`;
}

// How long the end beat holds the Lull before its card, seconds.
export const END_BEAT_S = 2;

// The wash over a champion out of a One life bout: out until the next
// bout, and where it placed once the server says, "6th of 8".
export function boutOutLine(place: number | undefined, final: boolean): string {
  const next = final ? 'Out of the Final' : 'Out until the next bout';
  return place ? `${next} · ${ordinal(place)} of ${BOUT_SEATS}` : next;
}

// The gathering's card: "2 of 8 people · starts in 14 s".
export function gatherLine(people: number, of: number, startsIn: number): string {
  const who = people === 1 ? `1 of ${of} people` : `${people} of ${of} people`;
  return `${who} · starts in ${Math.max(0, Math.ceil(startsIn))} s`;
}

// What the gathering's card says under its line: bots fill the seats.
export const GATHER_FILL = 'House bots take the seats nobody does.';
