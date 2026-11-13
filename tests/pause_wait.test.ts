// The pause menu over a fall (ui/pause_menu.ts pauseWaitLine): in Respawn,
// while the own champion is down and the match goes on, the title's row
// says when it comes back and that it keeps its level and build; nowhere
// else.

import { describe, expect, it } from 'vitest';
import { pauseWaitLine } from '../src/ui/pause_menu';

describe('the pause menu over a fall', () => {
  it('says when a Respawn champion comes back, with its level and build', () => {
    expect(pauseWaitLine('respawn', true, false, 3.24)).toBe(
      'Back in 3.2 s with your level and build',
    );
  });

  it('never counts below zero while the return is on its way', () => {
    expect(pauseWaitLine('respawn', true, false, -0.3)).toBe(
      'Back in 0.0 s with your level and build',
    );
  });

  it('says nothing while the champion stands', () => {
    expect(pauseWaitLine('respawn', false, false, -40)).toBeNull();
  });

  it('says nothing in One life, where a fall is the end, or in a 5v5', () => {
    expect(pauseWaitLine('one_life', true, false, 999)).toBeNull();
    expect(pauseWaitLine(null, true, false, 4)).toBeNull();
  });

  it('says nothing once the match is over', () => {
    expect(pauseWaitLine('respawn', true, true, 2)).toBeNull();
  });
});
