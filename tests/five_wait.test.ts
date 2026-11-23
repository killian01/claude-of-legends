// A 5v5 fall's wait (ui/five_wait.ts): the wash and the pause menu say when
// the champion stands at its fountain again, and, while the gold reaches
// the suggested item, that the wait is the time to buy it. The shop does
// take a fallen champion's order away from the fountain
// (tests/systems.test.ts, 'buys while dead').

import { describe, expect, it } from 'vitest';
import { type FiveWaitView, fiveBackLine, fiveShopLine } from '../src/ui/five_wait';

const VIEW: FiveWaitView = { shops: true, afford: true, shopOpen: false, guideOff: false };

describe('a 5v5 fall', () => {
  it('says when the champion is back at its fountain, never below zero', () => {
    expect(fiveBackLine(8.26)).toBe('Back at your fountain in 8.3 s');
    expect(fiveBackLine(-0.2)).toBe('Back at your fountain in 0.0 s');
  });

  it('says to shop while waiting, in the words of the input', () => {
    expect(fiveShopLine(VIEW, 'mouse')).toBe(
      'Shop while you wait: press P, the glowing item suits your champion.',
    );
    expect(fiveShopLine(VIEW, 'tap')).toBe(
      'Shop while you wait: tap Shop, the glowing item suits your champion.',
    );
    expect(fiveShopLine(VIEW, 'thumbs')).toBe(fiveShopLine(VIEW, 'tap'));
  });

  it('says nothing of the shop without the gold, with it open, in a coach seat, or with the guide hidden', () => {
    expect(fiveShopLine({ ...VIEW, afford: false }, 'mouse')).toBeNull();
    expect(fiveShopLine({ ...VIEW, shopOpen: true }, 'mouse')).toBeNull();
    expect(fiveShopLine({ ...VIEW, shops: false }, 'mouse')).toBeNull();
    expect(fiveShopLine({ ...VIEW, guideOff: true }, 'mouse')).toBeNull();
  });
});
