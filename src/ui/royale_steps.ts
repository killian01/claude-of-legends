// The first steps of the battle royale (ADR 0031, CONTEXT.md: First steps):
// the mode's own list, since learning a spell, the last hit, the recall,
// the shop and the towers mean nothing on the Wanderseed. Attack and cast
// at an enemy champion, open a cache, stay in the light, take a champion
// down, fly a launch pad, cast the ultimate at level 6. The same rules as
// the 5v5's (ui/first_steps.ts, whose engine runs both): one line at a
// time, a step done once done or said long enough, what the player does
// unaided counted as done, the browser remembering what is done
// (game/settings.ts royaleStepsDone) and Hide guide hiding the guide for
// good. Pure: the HUD hands in what it reads of the match (RoyaleStepsView)
// and draws the line this answers.

import { ROYALE_STEP_IDS, type RoyaleStepId } from '../net/protocol';
import type { SnapDusk, WirePoint } from '../net/royale_wire';
import type { RoyaleStage } from '../sim/royale/types';
import {
  advanceGuide,
  type GuideState,
  type GuideView,
  guideFinished,
  guideStart,
  hideGuide,
  READ_S,
  SAY_S,
  type StepRule,
  type StepsInput,
  type StepTable,
} from './first_steps';

// In the order they are tried, kept with the wire's (net/protocol.ts) so
// the seat report counts them.
export { ROYALE_STEP_IDS, type RoyaleStepId };

export type RoyaleStepsState = GuideState<RoyaleStepId>;

export interface RoyaleStepsView extends GuideView {
  // Seconds since this champion landed, its own landing (a drop-in lands
  // minutes into the match); null during the drop.
  sinceLanding: number | null;
  // The champion fought since it landed: a Q, W or E cast, or a takedown
  // or an assist.
  fought: boolean;
  // A cache opened by the champion this match.
  openedCache: boolean;
  // A launch pad thrown the champion this match.
  padUsed: boolean;
  // The champion stands outside the light; null when the HUD cannot tell.
  outside: boolean | null;
  // The closing Dusk is about to overtake the champion (duskOvertakes);
  // null when the HUD cannot tell.
  overtaken: boolean | null;
  // An enemy champion close by, alive and in sight.
  enemyNear: boolean;
  takedowns: number;
  level: number;
  // R holds a rank and is off cooldown.
  ultReady: boolean;
  // R is cooling down, so it was cast.
  ultCast: boolean;
}

// The fight step shows for this long on landing, whoever is near; after it,
// only with an enemy champion near.
export const FIGHT_EARLY_S = 4;
// When the cache step comes up after landing, and the launch pad's.
export const CACHE_AFTER_S = 2;
export const PAD_AFTER_S = 45;
// The ultimate's level (ADR 0031: ultimate at 6).
export const ULT_LEVEL = 6;
// How close the closing edge of the light has to come for the Dusk step.
export const DUSK_NEAR_M = 6;

// Whether the closing Dusk is about to overtake a champion: the light is
// shrinking toward a next cap the champion stands outside, and its edge is
// within DUSK_NEAR_M. Standing deep inside, or while the light holds, the
// Dusk is nothing to say yet (telling a champion well inside the light to
// stay in it says nothing). Null when the point carries
// no height, as for outsideLight (ui/royale_text.ts).
export function duskOvertakes(
  pos: { x: number; z: number; y?: number },
  dusk: Pick<SnapDusk, 'p' | 'c' | 'r' | 'nc' | 'nr' | 'sh'>,
): boolean | null {
  if (typeof pos.y !== 'number' || !Number.isFinite(pos.y)) return null;
  if (dusk.sh !== 1 || dusk.nc === undefined || dusk.nr === undefined) return false;
  const y = pos.y;
  const away = ([cx, cy, cz]: WirePoint): number => Math.hypot(pos.x - cx, y - cy, pos.z - cz);
  return away(dusk.nc) > dusk.nr && away(dusk.c) >= dusk.r - DUSK_NEAR_M;
}

// When this champion landed, as the HUD sees the stages go by: the drop's
// end when it saw the drop, else the world time of its first update in
// play. A drop-in lands minutes into the match, and the steps counted from
// the drop's end had it landed minutes ago.
export interface Landing {
  sawDrop: boolean;
  at: number | null;
}

export const NOT_LANDED: Landing = { sawDrop: false, at: null };

export function noteLanding(l: Landing, st: RoyaleStage, de: number, time: number): Landing {
  if (st === 'drop') return l.sawDrop ? l : { ...l, sawDrop: true };
  if (l.at !== null) return l;
  return { ...l, at: l.sawDrop ? de : time };
}

// Seconds since the landing; null during the drop or before it is seen.
export function sinceLanding(l: Landing, st: RoyaleStage, time: number): number | null {
  if (st === 'drop' || l.at === null) return null;
  return Math.max(0, time - l.at);
}

// What the fight step counts off the own champion, update by update: the
// ends of its Q, W and E cooldowns (in that order), and its takedowns and
// assists.
export interface FightTally {
  cooldowns: readonly number[];
  takedowns: number;
  assists: number;
}

// A fight between two updates: a spell newly cooling (it was cast), or one
// more takedown or assist. A tally that falls (a drop-in's Arrival counts
// from zero) is no fight, nor a cooldown cut short.
export function foughtBetween(prev: FightTally, next: FightTally): boolean {
  if (next.takedowns > prev.takedowns || next.assists > prev.assists) return true;
  return next.cooldowns.some((end, i) => end > (prev.cooldowns[i] ?? 0));
}

