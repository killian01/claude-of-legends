// The planet's columns and caches as the loud moments draw them
// (src/render/planet_marks.ts): every Seedfall on the wire stands a
// column, counting down to its landing and lit once landed, only in play;
// a cache's look grows from plain to golden to a Seedfall's.

import { describe, expect, it } from 'vitest';
import type { SnapRoyale } from '../src/net/royale_wire';
import { cacheLook, PlanetMarks } from '../src/render/planet_marks';
import { countdownRings, PILLAR_LOOKS } from '../src/render/planet_pillars';
import { SEEDFALL_IMPACT_M, SEEDFALL_WARN_S } from '../src/sim/content/royale_events';

const base: SnapRoyale = {
  v: 'one_life',
  st: 'play',
  de: 10,
  end: 610,
  dusk: { p: 1, c: [0, 80, 0], r: 120, pe: 200, sh: 0, b: 0.01 },
  alive: 40,
  people: 1,
};

describe('the Seedfall columns', () => {
  it('stand one a Seedfall, with its landing and whether it landed', () => {
    const pillars = PlanetMarks.pillarsOf({
      ...base,
      sf: [
        [1, 10, 79, 2, 150, 0],
        [2, -5, 70, 30, 120, 1],
      ],
    });
    expect(pillars).toEqual([
      { kind: 'seedfall', at: { x: 10, y: 79, z: 2 }, until: 150, lit: false },
      { kind: 'seedfall', at: { x: -5, y: 70, z: 30 }, until: 120, lit: true },
    ]);
  });

  it('stand none through the drop, or without a block', () => {
    expect(PlanetMarks.pillarsOf({ ...base, st: 'drop', sf: [[1, 0, 80, 0, 9, 0]] })).toEqual([]);
    expect(PlanetMarks.pillarsOf(base)).toEqual([]);
    expect(PlanetMarks.pillarsOf(null)).toEqual([]);
  });
});

describe("the Seedfall's countdown ring", () => {
  const look = PILLAR_LOOKS.seedfall!;

  it("closes onto the impact's reach by the landing, and the still ring stands at it", () => {
    expect(look.reach).toBe(SEEDFALL_IMPACT_M);
    const landing = countdownRings(look, 140, 140);
    expect(landing.closing).toBeCloseTo(SEEDFALL_IMPACT_M);
    expect(landing.still).toBeCloseTo(SEEDFALL_IMPACT_M);
  });

  it('starts wider when called and closes steadily', () => {
    const called = countdownRings(look, 140, 140 - SEEDFALL_WARN_S);
    const half = countdownRings(look, 140, 140 - SEEDFALL_WARN_S / 2);
    expect(called.closing).toBeGreaterThan(half.closing);
    expect(half.closing).toBeGreaterThan(SEEDFALL_IMPACT_M);
    expect(called.still).toBe(SEEDFALL_IMPACT_M);
    // Past the landing it stays on the reach.
    expect(countdownRings(look, 140, 150).closing).toBeCloseTo(SEEDFALL_IMPACT_M);
  });
});

describe('the caches', () => {
  it('grow from plain to golden to a Seedfall cache', () => {
    const [plain, golden, seedfall] = [0, 1, 2].map(cacheLook);
    expect(golden!.scale).toBeGreaterThan(plain!.scale);
    expect(seedfall!.scale).toBeGreaterThan(golden!.scale);
    // An unknown kind draws plain.
    expect(cacheLook(7)).toEqual(plain);
  });
});
