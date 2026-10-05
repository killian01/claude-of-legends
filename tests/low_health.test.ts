// The low-health frame (src/render/low_health.ts): shown under 30 percent
// health, stronger as death comes closer, pulsing; its opacity over a red
// painted at full strength is the strength the frame's red used to carry.

import { describe, expect, it } from 'vitest';
import { LOW_HEALTH_STYLE, lowHealthOpacity } from '../src/render/low_health';

// The frame's red alpha as the renderer used to write it into the gradient.
function former(hpFrac: number, now: number): number {
  const danger = 1 - hpFrac / 0.3;
  return (0.22 + 0.18 * danger + 0.1 * Math.sin(now * 0.008)) * (0.6 + 0.4 * danger);
}

describe('the low-health frame', () => {
  it('stays away at 30 percent and above', () => {
    expect(lowHealthOpacity(0.3, 0)).toBeNull();
    expect(lowHealthOpacity(1, 0)).toBeNull();
  });

  it('shows the strength the gradient used to carry', () => {
    for (const hp of [0.29, 0.2, 0.1, 0.01, 0]) {
      for (const now of [0, 120, 500, 9_999]) {
        expect(lowHealthOpacity(hp, now)).toBeCloseTo(former(hp, now), 12);
      }
    }
  });

  it('grows stronger as death comes closer', () => {
    const now = 1000;
    const a = lowHealthOpacity(0.25, now)!;
    const b = lowHealthOpacity(0.1, now)!;
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(1);
  });

  it('is painted once at full strength, fading from clear, and starts hidden', () => {
    expect(LOW_HEALTH_STYLE).toContain('transparent 45%');
    expect(LOW_HEALTH_STYLE).toContain('rgba(150,20,10,1) 100%');
    expect(LOW_HEALTH_STYLE).toContain('opacity:0;');
  });
});
