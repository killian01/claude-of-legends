// The first steps (src/ui/first_steps.ts, CONTEXT.md): one line at a time
// for a newcomer, picked from what is happening, gone once done, what the
// player did on their own counted as done, and the guide hidden for good
// when they say so. The shop's suggested item it points at
// (src/ui/shop_suggestion.ts), and the step ids as the server reads them.

import { describe, expect, it } from 'vitest';
import { clampSettings } from '../src/game/settings';
import { STEP_IDS, stepOnWire } from '../src/net/protocol';
import { effectiveItemCost, ITEMS } from '../src/sim/content/items';
import { MAGIC_BUILD, SHELL_BUILD } from '../src/sim/playbook/kit';
import {
  GAP_S,
  GO_SHOP_AT_S,
  hideSteps,
  LAPSE_S,
  LAST_HIT_S,
  RECALL_AT_S,
  SAY_S,
  type StepsState,
  type StepsView,
  stepLine,
  stepSteps,
  stepsFinished,
  stepsStart,
} from '../src/ui/first_steps';
import { suggestedItem } from '../src/ui/shop_suggestion';

// A newcomer at the fountain, the shop closed, one skill point to spend.
const START: StepsView = {
  time: 5,
  covered: false,
  dead: false,
  level: 1,
  skillPoints: 1,
  learned: false,
  cast: false,
  cs: 0,
  enemyMinionNear: false,
  enemyChampionNear: false,
  hpFrac: 1,
  towerAlone: false,
  atFountain: true,
  canAffordSuggestion: false,
  recalling: false,
};

// Steps the state through views, one update each.
function run(s: StepsState, views: readonly StepsView[]): StepsState {
  let at = s;
  for (const v of views) at = stepSteps(at, v);
  return at;
}

