// What keeps a structure a structure on screen (src/render/structure_fire.ts).

import { describe, expect, it } from 'vitest';
import {
  CROWN,
  crownHeight,
  crownLift,
  flightProgress,
  isStill,
  STILL_KINDS,
} from '../src/render/structure_fire';

describe('what stands still', () => {
  it('is the towers and the Sanctum, nothing that walks or prowls', () => {
    expect([...STILL_KINDS].sort()).toEqual(['sanctum', 'tower']);
    expect(isStill('tower')).toBe(true);
    expect(isStill('sanctum')).toBe(true);
    for (const kind of ['champion', 'minion', 'camp', 'creature', 'warden']) {
      expect(`${kind}: ${isStill(kind)}`).toBe(`${kind}: false`);
    }
  });
});

const from = { x: 0, z: 0 };
const target = { x: 8, z: 0 };

describe('how far along its flight a bolt is', () => {
  it('is nothing at the structure and everything at the victim', () => {
    expect(flightProgress(from, from, target, 0.8)).toBe(0);
    // The sim ends a homing bolt at the body's edge, not at its center.
    expect(flightProgress(from, { x: 7.2, z: 0 }, target, 0.8)).toBe(1);
    expect(flightProgress(from, target, target, 0.8)).toBe(1);
  });

  it('is measured by distance, from the structure to the edge of the body', () => {
    expect(flightProgress(from, { x: 3.6, z: 0 }, target, 0.8)).toBeCloseTo(0.5);
    // A victim that walked closer shortens what is left, not what was flown.
    expect(flightProgress(from, { x: 3.6, z: 0 }, { x: 6, z: 0 }, 0.8)).toBeCloseTo(
      3.6 / (3.6 + 1.6),
    );
  });

  it('is everything when there is nowhere left to go', () => {
    expect(flightProgress(from, from, from, 0.8)).toBe(1);
  });
});

describe('how high the bolt flies', () => {
  it('is born at the crown and strikes on the flight line', () => {
    expect(crownHeight(10)).toBeCloseTo(10 * CROWN);
    expect(crownLift(10, 1.2, 0)).toBeCloseTo(10 * CROWN - 1.2);
    expect(crownLift(10, 1.2, 0.5)).toBeCloseTo((10 * CROWN - 1.2) / 2);
    expect(crownLift(10, 1.2, 1)).toBe(0);
  });

  it('never dips below the line, whatever the progress or the height', () => {
    expect(crownLift(10, 1.2, 1.5)).toBe(0);
    expect(crownLift(10, 1.2, -1)).toBeCloseTo(10 * CROWN - 1.2);
    // A structure shorter than the flight line fires from the line.
    expect(crownLift(1, 1.2, 0)).toBe(0);
  });
});
