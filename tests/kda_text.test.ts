// The K/D/A over a career reads per match, not as totals.

import { describe, expect, it } from 'vitest';
import { kdaPerMatch, perMatch } from '../src/ui/kda_text';

describe('K/D/A per match', () => {
  it('divides by the games, one decimal, whole numbers bare', () => {
    expect(perMatch(176, 40)).toBe('4.4');
    expect(perMatch(80, 40)).toBe('2');
    expect(perMatch(0, 0)).toBe('0');
    expect(perMatch(7, 0)).toBe('0');
  });

  it('reads as one line', () => {
    expect(kdaPerMatch(176, 84, 240, 40)).toBe('4.4 / 2.1 / 6');
    expect(kdaPerMatch(0, 0, 0, 0)).toBe('0 / 0 / 0');
  });
});
