// The Respawn wait's globe as the client shows it (src/ui/royale_return.ts,
// src/render/planet_drop.ts): when it rises over the fallen champion and
// until when, the light it faces, what the death wash says on a phone and
// on a desktop, and the orbit that looks down on that light.

import { describe, expect, it } from 'vitest';
import type { SnapDusk } from '../src/net/royale_wire';
import {
  facingOrbit,
  ORBIT_ELEVATION_MAX,
  orbitPosition,
  RETURN_ORBIT_MAX,
  RETURN_ORBIT_MIN,
  returnOrbitDistance,
} from '../src/render/planet_drop';
import { RESPAWN_S } from '../src/sim/royale/types';
import {
  RETURN_GLOBE_AFTER_S,
  returnGlobeOn,
  returnHint,
  returnLight,
} from '../src/ui/royale_return';

describe('the wait for a return', () => {
  const respawn = { v: 'respawn' as const, st: 'play' as const };
  const fellAt = 100;
  const seat = { dead: true, respawnAt: fellAt + RESPAWN_S };

  it('shows the globe a moment after the fall, and keeps it up until the champion stands', () => {
    expect(returnGlobeOn(respawn, seat, fellAt)).toBe(false);
    expect(returnGlobeOn(respawn, seat, fellAt + RETURN_GLOBE_AFTER_S - 0.05)).toBe(false);
    expect(returnGlobeOn(respawn, seat, fellAt + RETURN_GLOBE_AFTER_S)).toBe(true);
    // A slow snapshot past the return's time keeps it up, never down early.
    expect(returnGlobeOn(respawn, seat, seat.respawnAt + 0.3)).toBe(true);
    expect(returnGlobeOn(respawn, { ...seat, dead: false }, fellAt + 3)).toBe(false);
  });

  it('never shows it in One life, the drop, the end, or once a death is final', () => {
    const t = fellAt + 3;
    expect(returnGlobeOn({ v: 'one_life', st: 'play' }, seat, t)).toBe(false);
    expect(returnGlobeOn({ v: 'respawn', st: 'drop' }, seat, t)).toBe(false);
    expect(returnGlobeOn({ v: 'respawn', st: 'over' }, seat, t)).toBe(false);
    expect(returnGlobeOn({ ...respawn, fi: 1 }, seat, t)).toBe(false);
    expect(returnGlobeOn(respawn, { dead: true, respawnAt: Number.POSITIVE_INFINITY }, t)).toBe(
      false,
    );
  });

  it('says what a tap does on a phone and a click on a desktop, then that the pick holds', () => {
    expect(returnHint(true, false)).toBe('Tap the globe to choose where you come back');
    expect(returnHint(false, false)).toBe('Click the globe to choose where you come back');
    expect(returnHint(true, true)).toBe('You come back where you tapped');
    expect(returnHint(false, true)).toBe('You come back where you clicked');
    for (const touch of [true, false]) {
      for (const picked of [true, false]) {
        const words = returnHint(touch, picked);
        // No en or em dash in game text.
        expect(
          [...words].some((ch) => ch.charCodeAt(0) === 0x2013 || ch.charCodeAt(0) === 0x2014),
        ).toBe(false);
      }
    }
  });

  it('faces the light the return comes back in: the one closed to while it closes', () => {
    const dusk: SnapDusk = {
      p: 1,
      c: [0, 80, 0],
      r: 140,
      nc: [80, 0, 0],
      nr: 110,
      pe: 200,
      sh: 0,
      b: 0.01,
    };
    expect(returnLight(dusk)).toEqual({ c: [0, 80, 0], r: 140 });
    expect(returnLight({ ...dusk, sh: 1 })).toEqual({ c: [80, 0, 0], r: 110 });
    expect(returnLight({ p: 0, c: [0, 80, 0], r: 160, pe: 90, sh: 1, b: 0 })).toEqual({
      c: [0, 80, 0],
      r: 160,
    });
  });
});

describe('the wait globe orbit', () => {
  it('stands over the direction it faces, off the vertical', () => {
    const center = { x: 0, y: 0, z: 0 };
    const dir = { x: 0.6, y: 0.2, z: -0.77 };
    const o = facingOrbit(dir, 200);
    const at = orbitPosition(center, o);
    const len = Math.hypot(dir.x, dir.y, dir.z);
    expect(at.x / 200).toBeCloseTo(dir.x / len, 6);
    expect(at.y / 200).toBeCloseTo(dir.y / len, 6);
    expect(at.z / 200).toBeCloseTo(dir.z / len, 6);
    expect(facingOrbit({ x: 0, y: 1, z: 0 }, 200).elevation).toBe(ORBIT_ELEVATION_MAX);
    expect(facingOrbit({ x: 0, y: -1, z: 0 }, 200).elevation).toBe(-ORBIT_ELEVATION_MAX);
  });

  it('shows the whole globe while the light is wide, nearer as it narrows', () => {
    expect(returnOrbitDistance(160)).toBe(RETURN_ORBIT_MAX);
    expect(returnOrbitDistance(110)).toBe(RETURN_ORBIT_MAX);
    expect(returnOrbitDistance(28)).toBeLessThan(returnOrbitDistance(50));
    expect(returnOrbitDistance(0)).toBe(RETURN_ORBIT_MIN);
  });
});