const RULES: Readonly<Record<RoyaleStepId, StepRule<RoyaleStepId, RoyaleStepsView>>> = {
  // The first card on landing: how to attack and cast. Nothing else in the
  // guide said it, and a battle royale is played from the first seconds.
  // Once lapsed it comes back when an enemy is near.
  br_fight: {
    when: (v) =>
      v.sinceLanding !== null && !v.fought && (v.enemyNear || v.sinceLanding < FIGHT_EARLY_S),
    over: (v, up) => v.fought || up >= READ_S + SAY_S,
    did: (v) => v.fought,
  },
  br_cache: {
    when: (v) => v.sinceLanding !== null && v.sinceLanding >= CACHE_AFTER_S && !v.openedCache,
    over: (v, up) => v.openedCache || up >= READ_S + SAY_S,
    did: (v) => v.openedCache,
  },
  // The urgent one: standing in the Dusk, or about to be overtaken by it,
  // takes the card from any step.
  br_dusk: {
    when: (v) => v.sinceLanding !== null && (v.outside === true || v.overtaken === true),
    over: (v, up) => (v.outside !== true && up >= SAY_S) || up >= READ_S + SAY_S,
  },
  br_takedown: {
    when: (v) => v.enemyNear && v.takedowns === 0,
    over: (v, up) => v.takedowns > 0 || up >= READ_S,
    did: (v) => v.takedowns > 0,
  },
  br_pad: {
    when: (v) => v.sinceLanding !== null && v.sinceLanding >= PAD_AFTER_S && !v.padUsed,
    over: (v, up) => v.padUsed || up >= READ_S,
    did: (v) => v.padUsed,
  },
  br_ult: {
    when: (v) => v.level >= ULT_LEVEL && v.ultReady,
    over: (v, up) => v.ultCast || up >= READ_S,
    did: (v) => v.level >= ULT_LEVEL && v.ultCast,
  },
};

const TABLE: StepTable<RoyaleStepId, RoyaleStepsView> = {
  ids: ROYALE_STEP_IDS,
  rules: RULES,
  urgent: 'br_dusk',
};

// On a phone the card stands in the band over the champion, where a fight
// is read: it folds while the champion is in one (a hit taken, the Dusk's
// burn aside, in the last FIGHT_FOLD_S) and comes back after. On a desktop
// it stands at the side (ui/hud.ts) and never folds for a fight.
export const FIGHT_FOLD_S = 3;
export function foldForFight(sinceHit: number | null, compact: boolean): boolean {
  return compact && sinceHit !== null && sinceHit >= 0 && sinceHit < FIGHT_FOLD_S;
}

export function royaleStepsStart(off: boolean, done: readonly string[]): RoyaleStepsState {
  return guideStart(ROYALE_STEP_IDS, off, done);
}

export function stepRoyaleSteps(s: RoyaleStepsState, v: RoyaleStepsView): RoyaleStepsState {
  return advanceGuide(TABLE, s, v);
}

export function royaleStepsFinished(s: RoyaleStepsState): boolean {
  return guideFinished(ROYALE_STEP_IDS, s);
}

export function hideRoyaleSteps(s: RoyaleStepsState): RoyaleStepsState {
  return hideGuide(s);
}

const MOUSE: Readonly<Record<RoyaleStepId, string>> = {
  br_fight: 'Click an enemy champion to attack it, and press Q, W or E to cast at your cursor.',
  br_cache: 'Stand by a glowing cache to open it: it holds the next piece of your build.',
  br_pad: 'Step on a launch pad to fly 50 m.',
  br_dusk: 'Stay in the light: the Dusk burns.',
  br_takedown: 'Takedowns heal you and give you the next piece.',
  br_ult: 'Level 6: your ultimate is ready on R.',
};

const TAP: Readonly<Partial<Record<RoyaleStepId, string>>> = {
  br_fight: 'Tap an enemy champion to attack it, then tap a spell and where to cast it.',
  br_cache:
    'Tap beside a glowing cache and stand there to open it: it holds the next piece of your build.',
  br_pad: 'Tap a launch pad to step on it and fly 50 m.',
  br_ult: 'Level 6: your ultimate is ready: tap R, then where to cast it.',
};

const THUMBS: Readonly<Partial<Record<RoyaleStepId, string>>> = {
  br_fight:
    'Hold the stick toward an enemy and tap the attack button; tap a spell to cast it at them.',
  br_cache:
    'Steer to a glowing cache and stand by it to open it: it holds the next piece of your build.',
  br_pad: 'Steer onto a launch pad to fly 50 m.',
  br_ult: 'Level 6: your ultimate is ready: tap R to cast it, or slide it to aim.',
};

// With a mouse, the fight's line says the button that attacks: the left
// one, or the right one when the leftClickMoves setting is off (the bar's
// hints say the same, ui/royale_text.ts royaleHints).
const RIGHT_CLICK_FIGHT =
  'Right-click an enemy champion to attack it, and press Q, W or E to cast at your cursor.';

export function royaleStepLine(id: RoyaleStepId, input: StepsInput, leftClickMoves = true): string {
  if (input === 'tap') return TAP[id] ?? MOUSE[id];
  if (input === 'thumbs') return THUMBS[id] ?? MOUSE[id];
  if (id === 'br_fight' && !leftClickMoves) return RIGHT_CLICK_FIGHT;
  return MOUSE[id];
}
