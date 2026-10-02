// The Dusk's schedule (src/sim/royale/dusk.ts, content/dusk.ts): five
// caps each inside the one before around a final point on open ground,
// the calm, the closing at a fifth of a champion's speed, the burn by
// phase, the dark at the end, all from the match's seed.

import { describe, expect, it } from 'vitest';
import { DUSK_EDGE_SPEED, DUSK_PHASES } from '../src/sim/content/dusk';
import { dist } from '../src/sim/geo';
import { Rng } from '../src/sim/rng';
import {
  darkBurn,
  depthInside,
  drawDusk,
  duskAt,
  insideCap,
  maxShift,
} from '../src/sim/royale/dusk';
import { nearPole } from '../src/sim/royale/layout';
import { CALM_S, PLAY_S } from '../src/sim/royale/types';
import { fakeGround, fakeLayout, R } from './royale_fixture';

const layout = fakeLayout();
const LAND = 10;

function draw(seed: number) {
  return drawDusk(new Rng(seed), layout, fakeGround, LAND);
}

describe('the Dusk table', () => {
  it('runs from the calm to the last light without a gap', () => {
    expect(DUSK_PHASES).toHaveLength(5);
    expect(DUSK_PHASES[0]!.closeFrom).toBe(CALM_S);
    expect(DUSK_PHASES[4]!.holdTo).toBe(PLAY_S);
    for (let k = 0; k < DUSK_PHASES.length; k++) {
      const p = DUSK_PHASES[k]!;
      expect(p.closeTo).toBeGreaterThan(p.closeFrom);
      expect(p.holdTo).toBeGreaterThan(p.closeTo);
      if (k > 0) {
        expect(p.closeFrom).toBe(DUSK_PHASES[k - 1]!.holdTo);
        expect(p.radius).toBeLessThan(DUSK_PHASES[k - 1]!.radius);
      }
    }
    expect(DUSK_PHASES.map((p) => p.burn)).toEqual([0.01, 0.02, 0.04, 0.07, 0.12]);
  });

  it('closes at about a fifth of a champion speed', () => {
    expect(DUSK_EDGE_SPEED).toBeCloseTo(3.7 / 5, 1);
    for (let k = 1; k <= DUSK_PHASES.length; k++) {
      const p = DUSK_PHASES[k - 1]!;
      const before = k === 1 ? 2 * R : DUSK_PHASES[k - 2]!.radius;
      const speed = (before - p.radius + maxShift(k, R)) / (p.closeTo - p.closeFrom);
      expect(speed).toBeLessThanOrEqual(DUSK_EDGE_SPEED * 1.05);
      expect(speed).toBeGreaterThan(DUSK_EDGE_SPEED * 0.5);
    }
  });
});

describe('the drawn caps', () => {
  it('nest around a final point on open ground, away from the poles', () => {
    for (const seed of [1, 2, 3, 42, 977]) {
      const s = draw(seed);
      expect(fakeGround.walkable(s.final)).toBe(true);
      expect(nearPole(s.final, R)).toBe(false);
      expect(s.caps[0]!.radius).toBe(2 * R);
      for (let k = 1; k < s.caps.length; k++) {
        const outer = s.caps[k - 1]!;
        const inner = s.caps[k]!;
        expect(Math.hypot(inner.center.x, inner.center.y, inner.center.z)).toBeCloseTo(R, 6);
        expect(dist(outer.center, inner.center) + inner.radius).toBeLessThanOrEqual(
          outer.radius + 1e-9,
        );
        expect(insideCap(inner, s.final)).toBe(true);
      }
    }
  });

  it('is the seed: the same seed draws the same Dusk, another a different one', () => {
    expect(draw(5)).toEqual(draw(5));
    expect(draw(5).final).not.toEqual(draw(6).final);
  });
});

