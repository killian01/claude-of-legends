// The first steps of the battle royale (ADR 0031, CONTEXT.md: First steps):
// the mode's own list, since learning a spell, the last hit, the recall,
// the shop and the towers mean nothing on the Wanderseed. Open a cache,
// stay in the light, take a champion down, fly a launch pad, cast the
// ultimate at level 6. The same rules as the 5v5's (ui/first_steps.ts,
// whose engine runs both): one line at a time, a step done once done or
// said long enough, what the player does unaided counted as done, the
// browser remembering what is done (game/settings.ts royaleStepsDone) and
// Hide guide hiding the guide for good. Pure: the HUD hands in what it
// reads of the match (RoyaleStepsView) and draws the line this answers.

import { ROYALE_STEP_IDS, type RoyaleStepId } from '../net/protocol';
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
  // Seconds since the champion landed; null during the drop.
  sinceLanding: number | null;
  // A cache opened by the champion this match.
  openedCache: boolean;
  // A launch pad thrown the champion this match.
  padUsed: boolean;
  // The calm is over: the Dusk is holding or closing.
  closing: boolean;
  // The champion stands outside the light; null when the HUD cannot tell.
  outside: boolean | null;
  // An enemy champion close by, alive and in sight.
  enemyNear: boolean;
  takedowns: number;
  level: number;
  // R holds a rank and is off cooldown.
  ultReady: boolean;
  // R is cooling down, so it was cast.
  ultCast: boolean;
}

// When the cache step comes up after landing, and the launch pad's.
export const CACHE_AFTER_S = 2;
export const PAD_AFTER_S = 45;
// The ultimate's level (ADR 0031: ultimate at 6).
export const ULT_LEVEL = 6;

const RULES: Readonly<Record<RoyaleStepId, StepRule<RoyaleStepId, RoyaleStepsView>>> = {
  br_cache: {
    when: (v) => v.sinceLanding !== null && v.sinceLanding >= CACHE_AFTER_S && !v.openedCache,
    over: (v, up) => v.openedCache || up >= READ_S + SAY_S,
    did: (v) => v.openedCache,
  },
  // The urgent one: standing in the Dusk takes the card from any step.
  br_dusk: {
    when: (v) => v.sinceLanding !== null && (v.outside === true || v.closing),
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
  br_cache: 'Stand by a glowing cache to open it: it holds the next piece of your build.',
  br_pad: 'Step on a launch pad to fly 50 m.',
  br_dusk: 'Stay in the light: the Dusk burns.',
  br_takedown: 'Takedowns heal you and give you the next piece.',
  br_ult: 'Level 6: your ultimate is ready on R.',
};

const TAP: Readonly<Partial<Record<RoyaleStepId, string>>> = {
  br_cache:
    'Tap beside a glowing cache and stand there to open it: it holds the next piece of your build.',
  br_pad: 'Tap a launch pad to step on it and fly 50 m.',
  br_ult: 'Level 6: your ultimate is ready: tap R, then where to cast it.',
};

const THUMBS: Readonly<Partial<Record<RoyaleStepId, string>>> = {
  br_cache:
    'Steer to a glowing cache and stand by it to open it: it holds the next piece of your build.',
  br_pad: 'Steer onto a launch pad to fly 50 m.',
  br_ult: 'Level 6: your ultimate is ready: tap R to cast it, or slide it to aim.',
};

export function royaleStepLine(id: RoyaleStepId, input: StepsInput): string {
  if (input === 'tap') return TAP[id] ?? MOUSE[id];
  if (input === 'thumbs') return THUMBS[id] ?? MOUSE[id];
  return MOUSE[id];
}
