// The battle royale's end screen, decided (ADR 0031): what it says once a
// person is out for good or the match is over, built from the result the
// server sends them (RoyaleResult, src/net/royale_wire.ts). The place,
// the takedowns, who won, the top of the ranking with a bot mark on every
// bot, and the three ways on: the same rule set again, the other one, and
// home. Pure; ui/royale_hud.ts draws it.

import type { RoyaleResult } from '../net/royale_wire';
import { otherVariant, royaleMode } from './royale_modes';
import { ordinal, placeText, takedownsText } from './royale_text';

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
  // takedowns, and who won.
  lines: string[];
  heading: string;
  rows: RoyaleEndRow[];
  again: string;
  other: string;
  home: string;
}

export function royaleEnd(r: RoyaleResult): RoyaleEndModel {
  const oneLife = r.v === 'one_life';
  const won = r.place === 1;
  const title = won
    ? oneLife
      ? 'Last one standing'
      : 'Most takedowns'
    : `You placed ${placeText(r.place, r.of)}`;
  const lines: string[] = [];
  if (won) lines.push(`${ordinal(1)} of ${r.of}, ${takedownsText(r.score)}`);
  else
    lines.push(
      oneLife ? takedownsText(r.score) : `${takedownsText(r.score)} when the light went out`,
    );
  if (!won) {
    if (r.winner === null) lines.push('The match goes on without you.');
    else if (oneLife) lines.push(`${r.winner} is the last one standing.`);
    else lines.push(`${r.winner} won with ${takedownsText(r.top[0]?.score ?? 0)}.`);
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
    again: 'Play again',
    other: `Try ${royaleMode(otherVariant(r.v)).title}`,
    home: 'Back home',
  };
}
