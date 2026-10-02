// First steps (CONTEXT.md): what a newcomer's first matches tell them to
// do, one short line at a time, picked from what is happening and gone
// once it is done. A visitor who never played the genre lands with four
// locked spells and a lane to find, and nobody told them to learn a spell,
// to take the last hit on a minion, to throw the spell at the enemy
// champion or to back off when hurt (the seat reports, 2026-10-01: a
// minute and a half of clicks, then the tab closed).
//
// A step shows when it applies and leaves when it is done. What the player
// does on their own counts as done too, shown or not, so somebody who
// knows the game meets few of them; the browser remembers what is done
// (game/settings.ts) and the player can hide the guide for good. Pure: the
// HUD hands in what it reads of the match (StepsView) and draws the line
// this answers (ui/hud.ts).

import { STEP_IDS, type StepId } from '../net/protocol';

export type { StepId } from '../net/protocol';

// What the HUD reads of the match for the steps, every update.
export interface StepsView {
  // Match time, seconds.
  time: number;
  // The shop, a menu or the end screen covers the screen: no step starts.
  covered: boolean;
  dead: boolean;
  level: number;
  skillPoints: number;
  // Q, W or E holds a rank.
  learned: boolean;
  // A spell is cooling down, so one has been cast.
  cast: boolean;
  cs: number;
  enemyMinionNear: boolean;
  enemyChampionNear: boolean;
  // Health over maximum health, 0..1.
  hpFrac: number;
  // Inside an enemy tower's reach with no allied minion there for it to
  // shoot first.
  towerAlone: boolean;
  atFountain: boolean;
  // Gold enough for the shop's suggested item (ui/shop_suggestion.ts).
  canAffordSuggestion: boolean;
}

export interface StepsState {
  // Hidden by the player, for good until the settings bring it back.
  off: boolean;
  done: readonly StepId[];
  current: StepId | null;
  // Match time the current step came up.
  shownAt: number;
  // Match time the current step stopped applying, null while it applies.
  lapsedAt: number | null;
  // Match time the last step left: the next waits a moment.
  lastEnd: number;
}

// Health under which backing off is the step.
export const LOW_HEALTH = 0.35;
// A step that only says something stays up this long, seconds.
export const SAY_S = 8;
// The longer ones, which take a moment to read.
export const READ_S = 12;
// A step that stops applying leaves after this long, undone, and may come
// back when it applies again (the enemy champion walked off).
export const LAPSE_S = 4;
// The pause between two steps, so the card does not flicker.
export const GAP_S = 2;
// When the goal is told: once the lane is under way.
export const GOAL_AT_S = 150;
// The last hit is a knack, and a newcomer can miss it for a long while: the
// step says it for this long and lets the others come, rather than stand
// over the lane until the player hides the guide (the maintainer,
// 2026-10-02: the guide seemed to stop there).
export const LAST_HIT_S = 25;
// From when the guide says to go home and spend the gold the champion
// carries: once the lane has had a moment.
export const GO_SHOP_AT_S = 75;
// Backing off when hurt comes before any other step: it takes the card
// from whatever is up, which comes back later.

interface StepRule {
  // It applies now.
  when(v: StepsView, done: readonly StepId[]): boolean;
  // It is done, given how long it has been up.
  over(v: StepsView, upFor: number): boolean;
  // The player did it on their own: done, whether or not it ever showed.
  did?(v: StepsView): boolean;
}

const RULES: Readonly<Record<StepId, StepRule>> = {
  learn: {
    when: (v) => v.skillPoints > 0 && !v.learned,
    over: (v) => v.learned,
    did: (v) => v.learned,
  },
  low_health: {
    when: (v) => !v.dead && v.hpFrac < LOW_HEALTH,
    over: (v, up) => v.dead || v.hpFrac > 0.6 || up >= SAY_S,
  },
  spell: {
    when: (v) => v.learned && v.enemyChampionNear && !v.cast,
    over: (v) => v.cast,
  },
  last_hit: {
    when: (v) => v.enemyMinionNear && v.cs === 0,
    over: (v, up) => v.cs > 0 || up >= LAST_HIT_S,
    did: (v) => v.cs > 0,
  },
  tower: {
    when: (v) => v.towerAlone,
    over: (v, up) => up >= SAY_S || (!v.towerAlone && up >= 3),
  },
  level_up: {
    when: (v) => v.learned && v.skillPoints > 0,
    over: (v) => v.skillPoints === 0,
    did: (v) => v.level >= 2 && v.learned && v.skillPoints === 0,
  },
  // Gold for the suggested item in the lane: going home to spend it is
  // what nothing else told a newcomer.
  go_shop: {
    when: (v) => !v.atFountain && v.canAffordSuggestion && v.time >= GO_SHOP_AT_S,
    over: (v, up) => v.atFountain || !v.canAffordSuggestion || up >= READ_S + SAY_S,
  },
  gold: {
    when: (v) => v.atFountain && v.canAffordSuggestion && v.time >= 60,
    over: (v, up) => !v.canAffordSuggestion || up >= READ_S,
  },
  goal: {
    when: (v, done) => v.time >= GOAL_AT_S && done.includes('last_hit'),
    over: (_v, up) => up >= READ_S,
  },
};

