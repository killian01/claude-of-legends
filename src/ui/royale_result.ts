// The battle royale's end screen, decided (ADR 0031): what it says once a
// person is out for good or the match is over, built from the result the
// server sends them (RoyaleResult, src/net/royale_wire.ts). The place,
// the takedowns, who won, the top of the ranking with a bot mark on every
// bot, and the three ways on: the same rule set again, the other one, and
// home. Respawn counts a drop-in from their landing, says how close the
// seat above was and the best this browser kept; and what the end plays
// (royaleSting). Pure; ui/royale_hud.ts draws it.

import type { RoyaleResult } from '../net/royale_wire';
import type { GoalModel } from './royale_goal';
import { graftNames } from './royale_grafts';
import { otherVariant, royaleMode } from './royale_modes';
import { assistsText, clockText, ordinal, placeText, takedownsText } from './royale_text';

// One life shows its top five; Respawn its final ranking, this far down.
export const ONE_LIFE_TOP = 5;
export const RESPAWN_TOP = 10;

export interface RoyaleEndRow {
  place: number;
  name: string;
  championId: string;
  score: number;
  bot: boolean;
  // The viewer's own line, when it is among the rows.
  self: boolean;
}

export interface RoyaleEndModel {
  title: string;
  // Gold for a win, plain otherwise.
  won: boolean;
  // Under the title: the place when the title does not say it, the
  // takedowns, and who won; Respawn's also the time held, the near miss,
  // the best and a drop-in's whole-match place.
  lines: string[];
  heading: string;
  rows: RoyaleEndRow[];
  // The Grafts taken this match, in order (CONTEXT.md: Graft); null for
  // none.
  grafts: string | null;
  // Respawn's goal across matches (ui/royale_goal.ts): the bar from the
  // last level to the next; null in One life or when the seat banks no
  // points.
  goal: GoalModel | null;
  again: string;
  other: string;
  home: string;
}

// What the card reads off this screen rather than the result: the own
// scoreboard row's assists, the best Respawn tally this browser kept
// before this match (game/settings.ts royaleBest; 0 before the first), and
// the goal the browser climbs with the points the seat banked (absent when
// it banks none).
export interface RoyaleEndMine {
  assists: number;
  best: number;
  goal?: GoalModel | null;
}

const whole = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;

// The standing since the recipient landed, when the result carries a
// readable one (an older server sends none).
function windowOf(r: RoyaleResult): { rank: number; of: number; score: number } | null {
  const w = r.window as Partial<Record<'rank' | 'of' | 'score', unknown>> | undefined;
  if (typeof w !== 'object' || w === null) return null;
  const rank = whole(w.rank);
  const of = whole(w.of);
  const score = whole(w.score);
  return rank !== null && rank >= 1 && of !== null && score !== null ? { rank, of, score } : null;
}

// The seat's tally as the card counts it: since landing for a drop-in.
export function respawnTally(r: RoyaleResult): number {
  return windowOf(r)?.score ?? r.score;
}

// Respawn's lines, in order: what the seat did and in how long, the near
// miss, the best this browser kept, who won, and for a drop-in the whole
// match's place.
function respawnLines(r: RoyaleResult, mine: RoyaleEndMine, won: boolean): string[] {
  const w = windowOf(r);
  const tally = w?.score ?? r.score;
  const lines: string[] = [];
  const assists = whole(mine.assists) ?? 0;
  const held = whole(r.held);
  const did =
    assists > 0 ? `${takedownsText(tally)} and ${assistsText(assists)}` : takedownsText(tally);
  lines.push(held !== null ? `${did} in ${clockText(held)}` : did);
  const by = whole(r.gap?.by);
  const above = (w?.rank ?? r.place) - 1;
  if (!won && by !== null && by >= 1 && above >= 1) {
    const short = by === 1 ? 'One takedown' : takedownsText(by);
    lines.push(`${short} short of ${ordinal(above)}`);
  }
  const best = whole(mine.best) ?? 0;
  if (best > 0 && tally > best) lines.push(`A new best: ${takedownsText(tally)}`);
  else if (best > tally) lines.push(`Your best: ${takedownsText(best)}`);
  if (!won) {
    if (r.winner === null) lines.push('The match goes on without you.');
    else lines.push(`${r.winner} won with ${takedownsText(r.top[0]?.score ?? 0)}`);
  }
  if (w && !won) lines.push(`Whole match: ${placeText(r.place, r.of)}`);
  return lines;
}

// The first button enters again with the same pick: One life's Play again,
// Respawn's Play the next match, which drops into the match kept running
// for drop-ins (server/royale_service.ts), the champion arriving fresh.
// Respawn's title is the place since the seat landed for a drop-in, the
// whole match's otherwise.
export function royaleEnd(
  r: RoyaleResult,
  mine: RoyaleEndMine = { assists: 0, best: 0 },
): RoyaleEndModel {
  const oneLife = r.v === 'one_life';
  const won = r.place === 1;
  const w = windowOf(r);
  const title = won
    ? oneLife
      ? 'Last one standing'
      : 'Most takedowns'
    : !oneLife && w
      ? `${ordinal(w.rank)} since you landed`
      : `You placed ${placeText(r.place, r.of)}`;
  const lines: string[] = [];
  if (!oneLife) lines.push(...respawnLines(r, mine, won));
  else if (won) lines.push(`${ordinal(1)} of ${r.of}, ${takedownsText(r.score)}`);
  else {
    lines.push(takedownsText(r.score));
    if (r.winner === null) lines.push('The match goes on without you.');
    else lines.push(`${r.winner} is the last one standing.`);
  }
  const shown = r.top.slice(0, oneLife ? ONE_LIFE_TOP : RESPAWN_TOP);
  const rows = shown.map((t, i) => ({
    place: i + 1,
    name: t.name,
    championId: t.championId,
    score: t.score,
    bot: t.bot,
    self: i + 1 === r.place,
  }));
  return {
    title,
    won,
    lines,
    heading: oneLife ? 'The top five' : 'The final ranking',
    rows,
    grafts: r.grafts && r.grafts.length > 0 ? `Grafts: ${graftNames(r.grafts).join(', ')}` : null,
    goal: oneLife ? null : (mine.goal ?? null),
    again: oneLife ? 'Play again' : 'Play the next match',
    other: `Try ${royaleMode(otherVariant(r.v)).title}`,
    home: 'Back home',
  };
}

// What the end plays, the sting and the voice: One life a victory for the
// last one standing and a defeat for everyone else. Respawn a victory for
// the most takedowns or a top three since landing, a defeat only for a
// whole match in the bottom half, and nothing in between. A drop-in is
// never told they lost: they came in late against a field that had been
// scoring for minutes, and a defeat would end their match on a loss
// they had no fair chance against.
export function royaleSting(r: RoyaleResult): 'victory' | 'defeat' | null {
  if (r.v === 'one_life') return r.place === 1 ? 'victory' : 'defeat';
  const w = windowOf(r);
  if (r.place === 1 || (w !== null && w.rank <= 3)) return 'victory';
  if (w !== null) return null;
  return r.place > r.of / 2 ? 'defeat' : null;
}
