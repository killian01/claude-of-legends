// The Range's first steps (src/ui/range_steps.ts): its own short list,
// learn a spell, cast it at a Strikepost, what the plated post stands for,
// leaving the lane's steps for the first match.

import { describe, expect, it } from 'vitest';
import { GAP_S, READ_S, SAY_S } from '../src/ui/first_steps';
import {
  RANGE_STEP_IDS,
  type RangeStepsState,
  type RangeStepsView,
  rangeStepLine,
  rangeStepsFinished,
  rangeStepsStart,
  stepRangeSteps,
} from '../src/ui/range_steps';

const START: RangeStepsView = { time: 1, covered: false, dead: false, learned: false, cast: false };

function run(s: RangeStepsState, views: readonly RangeStepsView[]): RangeStepsState {
  let at = s;
  for (const v of views) at = stepRangeSteps(at, v);
  return at;
}

describe('the Range first steps', () => {
  it('lead from learning a spell to casting it at a post, then the plated post', () => {
    let s = stepRangeSteps(rangeStepsStart(false, []), START);
    expect(s.current).toBe('learn');
    s = stepRangeSteps(s, { ...START, time: 4, learned: true });
    expect(s.current).toBeNull();
    s = stepRangeSteps(s, { ...START, time: 4 + GAP_S, learned: true });
    expect(s.current).toBe('range_cast');
    s = stepRangeSteps(s, { ...START, time: 9, learned: true, cast: true });
    expect(s.done).toContain('range_cast');
    s = stepRangeSteps(s, { ...START, time: 9 + GAP_S, learned: true });
    expect(s.current).toBe('range_plated');
    s = stepRangeSteps(s, { ...START, time: 9 + GAP_S + READ_S, learned: true });
    expect(rangeStepsFinished(s)).toBe(true);
  });

  it('say the cast long enough, then let it go', () => {
    const learned = { ...START, learned: true };
    let s = stepRangeSteps(rangeStepsStart(false, ['learn']), learned);
    expect(s.current).toBe('range_cast');
    s = stepRangeSteps(s, { ...learned, time: 1 + READ_S + SAY_S });
    expect(s.done).toContain('range_cast');
  });

  it('keep only a learned spell from what the lane remembers', () => {
    const s = rangeStepsStart(false, ['learn', 'spell', 'recall', 'go_shop']);
    expect(s.done).toEqual(['learn']);
  });

  it('never tell the lane, the shop or the recall', () => {
    expect(RANGE_STEP_IDS).toEqual(['learn', 'range_cast', 'range_plated']);
    for (const id of RANGE_STEP_IDS) {
      for (const input of ['mouse', 'tap', 'thumbs'] as const) {
        expect(rangeStepLine(id, input)).not.toMatch(/recall|shop|minion|tower|lane/i);
      }
    }
  });

  it('stay hidden when the guide is hidden', () => {
    const s = run(rangeStepsStart(true, []), [START, { ...START, time: 5 }]);
    expect(s.current).toBeNull();
    expect(rangeStepsFinished(s)).toBe(true);
  });

  it('wait while the screen is covered', () => {
    const s = stepRangeSteps(rangeStepsStart(false, []), { ...START, covered: true });
    expect(s.current).toBeNull();
  });
});
