// The tower's shot timeline (src/render/tower_shot.ts): the Blender
// animation's keyframes read at a time measured from the launch, the
// gather stretched onto the sim's beats and the rest at its authored pace.

import { describe, expect, it } from 'vitest';
import {
  CHARGE_AURA,
  CHARGE_END_FRAME,
  CHARGE_FRAME,
  CHARGE_PARTICLES,
  CHARGE_RINGS,
  CHARGE_S,
  chargeParticle,
  chargeRingScale,
  envelope,
  FILAMENTS,
  filamentPoint,
  frameAt,
  IMPACT_BURST,
  IMPACT_END_FRAME,
  IMPACT_FRAGMENTS,
  IMPACT_FRAME,
  impactFragments,
  impactGroundRingStartS,
  impactRingScale,
  impactRingWidth,
  LAUNCH_END_FRAME,
  LAUNCH_FLASH,
  LAUNCH_FRAME,
  LAUNCH_RINGS,
  launchRingScale,
  launchRingWidth,
  nextChargeDelayS,
  SOURCE_FPS,
} from '../src/render/tower_shot';
import { attackWindupSeconds } from '../src/sim/combat/auto_attack';

describe('an envelope', () => {
  const keys = [
    [10, 0],
    [20, 1],
    [30, 0.5],
  ] as const;

  it('reads its keys exactly and the line between them', () => {
    expect(envelope(keys, 10)).toBe(0);
    expect(envelope(keys, 20)).toBe(1);
    expect(envelope(keys, 15)).toBeCloseTo(0.5);
    expect(envelope(keys, 25)).toBeCloseTo(0.75);
  });

  it('holds flat past either end', () => {
    expect(envelope(keys, 0)).toBe(0);
    expect(envelope(keys, 99)).toBe(0.5);
    expect(envelope([], 5)).toBe(0);
  });
});

describe('the clock', () => {
  it('runs the authored pace after the launch', () => {
    expect(frameAt(0)).toBe(LAUNCH_FRAME);
    expect(frameAt((IMPACT_FRAME - LAUNCH_FRAME) / SOURCE_FPS)).toBeCloseTo(IMPACT_FRAME);
  });

  it('stretches the gather onto the window the game gives it', () => {
    expect(frameAt(-CHARGE_S)).toBeCloseTo(CHARGE_FRAME);
    // Half a second of gather still starts at the gather's first frame.
    expect(frameAt(-0.5, 0.5)).toBeCloseTo(CHARGE_FRAME);
    expect(frameAt(-0.25, 0.5)).toBeCloseTo((CHARGE_FRAME + LAUNCH_FRAME) / 2);
    // The stretch never leaks past the launch.
    expect(frameAt(0.1, 0.5)).toBeCloseTo(LAUNCH_FRAME + 3);
  });

  it('starts the next gather so it peaks on the next bolt', () => {
    const cadence = 0.83;
    const delay = nextChargeDelayS(cadence);
    expect(delay).toBeCloseTo(1 / cadence + attackWindupSeconds(cadence, false) - CHARGE_S);
    // A tower that fires faster than it gathers charges without pause.
    expect(nextChargeDelayS(5)).toBe(0);
  });
});

describe('the gather', () => {
  it('is nothing at rest, fullest just before the launch, gone after it', () => {
    expect(envelope(CHARGE_AURA, CHARGE_FRAME)).toBe(0);
    const peak = Math.max(...CHARGE_AURA.map(([, v]) => v));
    expect(envelope(CHARGE_AURA, 44)).toBe(peak);
    expect(envelope(CHARGE_AURA, 49)).toBe(0);
    expect(envelope(CHARGE_AURA, CHARGE_END_FRAME)).toBe(0);
  });

  it('opens its orbits one after another and closes them all after the launch', () => {
    let previousStart = -1;
    for (let i = 0; i < CHARGE_RINGS; i++) {
      const keys = chargeRingScale(i);
      const start = keys[0]![0];
      expect(start).toBeGreaterThan(previousStart);
      previousStart = start;
      expect(envelope(keys, start)).toBe(0);
      expect(envelope(keys, 52)).toBe(0);
      expect(envelope(keys, 44)).toBeGreaterThan(0);
    }
  });

  it('draws every mote in from two meters out to the aura, on staggered starts', () => {
    for (let i = 0; i < CHARGE_PARTICLES; i++) {
      const start = 17 + (i % 11);
      const end = 42 + (i % 3);
      expect(chargeParticle(i, start - 1)).toBeNull();
      expect(chargeParticle(i, end + 1)).toBeNull();
      const born = chargeParticle(i, start)!;
      const gone = chargeParticle(i, end)!;
      expect(Math.hypot(born.x, born.z)).toBeCloseTo(2.52);
      expect(Math.hypot(gone.x, gone.z)).toBeCloseTo(0.22);
      expect(born.scale).toBe(0);
      expect(gone.scale).toBe(0);
      expect(chargeParticle(i, start + 3)!.scale).toBe(1);
    }
  });
});

