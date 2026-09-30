// The fog over a ring while its creature rises (src/render/ring_fog.ts):
// wide open through the whole opening, then a fade, then the usual fog.

import { describe, expect, it } from 'vitest';
import { EMERGE_S, ROAR_S } from '../src/render/pyrefang_rise';
import { RING_FOG_FADE_S, RING_FOG_OPEN_S, ringFogOpening } from '../src/render/ring_fog';

describe('the fog over a rising creature', () => {
  it('stays wide open through the emerge and the roar', () => {
    expect(RING_FOG_OPEN_S).toBeGreaterThan(EMERGE_S + ROAR_S);
    for (const age of [0, 1, EMERGE_S, EMERGE_S + ROAR_S, RING_FOG_OPEN_S]) {
      expect(ringFogOpening(age)).toBe(1);
    }
  });

  it('closes over the fade, then is the usual fog', () => {
    const half = ringFogOpening(RING_FOG_OPEN_S + RING_FOG_FADE_S / 2);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    expect(ringFogOpening(RING_FOG_OPEN_S + RING_FOG_FADE_S)).toBe(0);
    expect(ringFogOpening(120)).toBe(0);
  });

  it('opens nothing on a ring with no creature', () => {
    expect(ringFogOpening(null)).toBe(0);
    expect(ringFogOpening(-1)).toBe(0);
  });
});
