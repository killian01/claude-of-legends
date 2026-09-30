// The loading card's ask to turn the phone (src/ui/turn_ask.ts): on a
// touchscreen held upright, and exactly when the wall would stand if the
// match opened at that moment.

import { describe, expect, it } from 'vitest';
import { turnWallUp } from '../src/game/orientation';
import { loadingAsksTurn, TURN_ASK, TURN_LOCK_LINE } from '../src/ui/turn_ask';

describe('the loading card asking for a turn', () => {
  it('asks a touchscreen held upright', () => {
    expect(loadingAsksTurn(true, true)).toBe(true);
  });

  it('lets a phone already sideways be', () => {
    expect(loadingAsksTurn(true, false)).toBe(false);
  });

  it('never asks a mouse, even in a tall window', () => {
    expect(loadingAsksTurn(false, true)).toBe(false);
    expect(loadingAsksTurn(false, false)).toBe(false);
  });

  it('asks exactly when the wall would stand at the opening, before any lock', () => {
    for (const coarse of [false, true]) {
      for (const portrait of [false, true]) {
        expect(loadingAsksTurn(coarse, portrait)).toBe(turnWallUp(coarse, false, portrait));
      }
    }
  });

  it('says it in the words the wall uses', () => {
    expect(TURN_ASK).toBe('Turn your phone sideways');
    expect(TURN_LOCK_LINE).toContain('Portrait Orientation Lock');
  });
});