export function stepsStart(off: boolean, done: readonly string[]): StepsState {
  return {
    off,
    done: STEP_IDS.filter((id) => done.includes(id)),
    current: null,
    shownAt: 0,
    lapsedAt: null,
    lastEnd: -GAP_S,
  };
}

// Every step done: nothing left to lead through.
export function stepsFinished(s: StepsState): boolean {
  return s.off || s.done.length === STEP_IDS.length;
}

// One update: what the player did on their own is done, the step up is
// kept, ended or lapsed, and with none up the first that applies comes up.
export function stepSteps(s: StepsState, v: StepsView): StepsState {
  if (s.off) return s;
  let done = s.done;
  for (const id of STEP_IDS) {
    if (!done.includes(id) && RULES[id].did?.(v)) done = [...done, id];
  }
  let next: StepsState = done === s.done ? s : { ...s, done };
  if (
    next.current !== 'low_health' &&
    !done.includes('low_health') &&
    !v.covered &&
    RULES.low_health.when(v, done)
  ) {
    return { ...next, current: 'low_health', shownAt: v.time, lapsedAt: null };
  }
  const current = next.current;
  if (current !== null) {
    const rule = RULES[current];
    if (done.includes(current) || rule.over(v, v.time - next.shownAt)) {
      return {
        ...next,
        done: done.includes(current) ? done : [...done, current],
        current: null,
        lapsedAt: null,
        lastEnd: v.time,
      };
    }
    if (!rule.when(v, done)) {
      if (next.lapsedAt === null) return { ...next, lapsedAt: v.time };
      if (v.time - next.lapsedAt >= LAPSE_S) {
        return { ...next, current: null, lapsedAt: null, lastEnd: v.time };
      }
      return next;
    }
    return next.lapsedAt === null ? next : { ...next, lapsedAt: null };
  }
  if (v.covered || v.dead || v.time - next.lastEnd < GAP_S) return next;
  for (const id of STEP_IDS) {
    if (done.includes(id) || !RULES[id].when(v, done)) continue;
    next = { ...next, current: id, shownAt: v.time, lapsedAt: null };
    break;
  }
  return next;
}

// The player hid the guide.
export function hideSteps(s: StepsState): StepsState {
  return { ...s, off: true, current: null };
}

// How the player plays: a mouse and keys, or a phone tapping or with the
// two thumbs (game/settings.ts touchScheme).
export type StepsInput = 'mouse' | 'tap' | 'thumbs';

export const STEPS_TITLE = 'First steps';
export const STEPS_HIDE = 'Hide guide';

const MOUSE: Readonly<Record<StepId, string>> = {
  learn: 'Learn your first spell: click the + on Q, W or E.',
  low_health: 'Low health: back off, or press B to go home and heal.',
  spell: 'An enemy champion: press Q, W or E to cast at your cursor.',
  last_hit: 'Hit enemy minions as their health runs out: the last hit pays gold and points.',
  tower: 'Enemy towers hit hard: let your minions walk in first.',
  level_up: 'New level: click the + on a spell to make it stronger.',
  go_shop: 'Gold to spend: press B to go home, then buy the glowing item in the shop.',
  gold: 'Gold to spend: press P, the glowing item suits your champion.',
  goal: 'The goal: take the towers down a lane with your minions, then the enemy Sanctum.',
};

const TOUCH: Readonly<Partial<Record<StepId, string>>> = {
  learn: 'Learn your first spell: tap the + on a spell.',
  low_health: 'Low health: back off, or tap Recall to go home and heal.',
  level_up: 'New level: tap the + on a spell to make it stronger.',
  go_shop: 'Gold to spend: tap Recall to go home, then buy the glowing item in the Shop.',
  gold: 'Gold to spend: tap Shop, the glowing item suits your champion.',
};

export function stepLine(id: StepId, input: StepsInput): string {
  if (input === 'mouse') return MOUSE[id];
  if (id === 'spell') {
    return input === 'thumbs'
      ? 'An enemy champion: tap a spell to cast it, or slide it to aim.'
      : 'An enemy champion: tap a spell, then tap where to cast it.';
  }
  return TOUCH[id] ?? MOUSE[id];
}
