// The first steps of the Range (CONTEXT.md: First steps, Range): the lane's
// list means nothing there (no minion to last hit, no tower, no gold to go
// home for, a recall from a base), and it would spend the lane's steps
// before the first match. The Range has its own short one, run by the same
// engine (ui/first_steps.ts): learn a spell, cast it at a Strikepost, and
// what the plated post stands for. Learning a spell is the same act in a
// match, so the HUD remembers that one with the lane's list; the other two
// are said again on each visit until done. Pure: the HUD hands in what it
// reads of the champion (RangeStepsView) and draws the line this answers.

import {
  advanceGuide,
  type GuideState,
  type GuideView,
  guideFinished,
  guideStart,
  READ_S,
  SAY_S,
  type StepRule,
  type StepsInput,
  type StepTable,
} from './first_steps';

// In the order they are tried. 'learn' is the lane's own id.
export const RANGE_STEP_IDS = ['learn', 'range_cast', 'range_plated'] as const;
export type RangeStepId = (typeof RANGE_STEP_IDS)[number];
export type RangeStepsState = GuideState<RangeStepId>;

export interface RangeStepsView extends GuideView {
  // Q, W or E holds a rank.
  learned: boolean;
  // A spell is cooling down, so one has been cast.
  cast: boolean;
}

const RULES: Readonly<Record<RangeStepId, StepRule<RangeStepId, RangeStepsView>>> = {
  learn: {
    when: (v) => !v.learned,
    over: (v) => v.learned,
    did: (v) => v.learned,
  },
  range_cast: {
    when: (v) => v.learned && !v.cast,
    over: (v, up) => v.cast || up >= READ_S + SAY_S,
    did: (v) => v.cast,
  },
  // Once a spell has been cast: why there are two posts.
  range_plated: {
    when: (_v, done) => done.includes('range_cast'),
    over: (_v, up) => up >= READ_S,
  },
};

const RANGE: StepTable<RangeStepId, RangeStepsView> = {
  ids: RANGE_STEP_IDS,
  rules: RULES,
  urgent: null,
};

// The Range's guide: hidden with the lane's, and 'learn' done when the
// browser remembers it done.
export function rangeStepsStart(off: boolean, done: readonly string[]): RangeStepsState {
  return guideStart(
    RANGE_STEP_IDS,
    off,
    done.filter((id) => id === 'learn'),
  );
}

export function stepRangeSteps(s: RangeStepsState, v: RangeStepsView): RangeStepsState {
  return advanceGuide(RANGE, s, v);
}

export function rangeStepsFinished(s: RangeStepsState): boolean {
  return guideFinished(RANGE_STEP_IDS, s);
}

const MOUSE: Readonly<Record<RangeStepId, string>> = {
  learn: 'Learn your first spell: click the + on Q, W or E.',
  range_cast: 'Press Q, W or E with your cursor on a Strikepost: the numbers show what it deals.',
  range_plated: 'The plated post takes less damage, like a tank: see how your kit fares on each.',
};

const TAP: Readonly<Partial<Record<RangeStepId, string>>> = {
  learn: 'Learn your first spell: tap the + on a spell.',
  range_cast: 'Tap a spell, then tap a Strikepost: the numbers show what it deals.',
};

const THUMBS: Readonly<Partial<Record<RangeStepId, string>>> = {
  learn: 'Learn your first spell: tap the + on a spell.',
  range_cast: 'Walk to a Strikepost and tap a spell: the numbers show its damage.',
};

export function rangeStepLine(id: RangeStepId, input: StepsInput): string {
  if (input === 'tap') return TAP[id] ?? MOUSE[id];
  if (input === 'thumbs') return THUMBS[id] ?? MOUSE[id];
  return MOUSE[id];
}
