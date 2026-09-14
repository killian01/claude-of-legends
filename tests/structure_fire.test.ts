// What keeps a structure a structure on screen (src/render/structure_fire.ts).

import { describe, expect, it } from 'vitest';
import {
  CROWN,
  crownHeight,
  crownSpawnOffset,
  descentMs,
  isStill,
  MAX_DESCENT_MS,
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

describe('where the bolt is born', () => {
  it('is at the crown, straight above the sim spawn', () => {
    expect(crownHeight(10)).toBeCloseTo(10 * CROWN);
    expect(crownSpawnOffset(10, 1.2)).toEqual({ x: 0, y: 10 * CROWN - 1.2, z: 0 });
  });

  it('never sits below the flight line', () => {
    // A structure shorter than a bolt's flight height fires from the line
    // itself rather than from underground.
    expect(crownSpawnOffset(1, 1.2)).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('how long the bolt takes to come down', () => {
  it('is the whole flight', () => {
    // 8 units at 20 per second: 400 ms in the air.
    expect(descentMs(8, 20, 130)).toBeCloseTo(400);
  });

  it("is never shorter than a champion's muzzle beat", () => {
    expect(descentMs(1, 20, 130)).toBe(130);
    expect(descentMs(0, 20, 130)).toBe(130);
    expect(descentMs(8, 0, 130)).toBe(130);
    expect(descentMs(8, Number.NaN, 130)).toBe(130);
  });

  it('is never longer than a bolt could be in the air', () => {
    expect(descentMs(100, 1, 130)).toBe(MAX_DESCENT_MS);
  });
});
