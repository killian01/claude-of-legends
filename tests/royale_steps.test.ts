// The battle royale's first steps (src/ui/royale_steps.ts): the mode's own
// list, run by the 5v5's engine under the same rules: one at a time, done
// once done or said long enough, what the player does unaided counted as
// done, the Dusk taking the card, and Hide guide hiding it for good.

import { describe, expect, it } from 'vitest';
import { clampSettings } from '../src/game/settings';
import { STEP_IDS } from '../src/net/protocol';
import { GAP_S, READ_S, SAY_S } from '../src/ui/first_steps';
import {
  CACHE_AFTER_S,
  hideRoyaleSteps,
  PAD_AFTER_S,
  ROYALE_STEP_IDS,
  type RoyaleStepsState,
  type RoyaleStepsView,
  royaleStepLine,
  royaleStepsFinished,
  royaleStepsStart,
  stepRoyaleSteps,
} from '../src/ui/royale_steps';

// Just landed, in the calm, nothing done.
const LANDED: RoyaleStepsView = {
  time: 12,
  covered: false,
  dead: false,
  sinceLanding: 0,
  openedCache: false,
  padUsed: false,
  closing: false,
  outside: false,
  enemyNear: false,
  takedowns: 0,
  level: 3,
  ultReady: false,
  ultCast: false,
};

function run(s: RoyaleStepsState, views: readonly RoyaleStepsView[]): RoyaleStepsState {
  let at = s;
  for (const v of views) at = stepRoyaleSteps(at, v);
  return at;
}

const at = (t: number, over: Partial<RoyaleStepsView> = {}): RoyaleStepsView => ({
  ...LANDED,
  time: LANDED.time + t,
  sinceLanding: t,
  ...over,
});