describe('the Dusk over time', () => {
  const s = draw(11);

  it('is calm, the whole planet lit, until the first phase closes', () => {
    const d = duskAt(s, LAND + 30);
    expect(d.phase).toBe(0);
    expect(d.burn).toBe(0);
    expect(d.shrinking).toBe(false);
    expect(d.now.radius).toBe(2 * R);
    expect(d.next).toEqual(s.caps[1]);
    expect(d.phaseEndsAt).toBe(LAND + CALM_S);
    // Every point of the planet is inside the whole-planet cap.
    const anti = { x: -s.caps[1]!.center.x, y: -s.caps[1]!.center.y, z: -s.caps[1]!.center.z };
    expect(insideCap(d.now, anti)).toBe(true);
    // Before landing too.
    expect(duskAt(s, 0).phase).toBe(0);
  });

  it('closes then holds each phase, the next cap always drawn', () => {
    for (let k = 1; k <= 5; k++) {
      const p = DUSK_PHASES[k - 1]!;
      const mid = duskAt(s, LAND + (p.closeFrom + p.closeTo) / 2);
      expect(mid.phase).toBe(k);
      expect(mid.shrinking).toBe(true);
      expect(mid.burn).toBe(p.burn);
      expect(mid.next).toEqual(s.caps[k]);
      expect(mid.phaseEndsAt).toBe(LAND + p.closeTo);
      expect(mid.now.radius).toBeLessThan(s.caps[k - 1]!.radius);
      expect(mid.now.radius).toBeGreaterThan(s.caps[k]!.radius);
      const hold = duskAt(s, LAND + (p.closeTo + p.holdTo) / 2);
      expect(hold.phase).toBe(k);
      expect(hold.shrinking).toBe(false);
      expect(hold.now).toEqual(s.caps[k]);
      expect(hold.next).toEqual(k < 5 ? s.caps[k + 1] : null);
      expect(hold.phaseEndsAt).toBe(LAND + p.holdTo);
    }
  });

  it('keeps the closing cap between the cap before and the one it closes to', () => {
    for (let k = 1; k <= 5; k++) {
      const p = DUSK_PHASES[k - 1]!;
      const outer = s.caps[k - 1]!;
      const inner = s.caps[k]!;
      let last = duskAt(s, LAND + p.closeFrom);
      for (let i = 1; i <= 40; i++) {
        const t = LAND + p.closeFrom + ((p.closeTo - p.closeFrom) * i) / 40;
        const d = duskAt(s, t - 1e-9);
        expect(dist(d.now.center, outer.center) + d.now.radius).toBeLessThanOrEqual(
          outer.radius + 1e-6,
        );
        expect(dist(d.now.center, inner.center) + inner.radius).toBeLessThanOrEqual(
          d.now.radius + 1e-6,
        );
        // The edge never outruns a fifth of a champion.
        const dt = (p.closeTo - p.closeFrom) / 40;
        const edge = last.now.radius - d.now.radius + dist(last.now.center, d.now.center);
        expect(edge / dt).toBeLessThanOrEqual(DUSK_EDGE_SPEED * 1.1);
        last = d;
      }
    }
  });

  it('goes dark at the end, and the dark burns harder as it lasts', () => {
    const d = duskAt(s, LAND + PLAY_S);
    expect(d.phase).toBe(6);
    expect(d.next).toBeNull();
    expect(insideCap(d.now, s.final)).toBe(false);
    expect(d.burn).toBeCloseTo(0.12, 9);
    expect(darkBurn(25)).toBeGreaterThan(darkBurn(5));
  });

  it('measures how deep inside the light a point stands', () => {
    const cap = s.caps[3]!;
    expect(depthInside(cap, cap.center)).toBeCloseTo(cap.radius, 9);
    expect(insideCap(cap, cap.center)).toBe(true);
    const anti = { x: -cap.center.x, y: -cap.center.y, z: -cap.center.z };
    expect(depthInside(cap, anti)).toBeLessThan(0);
    expect(insideCap(cap, anti)).toBe(false);
  });
});
