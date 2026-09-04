// The tier emblem's pure part (src/ui/tier_emblem.ts): one style per
// tier, pips climbing with the tier, the art's path.

import { describe, expect, it } from 'vitest';
import { TIERS } from '../src/net/tiers';
import { emblemArtUrl, tierIndex, tierStyle } from '../src/ui/tier_emblem';

describe('the tier emblem', () => {
  it('climbs one pip per tier from the Recruit, the Legend alone glowing', () => {
    expect(TIERS.map((t) => tierStyle(t.name).pips)).toEqual([0, 1, 2, 3, 4]);
    expect(TIERS.map((t) => tierStyle(t.name).glow !== null)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    const colors = new Set(TIERS.map((t) => tierStyle(t.name).color));
    expect(colors.size).toBe(TIERS.length);
  });

  it('reads an unknown name as the Recruit', () => {
    expect(tierIndex('Nobody')).toBe(0);
    expect(tierStyle('Nobody')).toEqual(tierStyle('Recruit'));
  });

  it('names the art file after the tier, lower case, under the icons', () => {
    expect(emblemArtUrl('Veteran')).toBe('/icons/tiers/veteran.webp');
  });
});
