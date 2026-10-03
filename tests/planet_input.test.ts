// The thumb's points on the planet (src/game/thumb_cast.ts, thumb_stick.ts):
// a sphere point and a tangent direction give a point along the great
// circle, on the sphere and the asked distance away; a point of the plane
// keeps the plane's arithmetic.

import { describe, expect, it } from 'vitest';
import { aimedPoint, quickPoint } from '../src/game/thumb_cast';
import { leadPoint, shouldResend } from '../src/game/thumb_stick';
import { dist, heading } from '../src/sim/geo';

const R = 80;
const at = { x: 30, y: 60, z: Math.sqrt(R * R - 30 * 30 - 60 * 60) };
const dir = heading(at, 0.7);

describe('thumb points on the planet', () => {
  it('stay on the sphere, the asked distance along the great circle', () => {
    for (const p of [
      aimedPoint(at, dir, 0.5, 8),
      leadPoint(at, dir, 3, 156),
      quickPoint(at, null, dir, 10),
    ]) {
      expect(p.y).toBeDefined();
      expect(Math.hypot(p.x, p.y ?? 0, p.z)).toBeCloseTo(R, 9);
    }
    expect(dist(at, aimedPoint(at, dir, 0.5, 8))).toBeCloseTo(4, 9);
    expect(dist(at, leadPoint(at, dir, 3, 156))).toBeCloseTo(3, 9);
    // A target is taken as it is, y included.
    const target = { x: 1, y: 2, z: 3 };
    expect(quickPoint(at, target, dir, 10)).toEqual(target);
  });

  it('keep the plane as it was', () => {
    expect(aimedPoint({ x: 10, z: 10 }, { x: 1, z: 0 }, 0.5, 8)).toEqual({ x: 14, z: 10 });
    expect(leadPoint({ x: 1, z: 1 }, { x: -1, z: 0 }, 3, 156)).toEqual({ x: 0, z: 1 });
    expect(quickPoint({ x: 5, z: 5 }, null, null, 10)).toEqual({ x: 5, z: 5 });
  });

  it('resend a stick order when a tangent direction turns', () => {
    const last = { ...dir, at: 0 };
    expect(shouldResend(last, dir, 10)).toBe(false);
    expect(shouldResend(last, heading(at, 0.7 + 0.8), 10)).toBe(true);
  });
});
