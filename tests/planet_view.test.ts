// The planet's camera and the drop (src/render/planet_stage.ts,
// planet_drop.ts, planet_dusk.ts): the play rig keeps a fixed band of sky
// over the horizon at every zoom, the globe turns with the chart so the
// dive starts where the drop left the view, and the Dusk's caps read as
// angles.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlanetChart } from '../src/render/planet_chart';
import { diveProgress, orbitPosition } from '../src/render/planet_drop';
import { capAngle } from '../src/render/planet_dusk';
import { chartTurn, planetRig, SKY_SHARE, skyShare } from '../src/render/planet_stage';

const R = 80;

describe('the planet camera', () => {
  it('keeps the same band of sky over the horizon at every zoom', () => {
    for (const zoom of [0.65, 0.85, 1.1, 1.45]) {
      const rig = planetRig(zoom, R);
      const pitch = Math.atan2(rig.y, rig.z);
      const dist = Math.hypot(rig.y, rig.z);
      // As far as the 5v5's rig at the same zoom.
      expect(dist).toBeCloseTo(Math.hypot(40, 24) * zoom, 9);
      expect(skyShare(pitch, dist, R)).toBeCloseTo(SKY_SHARE, 4);
      // Looking down, never past straight down.
      expect(pitch).toBeGreaterThan(0.6);
      expect(pitch).toBeLessThan(Math.PI / 2);
    }
  });

  it('sees more sky the flatter it looks', () => {
    const d = 40;
    expect(skyShare(0.9, d, R)).toBeGreaterThan(skyShare(1.0, d, R));
    // Straight down from 40 m, no sky at all.
    expect(skyShare(Math.PI / 2, d, R)).toBeLessThan(0);
  });
});

describe('the drop', () => {
  it('turns the globe with the chart: a point of the planet stays where it was shown', () => {
    const p = (x: number, y: number, z: number) => {
      const d = Math.hypot(x, y, z);
      return { x: (x / d) * R, y: (y / d) * R, z: (z / d) * R };
    };
    const a = PlanetChart.around(p(0.3, 0.9, 0.2), R);
    const b = a.recentered(p(-0.5, 0.4, 0.7));
    // Shown in world space: mirror(rows . q) about the planet's center.
    const shown = (c: PlanetChart, q: { x: number; y: number; z: number }) => {
      const [e, u, n] = c.rows();
      return new THREE.Vector3(
        e.x * q.x + e.y * q.y + e.z * q.z,
        u.x * q.x + u.y * q.y + u.z * q.z,
        -(n.x * q.x + n.y * q.y + n.z * q.z),
      );
    };
    const turn = chartTurn(a, b);
    for (const q of [p(1, 0, 0), p(0.2, -0.7, 0.4), p(-0.3, 0.3, -0.9)]) {
      const moved = shown(a, q).applyMatrix3(turn);
      const want = shown(b, q);
      expect(moved.distanceTo(want)).toBeLessThan(1e-9);
    }
  });

  it('dives eased, from the globe to the ground in one go', () => {
    expect(diveProgress(-1)).toBe(0);
    expect(diveProgress(0)).toBe(0);
    expect(diveProgress(0.5)).toBeCloseTo(0.5, 12);
    expect(diveProgress(1)).toBe(1);
    expect(diveProgress(0.1)).toBeLessThan(0.1);
    expect(diveProgress(0.9)).toBeGreaterThan(0.9);
    let last = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      expect(diveProgress(t)).toBeGreaterThanOrEqual(last);
      last = diveProgress(t);
    }
  });

  it('orbits the planet at its distance', () => {
    const c = { x: 100, y: -80, z: 100 };
    const at = orbitPosition(c, { azimuth: 1.1, elevation: 0.4, distance: 270 });
    expect(Math.hypot(at.x - c.x, at.y - c.y, at.z - c.z)).toBeCloseTo(270, 9);
    expect(at.y - c.y).toBeCloseTo(270 * Math.sin(0.4), 9);
  });
});

describe('the Dusk', () => {
  it('reads a cap chord as its angle', () => {
    expect(capAngle(0, R)).toBe(0);
    expect(capAngle(2 * R, R)).toBeCloseTo(Math.PI, 12);
    expect(capAngle(500, R)).toBe(Math.PI);
    // A small cap: the chord is almost the arc.
    expect(capAngle(10, R) * R).toBeCloseTo(10, 1);
  });
});
