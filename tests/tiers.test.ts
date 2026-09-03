// The tiers (src/net/tiers.ts): the bands of a rating, monotonic, the base
// rating a Regular, the next tier known.

import { describe, expect, it } from 'vitest';
import { BASE_RATING } from '../server/rating';
import { nextTier, TIERS, tierOf } from '../src/net/tiers';

describe('the tiers', () => {
  it('band a rating, monotonic from the Recruit up', () => {
    expect(tierOf(BASE_RATING).name).toBe('Regular');
    expect(tierOf(BASE_RATING - 1).name).toBe('Recruit');
    expect(tierOf(0).name).toBe('Recruit');
    expect(tierOf(1150).name).toBe('Veteran');
    expect(tierOf(1299).name).toBe('Elite');
    expect(tierOf(1300).name).toBe('Legend');
    expect(tierOf(2000).name).toBe('Legend');
    for (let i = 1; i < TIERS.length; i++) expect(TIERS[i]!.min).toBeGreaterThan(TIERS[i - 1]!.min);
    expect(nextTier(1150)?.name).toBe('Elite');
    expect(nextTier(1300)).toBeNull();
  });
});