describe('the departure', () => {
  it('flashes on the launch frame and is gone five frames later', () => {
    expect(envelope(LAUNCH_FLASH, LAUNCH_FRAME - 1)).toBe(0);
    expect(envelope(LAUNCH_FLASH, LAUNCH_FRAME)).toBe(1.4);
    expect(envelope(LAUNCH_FLASH, 50)).toBe(0);
  });

  it('sends two rings out, the second two frames behind, thinning to nothing', () => {
    for (let i = 0; i < LAUNCH_RINGS; i++) {
      const scale = launchRingScale(i);
      const width = launchRingWidth(i);
      expect(envelope(scale, LAUNCH_FRAME + i * 2)).toBe(0.8);
      expect(envelope(scale, 54 + i * 2)).toBe(3.3);
      expect(envelope(width, LAUNCH_FRAME + i * 2)).toBeGreaterThan(0);
      expect(envelope(width, 54 + i * 2)).toBe(0);
      expect(54 + i * 2).toBeLessThanOrEqual(LAUNCH_END_FRAME);
    }
  });
});

describe('the missile', () => {
  it('winds three filaments from its tail to its nose, fattest at the middle', () => {
    for (let i = 0; i < FILAMENTS; i++) {
      const [x0, y0, z0] = filamentPoint(i, 0);
      const [x1, y1, z1] = filamentPoint(i, 1);
      expect(x0).toBeCloseTo(-0.55);
      expect(x1).toBeCloseTo(0.4);
      expect(Math.hypot(y0, z0)).toBeCloseTo(0);
      expect(Math.hypot(y1, z1)).toBeCloseTo(0);
      const [, ym, zm] = filamentPoint(i, 0.5);
      expect(Math.hypot(ym, zm)).toBeCloseTo(0.25);
    }
  });
});

describe('the impact', () => {
  it('bursts on the frame after the strike and is spent six frames later', () => {
    expect(envelope(IMPACT_BURST, IMPACT_FRAME - 1)).toBe(0);
    expect(envelope(IMPACT_BURST, IMPACT_FRAME + 1)).toBe(1);
    expect(envelope(IMPACT_BURST, IMPACT_FRAME + 6)).toBe(0);
  });

  it('opens three rings two frames apart, each fading as it widens', () => {
    for (let i = 0; i < 3; i++) {
      const start = 63 + i * 2;
      expect(envelope(impactRingScale(i), start + 20)).toBe(2.8);
      expect(envelope(impactRingWidth(i), start + 3)).toBe(0.023);
      expect(envelope(impactRingWidth(i), start + 20)).toBe(0);
      expect(start + 20).toBeLessThanOrEqual(IMPACT_END_FRAME);
    }
    expect(impactGroundRingStartS(0)).toBeCloseTo(1 / SOURCE_FPS);
    expect(impactGroundRingStartS(1)).toBeCloseTo(4 / SOURCE_FPS);
  });

  it('throws the same thirty-four fragments every time, every fifth one ivory', () => {
    const a = impactFragments();
    const b = impactFragments();
    expect(a).toHaveLength(IMPACT_FRAGMENTS);
    expect(a).toEqual(b);
    for (const [i, f] of a.entries()) {
      expect(Math.hypot(f.dx, f.dy, f.dz)).toBeCloseTo(1);
      expect(f.dy).toBeGreaterThanOrEqual(-0.25);
      expect(f.speed).toBeGreaterThanOrEqual(2);
      expect(f.speed).toBeLessThanOrEqual(5);
      expect(f.lifeS * SOURCE_FPS).toBeGreaterThanOrEqual(11);
      expect(f.lifeS * SOURCE_FPS).toBeLessThanOrEqual(24);
      expect(f.bright).toBe(i % 5 === 0);
    }
    expect(impactFragments(7)).not.toEqual(a);
  });
});
