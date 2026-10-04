// After a battle royale (src/game/royale_flow.ts): Play again and the other
// rule set go straight into a match with the same pick; the rest leaves.

import { describe, expect, it } from 'vitest';
import { nextStep } from '../src/game/flow';
import { royaleNext } from '../src/game/royale_flow';

describe('after a battle royale', () => {
  it("plays the same rule set again: Respawn's Play the next match enters anew", () => {
    expect(royaleNext('again', 'respawn')).toEqual({ to: 'match', variant: 'respawn' });
    expect(royaleNext('again', 'one_life')).toEqual({ to: 'match', variant: 'one_life' });
  });

  it('tries the other rule set', () => {
    expect(royaleNext('other', 'respawn')).toEqual({ to: 'match', variant: 'one_life' });
    expect(royaleNext('other', 'one_life')).toEqual({ to: 'match', variant: 'respawn' });
  });

  it('leaves for home on the menu, and for the form on the account offer', () => {
    expect(royaleNext('menu', 'respawn')).toEqual({ to: 'home' });
    expect(royaleNext('account', 'one_life')).toEqual({ to: 'register' });
  });

  it('is home for the outer loop once its own loop is over', () => {
    for (const action of ['menu', 'again', 'account', 'other'] as const) {
      expect(nextStep(action, 'royale')).toBe('home');
    }
    // Outside a battle royale there is no other rule set to try.
    expect(nextStep('other', 'queue')).toBe('home');
    expect(nextStep('other', 'practice')).toBe('home');
  });
});
