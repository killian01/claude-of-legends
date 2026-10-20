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
  RETURN_GLOBE_RIGHT,
  RETURN_ORBIT_MAX,
  RETURN_ORBIT_MIN,
  returnOrbitDistance,
  thornyardFacing,
} from '../src/render/planet_drop';
import { PLANET_RADIUS } from '../src/render/planet_ground';
import { RESPAWN_S } from '../src/sim/royale/types';
import { overlaps } from '../src/ui/royale_layout';
import {
  RETURN_ANNOUNCE_GAP_PX,
  RETURN_GLOBE_AFTER_S,
  RETURN_GLOBE_HALF_VH,
  RETURN_WASH_BAR_GAP_PX,
  RETURN_WASH_GAP_VH,
  returnAnnounceMaxCss,
  returnAnnounceMaxPx,
  returnGlobeOn,
  returnHint,
  returnLight,
  returnWashColumnPx,
  returnWashLeftCss,
  returnWashLeftPx,
  returnWashPhoneBox,
  waitMarks,
} from '../src/ui/royale_return';
import { TOUCH_BAR_CSS, touchBarLeftBox } from '../src/ui/touch_bar';

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

  it('never shows it in One life, the drop or the end', () => {
    const t = fellAt + 3;
    expect(returnGlobeOn({ v: 'one_life', st: 'play' }, seat, t)).toBe(false);
    expect(returnGlobeOn({ v: 'respawn', st: 'drop' }, seat, t)).toBe(false);
    expect(returnGlobeOn({ v: 'respawn', st: 'over' }, seat, t)).toBe(false);
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

describe("the wait globe's marks", () => {
  const dusk: SnapDusk = { p: 0, c: [0, 80, 0], r: 60, pe: 90, sh: 0, b: 0 };
  const fell = { x: 0, y: 80, z: 0 };

  it('marks the fall, the pick (the tap before the echo) and the Burr carrier while it lasts', () => {
    const view = {
      st: 'play' as const,
      dusk,
      bk: [3, 79.9, 0] as [number, number, number],
      bu: { i: 7, u: 140, at: [10, 79.3, 0] as [number, number, number] },
    };
    const m = waitMarks(view, 100, null, fell, 80);
    expect(m.fell).toEqual(fell);
    expect(m.pick).toEqual({ x: 3, y: 79.9, z: 0 });
    expect(m.burr).toEqual({ x: 10, y: 79.3, z: 0 });
    // The own tap shows before the server echoes it.
    expect(waitMarks(view, 100, { x: 1, y: 80, z: 0 }, fell, 80).pick).toEqual({
      x: 1,
      y: 80,
      z: 0,
    });
    // The Burr run out, or its carrier down: no dot.
    expect(waitMarks(view, 141, null, fell, 80).burr).toBeNull();
    expect(waitMarks({ ...view, bu: { i: 7, u: 140 } }, 100, null, fell, 80).burr).toBeNull();
    expect(waitMarks({ st: 'play', dusk }, 100, null, null, 80)).toEqual({
      pick: null,
      fell: null,
      burr: null,
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

  it("faces a Thornfray Lull's Thornyard, never a battle royale drop's whole planet", () => {
    // The battle royale's calm cap spans the planet: the drop keeps its orbit.
    expect(thornyardFacing({ p: 0, c: [0, 80, 0], r: 160 }, PLANET_RADIUS)).toBeNull();
    // A bout's first cap is its Thornyard, 40 m around a region's heart.
    expect(thornyardFacing({ p: 0, c: [3, 70, -20], r: 40 }, PLANET_RADIUS)).toEqual({
      center: { x: 3, y: 70, z: -20 },
      radius: 40,
    });
    // Only the calm's: a closing cap is the light, not the yard.
    expect(thornyardFacing({ p: 3, c: [3, 70, -20], r: 26 }, PLANET_RADIUS)).toBeNull();
  });
});

describe('the wait globe on the screen', () => {
  // The play camera's vertical field of view (render/renderer.ts).
  const FOV_DEG = 50;

  it('stands in the middle, and at its farthest orbit spans the half height the wash keeps clear of', () => {
    expect(RETURN_GLOBE_RIGHT).toBe(0);
    const edge = Math.asin(PLANET_RADIUS / RETURN_ORBIT_MAX);
    const halfVh = (50 * Math.tan(edge)) / Math.tan((FOV_DEG * Math.PI) / 360);
    expect(halfVh).toBeLessThanOrEqual(RETURN_GLOBE_HALF_VH);
    expect(halfVh).toBeGreaterThan(RETURN_GLOBE_HALF_VH - 1);
  });

  it('leaves the wash a column left of it, wide enough for its lines', () => {
    for (const [w, h] of [
      [1280, 720],
      [960, 540],
      [1920, 1080],
      [844, 390],
    ] as const) {
      const column = returnWashColumnPx(w, h);
      const globeLeft = w / 2 - (RETURN_GLOBE_HALF_VH * h) / 100;
      expect(column).toBeGreaterThanOrEqual(250);
      expect(globeLeft - column).toBeCloseTo((RETURN_WASH_GAP_VH * h) / 100, 6);
    }
  });

  // Phones held sideways, each with the inset its notch adds at the left
  // (none without one), and the narrowest of them.
  const PHONES = [
    [844, 390, 47],
    [812, 375, 44],
    [932, 430, 59],
    [844, 390, 0],
    [740, 360, 0],
    [915, 412, 0],
    [667, 375, 0],
  ] as const;

  it("keeps the column clear of the touch bar's Menu and Center at the left", () => {
    for (const [w, h, safe] of PHONES) {
      const at = `${w}x${h} safe ${safe}`;
      // A battle royale's bar: Menu and Center, no Shop, Recall or Drink.
      const bar = touchBarLeftBox(h, 2, safe);
      const column = returnWashPhoneBox(w, h, true, safe);
      // The bar stands beside the column's lines, so only the edge keeps
      // them apart.
      expect(bar.top < column.bottom && bar.bottom > column.top, at).toBe(true);
      expect(overlaps(column, bar), at).toBe(false);
      expect(column.left - bar.right, at).toBe(RETURN_WASH_BAR_GAP_PX);
      // What is left holds the widest piece a line cannot break: a name of
      // 16 letters, or the goal's level with its bar.
      expect(column.right - column.left, at).toBeGreaterThanOrEqual(130);
    }
  });

  it('keeps the announcement over the globe, clear of the column, while the globe shows', () => {
    // On a phone the announcement stands 70 px down, centered, two lines of
    // 24 px at most once it wraps (ui/hud.ts).
    for (const [w, h, safe] of PHONES) {
      const at = `${w}x${h} safe ${safe}`;
      const column = returnWashPhoneBox(w, h, true, safe);
      const max = returnAnnounceMaxPx(h);
      const announce = { left: w / 2 - max / 2, top: 70, right: w / 2 + max / 2, bottom: 118 };
      expect(overlaps(column, announce), at).toBe(false);
      expect(announce.left - column.right, at).toBeCloseTo(RETURN_ANNOUNCE_GAP_PX, 6);
      // Room for a name of 16 letters at its 20 px on a line of its own.
      expect(max, at).toBeGreaterThanOrEqual(190);
    }
    expect(returnAnnounceMaxCss()).toBe(
      `calc(2 * (${RETURN_GLOBE_HALF_VH + RETURN_WASH_GAP_VH} * var(--vh, 1vh) - ${RETURN_ANNOUNCE_GAP_PX}px))`,
    );
  });

  it('ran over the end of the recap as wide as a phone let it (844x390)', () => {
    // "You took down Sorrel" at 20 px, 260 px wide, over a recap on two
    // lines from y 70.
    const column = returnWashPhoneBox(844, 390, true);
    expect(overlaps(column, { left: 292, top: 70, right: 552, bottom: 94 })).toBe(true);
  });

  it('ran under both from the edge before (844x390)', () => {
    const bar = touchBarLeftBox(390, 2);
    expect(bar.left).toBe(8);
    expect(overlaps(returnWashPhoneBox(844, 390, false), bar)).toBe(true);
  });

  it("starts at the screen's edge with the bar at the right", () => {
    expect(returnWashLeftPx(false, 47)).toBe(0);
    expect(returnWashPhoneBox(844, 390, false).left).toBe(0);
  });

  it('draws the clearance and the bar from the same numbers the boxes use', () => {
    expect(returnWashLeftCss()).toBe(
      `calc(${returnWashLeftPx(true)}px + var(--safe-left, env(safe-area-inset-left, 0px)))`,
    );
    const bar = touchBarLeftBox(390, 2);
    expect(TOUCH_BAR_CSS).toContain(`width: ${bar.right - bar.left}px`);
    expect(TOUCH_BAR_CSS).toMatch(/\.touchbar\.left \{[^}]*top: 38%/);
  });
});
