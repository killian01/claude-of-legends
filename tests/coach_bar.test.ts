// The coach bar's state line (ADR 0013): what the owner reads under the
// buttons, from the order and the play the snapshot carries.

import { describe, expect, it } from 'vitest';
import { describeCoachState } from '../src/ui/coach_bar';

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
