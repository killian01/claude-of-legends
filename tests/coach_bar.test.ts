// The coach bar's state line (ADR 0013): what the owner reads under the
// buttons, from the order and the play the snapshot carries.

import { describe, expect, it } from 'vitest';
import { coachHint, coachLayout, describeCoachState } from '../src/ui/coach_bar';

describe('the coach bar state line', () => {
  it('names the standing order and whether the bot is on it', () => {
    expect(describeCoachState(null, null)).toEqual({
      text: 'No order. The playbook decides.',
      on: false,
    });
    expect(describeCoachState(null, 'farm')).toEqual({
      text: 'No order. Playbook: farm.',
      on: false,
    });
    expect(describeCoachState({ kind: 'warden' }, 'coach')).toEqual({
      text: 'Warden: on it.',
      on: true,
    });
    expect(describeCoachState({ kind: 'creature' }, 'coach')).toEqual({
      text: 'Ring: on it.',
      on: true,
    });
    expect(describeCoachState({ kind: 'goto', x: 1, z: 2 }, 'retreat')).toEqual({
      text: 'Go there: waiting, retreat comes first.',
      on: false,
    });
    expect(describeCoachState({ kind: 'focus', targetId: 3 }, null).text).toBe(
      'Focus: waiting, something else comes first.',
    );
  });
});

describe('the coach bar on each pointer', () => {
  it('stands out of the thumbs way on a touchscreen', () => {
    expect(coachLayout(false, 'thumbs')).toBe('mouse');
    expect(coachLayout(true, 'thumbs')).toBe('thumbs');
    expect(coachLayout(true, 'tap')).toBe('tap');
  });

  it('names the click that gives the orders with a place', () => {
    expect(coachHint('mouse', true)).toBe('Click the map: go there. Click an enemy: focus it.');
    expect(coachHint('mouse', false)).toBe(
      'Right-click the map: go there. Right-click an enemy: focus it.',
    );
    for (const layout of ['thumbs', 'tap'] as const) {
      expect(coachHint(layout, true)).toBe('Tap the map: go there. Tap an enemy: focus it.');
      expect(coachHint(layout, false)).toBe(coachHint(layout, true));
    }
  });
});