describe('the battle royale first steps', () => {
  it('say nothing during the drop', () => {
    const s = stepRoyaleSteps(royaleStepsStart(false, []), { ...LANDED, sinceLanding: null });
    expect(s.current).toBeNull();
  });

  it('tell a newcomer to open a cache once landed, and leave once one is open', () => {
    let s = run(royaleStepsStart(false, []), [at(0), at(CACHE_AFTER_S)]);
    expect(s.current).toBe('br_cache');
    s = stepRoyaleSteps(s, at(CACHE_AFTER_S + 3, { openedCache: true }));
    expect(s.current).toBeNull();
    expect(s.done).toContain('br_cache');
  });

  it('count a cache opened unaided as done, shown or not', () => {
    const s = stepRoyaleSteps(royaleStepsStart(false, []), at(1, { openedCache: true }));
    expect(s.done).toContain('br_cache');
  });

  it('let the Dusk take the card from any step while the champion stands in it', () => {
    let s = run(royaleStepsStart(false, []), [at(0), at(CACHE_AFTER_S)]);
    expect(s.current).toBe('br_cache');
    s = stepRoyaleSteps(s, at(CACHE_AFTER_S + 1, { closing: true, outside: true }));
    expect(s.current).toBe('br_dusk');
    // Still burning past the time a line is said: it holds.
    s = stepRoyaleSteps(s, at(CACHE_AFTER_S + 1 + SAY_S, { closing: true, outside: true }));
    expect(s.current).toBe('br_dusk');
    // Back in the light, it has been said.
    s = stepRoyaleSteps(s, at(CACHE_AFTER_S + 2 + SAY_S, { closing: true, outside: false }));
    expect(s.current).toBeNull();
    expect(s.done).toContain('br_dusk');
  });

  it('say the Dusk once the calm is over, even in the light', () => {
    const s = run(royaleStepsStart(false, ['br_cache']), [at(0), at(95, { closing: true })]);
    expect(s.current).toBe('br_dusk');
  });

  it('tell what a takedown gives when an enemy is near, done by the first one', () => {
    let s = run(royaleStepsStart(false, ['br_cache']), [at(5, { enemyNear: true })]);
    expect(s.current).toBe('br_takedown');
    s = stepRoyaleSteps(s, at(8, { enemyNear: true, takedowns: 1 }));
    expect(s.current).toBeNull();
    expect(s.done).toContain('br_takedown');
  });

  it('bring up the launch pad once the landing is behind', () => {
    let s = run(royaleStepsStart(false, ['br_cache']), [at(10)]);
    expect(s.current).toBeNull();
    s = stepRoyaleSteps(s, at(PAD_AFTER_S));
    expect(s.current).toBe('br_pad');
    s = stepRoyaleSteps(s, at(PAD_AFTER_S + READ_S));
    expect(s.current).toBeNull();
    expect(s.done).toContain('br_pad');
  });

  it('say the ultimate at level 6, done once it is cast', () => {
    let s = run(royaleStepsStart(false, ['br_cache', 'br_pad']), [
      at(60, { level: 6, ultReady: true }),
    ]);
    expect(s.current).toBe('br_ult');
    s = stepRoyaleSteps(s, at(63, { level: 6, ultCast: true }));
    expect(s.current).toBeNull();
    expect(s.done).toContain('br_ult');
  });

  it('wait a moment between two steps', () => {
    let s = run(royaleStepsStart(false, []), [at(0), at(CACHE_AFTER_S)]);
    s = stepRoyaleSteps(s, at(CACHE_AFTER_S + 1, { openedCache: true, enemyNear: true }));
    expect(s.current).toBeNull();
    s = stepRoyaleSteps(
      s,
      at(CACHE_AFTER_S + 1 + GAP_S / 2, { openedCache: true, enemyNear: true }),
    );
    expect(s.current).toBeNull();
    s = stepRoyaleSteps(s, at(CACHE_AFTER_S + 1 + GAP_S, { openedCache: true, enemyNear: true }));
    expect(s.current).toBe('br_takedown');
  });

  it('hide for good when asked, and finish once all are done', () => {
    let s = run(royaleStepsStart(false, []), [at(0), at(CACHE_AFTER_S)]);
    s = hideRoyaleSteps(s);
    expect(s.current).toBeNull();
    expect(royaleStepsFinished(s)).toBe(true);
    expect(stepRoyaleSteps(s, at(CACHE_AFTER_S + 5)).current).toBeNull();
    expect(royaleStepsFinished(royaleStepsStart(false, [...ROYALE_STEP_IDS]))).toBe(true);
    expect(royaleStepsFinished(royaleStepsStart(false, ['br_cache']))).toBe(false);
  });

  it('remember what this browser did apart from the 5v5, off the wire', () => {
    const s = royaleStepsStart(
      false,
      clampSettings({ royaleStepsDone: ['br_pad', 'learn'] }).royaleStepsDone,
    );
    expect(s.done).toEqual(['br_pad']);
    for (const id of ROYALE_STEP_IDS)
      expect((STEP_IDS as readonly string[]).includes(id)).toBe(false);
  });

  it('say each step in the words of the hands on the screen', () => {
    expect(royaleStepLine('br_cache', 'mouse')).toBe(
      'Stand by a glowing cache to open it: it holds the next piece of your build.',
    );
    expect(royaleStepLine('br_pad', 'mouse')).toBe('Step on a launch pad to fly 50 m.');
    expect(royaleStepLine('br_dusk', 'mouse')).toBe('Stay in the light: the Dusk burns.');
    expect(royaleStepLine('br_takedown', 'mouse')).toBe(
      'Takedowns heal you and give you the next piece.',
    );
    expect(royaleStepLine('br_ult', 'mouse')).toBe('Level 6: your ultimate is ready on R.');
    expect(royaleStepLine('br_ult', 'tap')).toMatch(/tap R/);
    expect(royaleStepLine('br_ult', 'thumbs')).toMatch(/slide it to aim/);
    expect(royaleStepLine('br_pad', 'thumbs')).toMatch(/Steer/);
    expect(royaleStepLine('br_dusk', 'tap')).toBe(royaleStepLine('br_dusk', 'mouse'));
    for (const id of ROYALE_STEP_IDS) {
      for (const input of ['mouse', 'tap', 'thumbs'] as const) {
        expect(royaleStepLine(id, input)).not.toMatch(/recall|shop|tower|minion|\bB\b|\bP\b/i);
      }
    }
  });
});
