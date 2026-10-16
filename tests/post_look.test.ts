// The two Strikeposts read apart at a glance (src/render/post_look.ts):
// the same red ring, where a hit is aimed, on bodies of clearly different
// lightness, the plated one banded in steel.

import { describe, expect, it } from 'vitest';
import { postPalette } from '../src/render/post_look';

function lightness(rgb: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

describe('the Strikeposts look', () => {
  it('shares the ring and tells the bodies apart', () => {
    const bare = postPalette('bare');
    const plated = postPalette('plated');
    expect(plated.ring).toBe(bare.ring);
    expect(bare.bands).toBeNull();
    expect(plated.bands).not.toBeNull();
    // Steel bands stand out against the iron body they wrap.
    expect(lightness(plated.bands ?? 0) - lightness(plated.body)).toBeGreaterThan(60);
    // A steel cap against a timber one.
    expect(lightness(plated.cap) - lightness(bare.cap)).toBeGreaterThan(40);
  });
});
