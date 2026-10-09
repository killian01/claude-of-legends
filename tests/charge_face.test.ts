// The button of a spell cast from charges (src/ui/charge_face.ts): the count
// in its corner, and a clock only while the store is empty or between casts.

import { describe, expect, it } from 'vitest';
import { CHAMPIONS } from '../src/sim/content/champions';
import { chargeFace } from '../src/ui/charge_face';

const pods = CHAMPIONS.nisk!.abilities.R;
const dart = CHAMPIONS.nisk!.abilities.Q;

describe('the charge count on a button', () => {
  it('shows the store, and a clock only while it is empty or between two casts', () => {
    expect(chargeFace(pods, { count: 2, nextAt: 40 }, 0, 10)).toEqual({ count: 2, remaining: -10 });
    // The beat between two casts holds the button even with charges left.
    expect(chargeFace(pods, { count: 1, nextAt: 40 }, 11, 10)).toEqual({ count: 1, remaining: 1 });
    // Empty: the clock runs to the next charge.
    expect(chargeFace(pods, { count: 0, nextAt: 25 }, 11, 10)).toEqual({ count: 0, remaining: 15 });
    // Not learned yet: nothing in store.
    expect(chargeFace(pods, undefined, 0, 10).count).toBe(0);
  });

  it('leaves a spell without charges on its cooldown', () => {
    expect(chargeFace(dart, undefined, 14, 10)).toEqual({ count: null, remaining: 4 });
    expect(chargeFace(undefined, undefined, 14, 10)).toEqual({ count: null, remaining: 4 });
  });
});