describe('the first steps', () => {
  it('tell a newcomer to learn a spell first, and leave once it is learned', () => {
    let s = stepSteps(stepsStart(false, []), START);
    expect(s.current).toBe('learn');
    s = stepSteps(s, { ...START, time: 9, skillPoints: 0, learned: true });
    expect(s.current).toBeNull();
    expect(s.done).toContain('learn');
  });

  it('show one step at a time, a pause between two, safety first', () => {
    const fresh = stepsStart(false, ['learn']);
    // Hurt beside a minion: backing off comes before the last hit.
    const hurt = { ...START, skillPoints: 0, learned: true, hpFrac: 0.2, enemyMinionNear: true };
    let s = stepSteps(fresh, hurt);
    expect(s.current).toBe('low_health');
    s = stepSteps(s, { ...hurt, time: 6, hpFrac: 0.8 });
    expect(s.current).toBeNull();
    // The pause: nothing new for a moment, then the last hit.
    s = stepSteps(s, { ...hurt, time: 6 + GAP_S / 2, hpFrac: 0.8 });
    expect(s.current).toBeNull();
    s = stepSteps(s, { ...hurt, time: 6 + GAP_S, hpFrac: 0.8 });
    expect(s.current).toBe('last_hit');
  });

  it('count what the player did on their own as done, shown or not', () => {
    // Somebody who knows the game learns a spell and takes a last hit
    // before either step ever comes up.
    const s = run(stepsStart(false, []), [
      { ...START, covered: true },
      { ...START, time: 6, covered: true, skillPoints: 0, learned: true, cs: 1 },
    ]);
    expect(s.done).toEqual(expect.arrayContaining(['learn', 'last_hit']));
    expect(s.current).toBeNull();
    const later = stepSteps(s, { ...START, time: 30, skillPoints: 0, learned: true, cs: 1 });
    expect(later.current).not.toBe('learn');
    expect(later.current).not.toBe('last_hit');
  });

  it('let a step that stops applying go undone, and bring it back when it applies', () => {
    const near = { ...START, skillPoints: 0, learned: true, enemyChampionNear: true };
    let s = stepSteps(stepsStart(false, ['learn']), near);
    expect(s.current).toBe('spell');
    // The enemy champion walks off: the step lingers, then goes undone.
    s = stepSteps(s, { ...near, time: 6, enemyChampionNear: false });
    expect(s.current).toBe('spell');
    s = stepSteps(s, { ...near, time: 6 + LAPSE_S, enemyChampionNear: false });
    expect(s.current).toBeNull();
    expect(s.done).not.toContain('spell');
    // Another one comes near: the step is back, and a cast ends it.
    s = stepSteps(s, { ...near, time: 20 });
    expect(s.current).toBe('spell');
    s = stepSteps(s, { ...near, time: 21, cast: true });
    expect(s.done).toContain('spell');
  });

  it('say a warning for a while, once', () => {
    const alone = { ...START, skillPoints: 0, learned: true, towerAlone: true };
    let s = stepSteps(stepsStart(false, ['learn']), alone);
    expect(s.current).toBe('tower');
    s = stepSteps(s, { ...alone, time: 5 + SAY_S });
    expect(s.current).toBeNull();
    expect(s.done).toContain('tower');
    s = stepSteps(s, { ...alone, time: 60 });
    expect(s.current).not.toBe('tower');
  });

  it('start nothing under the shop or a menu, nor while dead', () => {
    expect(stepSteps(stepsStart(false, []), { ...START, covered: true }).current).toBeNull();
    expect(stepSteps(stepsStart(false, []), { ...START, dead: true }).current).toBeNull();
  });

  it('stay hidden once the player hides them, and skip what the browser did', () => {
    const shown = stepSteps(stepsStart(false, []), START);
    const hidden = hideSteps(shown);
    expect(hidden.current).toBeNull();
    expect(stepSteps(hidden, START).current).toBeNull();
    expect(stepsFinished(hidden)).toBe(true);
    expect(stepSteps(stepsStart(true, []), START).current).toBeNull();
    // Done in an earlier match; unknown names from storage are dropped.
    const back = stepsStart(false, ['learn', 'made_up']);
    expect(back.done).toEqual(['learn']);
    expect(stepSteps(back, START).current).toBeNull();
    expect(stepsFinished(stepsStart(false, [...STEP_IDS]))).toBe(true);
  });

  it('say the last hit for a while and move on, even with none taken', () => {
    const lane = { ...START, skillPoints: 0, learned: true, enemyMinionNear: true };
    let s = stepSteps(stepsStart(false, ['learn']), lane);
    expect(s.current).toBe('last_hit');
    s = stepSteps(s, { ...lane, time: 5 + LAST_HIT_S });
    expect(s.current).toBeNull();
    expect(s.done).toContain('last_hit');
  });

  it('let backing off take the card from any other step', () => {
    const lane = { ...START, skillPoints: 0, learned: true, enemyMinionNear: true };
    let s = stepSteps(stepsStart(false, ['learn']), lane);
    expect(s.current).toBe('last_hit');
    s = stepSteps(s, { ...lane, time: 8, hpFrac: 0.2 });
    expect(s.current).toBe('low_health');
    expect(s.done).not.toContain('last_hit');
  });

  it('tell a champion with gold in the lane to go home and spend it', () => {
    const rich = {
      ...START,
      time: GO_SHOP_AT_S + 5,
      skillPoints: 0,
      learned: true,
      atFountain: false,
      canAffordSuggestion: true,
    };
    let s = stepSteps(stepsStart(false, ['learn']), rich);
    expect(s.current).toBe('go_shop');
    expect(stepLine('go_shop', 'mouse')).toMatch(/press B/);
    expect(stepLine('go_shop', 'thumbs')).toMatch(/Recall/);
    // Home: the step is done, and the shop's own step comes after the pause.
    s = stepSteps(s, { ...rich, time: GO_SHOP_AT_S + 20, atFountain: true });
    expect(s.done).toContain('go_shop');
    s = stepSteps(s, { ...rich, time: GO_SHOP_AT_S + 20 + GAP_S, atFountain: true });
    expect(s.current).toBe('gold');
  });

  it('teach the recall in the lane, and count it done once the player recalls', () => {
    const lane = { ...START, time: RECALL_AT_S, skillPoints: 0, learned: true, atFountain: false };
    let s = stepSteps(stepsStart(false, ['learn']), lane);
    expect(s.current).toBe('recall');
    expect(stepLine('recall', 'mouse')).toMatch(/Press B to recall/);
    expect(stepLine('recall', 'thumbs')).toMatch(/Tap Recall/);
    s = stepSteps(s, { ...lane, time: RECALL_AT_S + 3, recalling: true });
    expect(s.done).toContain('recall');
    // Somebody who recalls on their own is never told.
    const own = stepSteps(stepsStart(false, ['learn']), { ...lane, time: 20, recalling: true });
    expect(own.done).toContain('recall');
  });

  it('tell the goal once the lane is under way', () => {
    const lane = { ...START, time: 160, skillPoints: 0, learned: true, cs: 3 };
    const s = stepSteps(stepsStart(false, ['learn', 'last_hit']), lane);
    expect(s.current).toBe('goal');
  });

  it('speak the way the player plays, in a line that fits the card', () => {
    for (const id of STEP_IDS) {
      for (const input of ['mouse', 'tap', 'thumbs'] as const) {
        const line = stepLine(id, input);
        expect(line.length).toBeGreaterThan(20);
        expect(line.length).toBeLessThanOrEqual(92);
      }
    }
    expect(stepLine('low_health', 'mouse')).toMatch(/press B/);
    expect(stepLine('low_health', 'tap')).toMatch(/Recall/);
    expect(stepLine('learn', 'mouse')).toMatch(/click/);
    expect(stepLine('learn', 'thumbs')).toMatch(/tap/);
    expect(stepLine('spell', 'thumbs')).toMatch(/slide/);
    expect(stepLine('spell', 'tap')).not.toMatch(/slide/);
  });
});

describe('around the first steps', () => {
  it('read a step off the wire, or nothing', () => {
    expect(stepOnWire('learn')).toBe('learn');
    expect(stepOnWire('off')).toBe('off');
    expect(stepOnWire('made_up')).toBeNull();
    expect(stepOnWire(5)).toBeNull();
  });

  it('light the item a house bot of the champion would buy next, one a start can afford', () => {
    const first = suggestedItem('sylra', []);
    expect(first).not.toBeNull();
    expect(
      MAGIC_BUILD.some((target) => target === first || ITEMS[target]?.buildsFrom?.includes(first!)),
    ).toBe(true);
    expect(effectiveItemCost(first!, [])).toBeLessThanOrEqual(500);
    // Bought, the light moves on.
    expect(suggestedItem('sylra', [first!])).not.toBeNull();
    // A champion the roster does not hold (a forged one) gets the shell.
    const shell = suggestedItem('not_in_roster', []);
    expect(
      SHELL_BUILD.some((target) => target === shell || ITEMS[target]?.buildsFrom?.includes(shell!)),
    ).toBe(true);
  });

  it('are remembered by the browser: hidden, and what is done', () => {
    expect(clampSettings({}).stepsOff).toBe(false);
    expect(clampSettings({}).stepsDone).toEqual([]);
    const s = clampSettings({ stepsOff: true, stepsDone: ['learn', 3, 'learn', 'spell'] });
    expect(s.stepsOff).toBe(true);
    expect(s.stepsDone).toEqual(['learn', 'spell']);
  });
});
