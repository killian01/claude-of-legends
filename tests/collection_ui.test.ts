// What the three surfaces read off one fetch (ADR 0018): why a champion
// is playable, what it costs, and how far off it is. Pure, so the wall's
// wording is pinned without a DOM.

import { describe, expect, it } from 'vitest';
import {
  affordable,
  type CollectionState,
  matchesAway,
  playable,
  priceOf,
  standingLine,
  standingOf,
} from '../src/ui/collection';

const state: CollectionState = {
  laurels: 520,
  collection: ['torv', 'fenn', 'ashvyn', 'sylra'],
  rotation: ['korrath', 'dain', 'rhoka'],
  prices: { korrath: 800, vesk: 800, dain: 500, elowen: 500, maera: 500, rhoka: 500 },
};

describe('why a champion is playable', () => {
  it('separates what is held from what the week lends', () => {
    expect(standingOf(state, 'sylra')).toBe('owned');
    expect(standingOf(state, 'korrath')).toBe('rotation');
    expect(standingOf(state, 'vesk')).toBe('locked');
    // Both are playable, and the difference is what the card has to say:
    // one is kept on Monday and the other is not.
    expect(playable(state, 'korrath')).toBe(true);
    expect(playable(state, 'vesk')).toBe(false);
  });

  it('draws no wall at all without a state, which is what practice is', () => {
    expect(standingOf(null, 'vesk')).toBe('owned');
    expect(playable(null, 'vesk')).toBe(true);
    expect(priceOf(null, 'vesk')).toBeNull();
  });
});

describe('what the card says', () => {
  it('names the price instead of just refusing', () => {
    expect(standingLine(state, 'sylra')).toBe('Yours');
    expect(standingLine(state, 'korrath')).toBe('Free this week');
    expect(standingLine(state, 'vesk')).toBe('800');
  });

  it('counts the shortfall in matches, not in laurels', () => {
    // 520 held, 800 asked, a won match pays 150: two more.
    expect(matchesAway(state, 'vesk')).toBe(2);
    // Affordable is zero matches away, and so is anything not for sale.
    expect(matchesAway(state, 'dain')).toBe(0);
    expect(matchesAway(state, 'sylra')).toBe(0);
  });

  it('knows what the balance reaches', () => {
    expect(affordable(state, 'dain')).toBe(true);
    expect(affordable(state, 'vesk')).toBe(false);
    // A starter is never for sale, so it is never affordable either: the
    // shop has nothing to offer on it.
    expect(affordable(state, 'sylra')).toBe(false);
  });
});
