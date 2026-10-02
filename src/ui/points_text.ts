// What the HUD says about points (CONTEXT.md: Points; ADR 0027): the pop
// when some land, the line a Guest's first points say once, and the box on
// the end screen and in the pause menu that says where the player stands.
// Pure, so a test reads every word without a browser; ui/hud.ts and
// ui/ladder_box.ts draw them. The wire shapes are mirrored here from
// server/points.ts and server/points_ladder.ts; the client never imports
// from server/.

import type { PointsReason } from '../net/protocol';

// The word after the number in the pop. A last hit is the common case and
// says only its number: the gold popping on the minion already says why.
const REASON_WORDS: Readonly<Record<PointsReason, string>> = {
  last_hit: '',
  kill: 'kill',
  assist: 'assist',
  tower: 'tower',
  creature: 'creature',
  ascendant: 'Ascendant',
  victory: 'victory',
  finish: 'played out',
  cache: 'cache',
  last_standing: 'last standing',
  top_five: 'top five',
  top_ten: 'top ten',
  best_score: 'best score',
};

export function popText(delta: number, reason: PointsReason): string {
  const word = REASON_WORDS[reason];
  return word ? `+${delta} ${word}` : `+${delta}`;
}

export function pointsWord(points: number): string {
  return points === 1 ? 'point' : 'points';
}

export function pointsCount(points: number): string {
  return `${points.toLocaleString('en-US')} ${pointsWord(points)}`;
}

// The first points of a Guest's first match, said plainly once per viewer
// (the settings seam, src/game/settings.ts): the match is on a ladder.
export function firstPointsText(delta: number): string {
  return `+${delta} ${pointsWord(delta)}. You are on the ladder`;
}

// The player's place, as /api/public/ladder answers it for the reader.
export interface LadderPlace {
  rank: number | null;
  points: number;
  name: string;
  guest: boolean;
  // A Guest wearing a name it chose; always true for an account.
  named: boolean;
}

// What this match has banked so far, after the place: the result of the
// match in points, on the end screen, and the running count in the pause
// menu. Nothing before the first points.
export function earnedText(earned: number): string {
  return earned > 0 ? `+${earned.toLocaleString('en-US')} this match` : '';
}

export const UNPLACED_LINE = 'Your first points put your name on the ladder.';

export function placeText(place: LadderPlace): string {
  if (place.rank === null) return UNPLACED_LINE;
  return `You are #${place.rank} on the ladder with ${pointsCount(place.points)}.`;
}

// Under the line: what the name box is for, for a Guest; what the name is,
// for an account, which has no field.
export function nameHint(place: LadderPlace): string {
  if (!place.guest) return `Your name there is your account's: ${place.name}.`;
  return place.named
    ? 'The name beside your points. Change it any time.'
    : 'Pick the name you want beside your points.';
}

// What the name box offers before the player types. A Guest that never
// chose a name stands on the ladder as its handed-out "Wanderer 4821",
// whose space no chosen name may hold (server/account_name.ts: letters,
// digits, _ and - only, 3 to 16), so offering it as it is made Save refuse
// the very name in the field. The offer is that name without what the rule
// refuses ("Wanderer4821"): one press keeps it, and the player may edit it.
// A chosen name, or an account's, is offered as it is.
// The account name rules' ceiling (server/account_name.ts), the field's too.
export const NAME_FIELD_MAX = 16;
export function nameSuggestion(place: LadderPlace): string {
  if (!place.guest || place.named) return place.name;
  return place.name.replace(/[^A-Za-z0-9_-]/g, '').slice(0, NAME_FIELD_MAX);
}

export const NAME_SAVE = 'Save';
export const NAME_SAVED = 'Saved.';
