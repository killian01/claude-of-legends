// The battle royale's first steps (src/ui/royale_steps.ts): the mode's own
// list, run by the 5v5's engine under the same rules: one at a time, done
// once done or said long enough, what the player does unaided counted as
// done, the Dusk taking the card, and Hide guide hiding it for good. The
// fight first, on the champion's own landing, and the Dusk only when it
// matters.

import { describe, expect, it } from 'vitest';
import { clampSettings } from '../src/game/settings';
import { STEP_IDS, stepOnWire } from '../src/net/protocol';
import { GAP_S, LAPSE_S, READ_S, SAY_S } from '../src/ui/first_steps';
import {
  CACHE_AFTER_S,
  DUSK_NEAR_M,
  duskOvertakes,
  FIGHT_EARLY_S,
  FIGHT_FOLD_S,
  type FightTally,
  foldForFight,
  foughtBetween,
  hideRoyaleSteps,
  NOT_LANDED,
  noteLanding,
  PAD_AFTER_S,
  ROYALE_STEP_IDS,
  type RoyaleStepsState,
  type RoyaleStepsView,
  royaleStepLine,
  royaleStepsFinished,
  royaleStepsStart,
  sinceLanding,
  stepRoyaleSteps,
} from '../src/ui/royale_steps';

// Just landed, in the calm, nothing done.
const LANDED: RoyaleStepsView = {
  time: 12,
  covered: false,
  dead: false,
  sinceLanding: 0,
  fought: false,
  openedCache: false,
  padUsed: false,
  outside: false,
  overtaken: false,
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

// A newcomer who already fought: the steps after the fight's.
const fought = (done: readonly string[] = []): RoyaleStepsState =>
  royaleStepsStart(false, ['br_fight', ...done]);

describe('the battle royale first steps', () => {
  it('say nothing during the drop', () => {
    const s = stepRoyaleSteps(royaleStepsStart(false, []), { ...LANDED, sinceLanding: null });
    expect(s.current).toBeNull();
  });

  it('tell a newcomer to open a cache once landed, and leave once one is open', () => {
    let s = run(fought(), [at(0), at(CACHE_AFTER_S)]);
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
    let s = run(fought(), [at(0), at(CACHE_AFTER_S)]);
    expect(s.current).toBe('br_cache');
    s = stepRoyaleSteps(s, at(CACHE_AFTER_S + 1, { outside: true }));
    expect(s.current).toBe('br_dusk');
    // Still burning past the time a line is said: it holds.
    s = stepRoyaleSteps(s, at(CACHE_AFTER_S + 1 + SAY_S, { outside: true }));
    expect(s.current).toBe('br_dusk');
    // Back in the light, it has been said.
    s = stepRoyaleSteps(s, at(CACHE_AFTER_S + 2 + SAY_S, { outside: false }));
    expect(s.current).toBeNull();
    expect(s.done).toContain('br_dusk');
  });

  it('say nothing of the Dusk inside the light once the calm is over', () => {
    // 10 visitors in 12 were first told to stay in the light while they
    // stood 4 to 140 m inside it.
    const s = run(fought(['br_cache', 'br_pad']), [at(0), at(95), at(96)]);
    expect(s.current).toBeNull();
    expect(s.done).not.toContain('br_dusk');
  });

  it('let the Dusk take the card when it is about to overtake the champion', () => {
    let s = run(fought(), [at(0), at(CACHE_AFTER_S)]);
    expect(s.current).toBe('br_cache');
    s = stepRoyaleSteps(s, at(CACHE_AFTER_S + 1, { overtaken: true }));
    expect(s.current).toBe('br_dusk');
    // Its line is unchanged.
    expect(royaleStepLine('br_dusk', 'mouse')).toBe('Stay in the light: the Dusk burns.');
  });

  it('tell what a takedown gives when an enemy is near, done by the first one', () => {
    let s = run(fought(['br_cache']), [at(5, { enemyNear: true })]);
    expect(s.current).toBe('br_takedown');
    s = stepRoyaleSteps(s, at(8, { enemyNear: true, takedowns: 1 }));
    expect(s.current).toBeNull();
    expect(s.done).toContain('br_takedown');
  });

  it('bring up the launch pad once the landing is behind', () => {
    let s = run(fought(['br_cache']), [at(10)]);
    expect(s.current).toBeNull();
    s = stepRoyaleSteps(s, at(PAD_AFTER_S));
    expect(s.current).toBe('br_pad');
    s = stepRoyaleSteps(s, at(PAD_AFTER_S + READ_S));
    expect(s.current).toBeNull();
    expect(s.done).toContain('br_pad');
  });

  it('say the ultimate at level 6, done once it is cast', () => {
    let s = run(fought(['br_cache', 'br_pad']), [at(60, { level: 6, ultReady: true })]);
    expect(s.current).toBe('br_ult');
    s = stepRoyaleSteps(s, at(63, { level: 6, ultCast: true }));
    expect(s.current).toBeNull();
    expect(s.done).toContain('br_ult');
  });

  it('wait a moment between two steps', () => {
    let s = run(fought(), [at(0), at(CACHE_AFTER_S)]);
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
    // A browser that had done the five before the fight step came still
    // has that one to go.
    const five = ROYALE_STEP_IDS.filter((id) => id !== 'br_fight');
    expect(royaleStepsFinished(royaleStepsStart(false, five))).toBe(false);
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
    expect(royaleStepLine('br_fight', 'mouse')).toBe(
      'Click an enemy champion to attack it, and press Q, W or E to cast at your cursor.',
    );
    expect(royaleStepLine('br_fight', 'tap')).toBe(
      'Tap an enemy champion to attack it, then tap a spell and where to cast it.',
    );
    expect(royaleStepLine('br_fight', 'thumbs')).toBe(
      'Hold the stick toward an enemy and tap the attack button; tap a spell to cast it at them.',
    );
    for (const id of ROYALE_STEP_IDS) {
      for (const input of ['mouse', 'tap', 'thumbs'] as const) {
        expect(royaleStepLine(id, input)).not.toMatch(/recall|shop|tower|minion|\bB\b|\bP\b/i);
      }
    }
  });
});

describe('the fight step', () => {
  it('is the first card on landing, a drop-in at 4:16 counted from its own landing', () => {
    // A drop-in's first update in play is at 4:16, the drop long over: its
    // landing is then, not the drop's end.
    let l = noteLanding(NOT_LANDED, 'play', 10, 256);
    expect(sinceLanding(l, 'play', 256)).toBe(0);
    l = noteLanding(l, 'play', 10, 260);
    expect(sinceLanding(l, 'play', 260)).toBe(4);
    const s = stepRoyaleSteps(royaleStepsStart(false, []), {
      ...LANDED,
      time: 256,
      sinceLanding: sinceLanding(l, 'play', 256),
    });
    expect(s.current).toBe('br_fight');
  });

  it('counts a landing seen from the drop from the drop end', () => {
    let l = noteLanding(NOT_LANDED, 'drop', 10, 2);
    expect(sinceLanding(l, 'drop', 2)).toBeNull();
    l = noteLanding(l, 'drop', 10, 9.95);
    l = noteLanding(l, 'play', 10, 10.05);
    expect(l.at).toBe(10);
    expect(sinceLanding(l, 'play', 13)).toBe(3);
    expect(sinceLanding(NOT_LANDED, 'play', 13)).toBeNull();
  });

  it('comes before the ultimate for a drop-in landing at the level of the bot it replaced', () => {
    // A drop-in at 7:53 took a level 7 seat with R ready: the ultimate's
    // card took the landing's.
    let s = stepRoyaleSteps(
      royaleStepsStart(false, []),
      at(0, { level: 7, ultReady: true, time: 473 }),
    );
    expect(s.current).toBe('br_fight');
    s = stepRoyaleSteps(s, at(1, { level: 7, ultReady: true, fought: true, time: 474 }));
    expect(s.done).toContain('br_fight');
    s = stepRoyaleSteps(
      s,
      at(1 + GAP_S, { level: 7, ultReady: true, openedCache: true, time: 474 + GAP_S }),
    );
    expect(s.current).toBe('br_ult');
  });

  it('is done once the champion fights, and counts a fight unaided as done', () => {
    let s = run(royaleStepsStart(false, []), [at(0)]);
    expect(s.current).toBe('br_fight');
    s = stepRoyaleSteps(s, at(2, { fought: true }));
    expect(s.current).toBeNull();
    expect(s.done).toContain('br_fight');
    const unaided = stepRoyaleSteps(royaleStepsStart(false, []), at(1, { fought: true }));
    expect(unaided.done).toContain('br_fight');
  });

  it('lapses with nobody near, and comes back when an enemy is', () => {
    const quiet = { openedCache: true };
    let s = run(royaleStepsStart(false, []), [at(0, quiet)]);
    expect(s.current).toBe('br_fight');
    s = run(s, [at(FIGHT_EARLY_S, quiet), at(FIGHT_EARLY_S + LAPSE_S, quiet)]);
    expect(s.current).toBeNull();
    expect(s.done).not.toContain('br_fight');
    s = stepRoyaleSteps(s, at(30, { ...quiet, enemyNear: true }));
    expect(s.current).toBe('br_fight');
    // Said long enough, it is done.
    s = stepRoyaleSteps(s, at(30 + READ_S + SAY_S, { ...quiet, enemyNear: true }));
    expect(s.current).toBeNull();
    expect(s.done).toContain('br_fight');
  });

  it('counts a cast, a takedown or an assist as a fight, never a fall', () => {
    const was: FightTally = { cooldowns: [0, 0, 0], takedowns: 2, assists: 1 };
    expect(foughtBetween(was, was)).toBe(false);
    expect(foughtBetween(was, { ...was, cooldowns: [0, 31.5, 0] })).toBe(true);
    expect(foughtBetween(was, { ...was, takedowns: 3 })).toBe(true);
    expect(foughtBetween(was, { ...was, assists: 2 })).toBe(true);
    // A drop-in's Arrival counts from zero, and a cooldown cut short.
    expect(foughtBetween(was, { cooldowns: [0, 0, 0], takedowns: 0, assists: 0 })).toBe(false);
    const cooling: FightTally = { ...was, cooldowns: [40, 0, 0] };
    expect(foughtBetween(cooling, { ...was, cooldowns: [30, 0, 0] })).toBe(false);
  });

  it('is heard off the wire, for the seat report', () => {
    expect(stepOnWire('br_fight')).toBe('br_fight');
  });
});

describe('when the Dusk overtakes', () => {
  // The light around [0, 80, 0], shrinking toward a cap around [-40, 80, 0].
  const closing = {
    p: 2,
    c: [0, 80, 0] as [number, number, number],
    r: 60,
    nc: [-40, 80, 0] as [number, number, number],
    nr: 30,
    sh: 1 as const,
  };
  const edge = { x: 60 - DUSK_NEAR_M + 1, y: 80, z: 0 };

  it('is near the closing edge, outside the cap it closes to', () => {
    expect(duskOvertakes(edge, closing)).toBe(true);
  });

  it('is nothing while the light holds, deep inside, or inside the next cap', () => {
    expect(duskOvertakes(edge, { ...closing, sh: 0 })).toBe(false);
    expect(duskOvertakes({ x: 10, y: 80, z: 0 }, closing)).toBe(false);
    expect(duskOvertakes({ x: 60 - DUSK_NEAR_M - 1, y: 80, z: 0 }, closing)).toBe(false);
    // Near the edge on the side the light closes toward.
    expect(duskOvertakes({ x: -55, y: 80, z: 0 }, closing)).toBe(false);
    // The last light out: no cap to close to.
    expect(duskOvertakes(edge, { p: 6, c: closing.c, r: 0, sh: 1 })).toBe(false);
  });

  it('cannot be told without a height', () => {
    expect(duskOvertakes({ x: 55, z: 0 }, closing)).toBeNull();
  });
});

describe('the first steps in a fight', () => {
  it('fold on a phone while a hit was taken in the last seconds', () => {
    expect(foldForFight(0, true)).toBe(true);
    expect(foldForFight(FIGHT_FOLD_S - 0.1, true)).toBe(true);
    expect(foldForFight(FIGHT_FOLD_S, true)).toBe(false);
    expect(foldForFight(null, true)).toBe(false);
  });

  it('never fold on a desktop, where the card stands at the side', () => {
    expect(foldForFight(0, false)).toBe(false);
    expect(foldForFight(1, false)).toBe(false);
  });
});
