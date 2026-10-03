// The planet's flat chart (src/render/planet_chart.ts): the azimuthal
// equidistant map the renderer draws the Wanderseed through, its exact
// inverse, its re-centering by parallel transport, and the bend that
// carries a chart point back onto the sphere where the planet itself is
// drawn.

import { describe, expect, it } from 'vitest';
import { bend, bendTurn, PlanetChart, unbend } from '../src/render/planet_chart';
import { offset, type Vec3 } from '../src/sim/geo';

const R = 80;

function onSphere(x: number, y: number, z: number): Vec3 {
  const d = Math.hypot(x, y, z);
  return { x: (x / d) * R, y: (y / d) * R, z: (z / d) * R };
}

function near(a: Vec3, b: Vec3, eps = 1e-9): void {
  expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(eps);
}

function arc(a: Vec3, b: Vec3): number {
  const c = (a.x * b.x + a.y * b.y + a.z * b.z) / (R * R);
  const cx = a.y * b.z - a.z * b.y;
  const cy = a.z * b.x - a.x * b.z;
  const cz = a.x * b.y - a.y * b.x;
  return R * Math.atan2(Math.hypot(cx, cy, cz) / (R * R), c);
}

// A spread of points over the whole sphere, the antipode excluded.
function samples(): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 200; i++) {
    const t = (i + 0.5) / 200;
    const y = 1 - 2 * t;
    const ring = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    out.push(onSphere(ring * Math.cos(a), y, ring * Math.sin(a)));
  }
  return out;
}

const centers: Vec3[] = [
  onSphere(0.3, 0.8, -0.2),
  onSphere(1, 0, 0),
  onSphere(0.577, 0.577, 0.577),
  onSphere(-0.2, -0.9, 0.4),
  onSphere(0, 0.05, -1),
];

describe('the planet chart', () => {
  it('round-trips every sphere point through the chart and back', () => {
    for (const c of centers) {
      const chart = PlanetChart.around(c, R);
      for (const p of samples()) {
        if (arc(p, c) > Math.PI * R - 1) continue;
        const q = chart.toChart(p);
        near(chart.fromChart(q.x, q.z), p, 1e-8);
      }
    }
  });

  it('round-trips chart points out to the far side', () => {
    const chart = PlanetChart.around(centers[0]!, R);
    for (let x = -240; x <= 240; x += 20) {
      for (let z = -240; z <= 240; z += 20) {
        if (Math.hypot(x, z) > Math.PI * R - 2) continue;
        const back = chart.toChart(chart.fromChart(x, z));
        expect(back.x).toBeCloseTo(x, 7);
        expect(back.z).toBeCloseTo(z, 7);
      }
    }
  });

  it('puts every point at its arc distance from the center', () => {
    const c = centers[2]!;
    const chart = PlanetChart.around(c, R);
    for (const p of samples()) {
      const q = chart.toChart(p);
      if (arc(p, c) > Math.PI * R - 1) continue;
      expect(Math.hypot(q.x, q.z)).toBeCloseTo(arc(p, c), 7);
    }
  });

  it('maps east to +x and north to +z, north a quarter turn left of east', () => {
    const c = centers[0]!;
    const chart = PlanetChart.around(c, R);
    // offset steps a chord: five meters of chord is a hair more of arc.
    const e = chart.toChart(offset(c, chart.east, 5) as Vec3);
    expect(e.x).toBeCloseTo(5, 2);
    expect(e.z).toBeCloseTo(0, 6);
    const n = chart.toChart(offset(c, chart.north, 5) as Vec3);
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.z).toBeCloseTo(5, 2);
    // The plane's turnLeft {-z, x} takes +x to +z: geo.ts's sphere turn.
    const up = chart.up;
    const left = {
      x: chart.east.y * up.z - chart.east.z * up.y,
      y: chart.east.z * up.x - chart.east.x * up.z,
      z: chart.east.x * up.y - chart.east.y * up.x,
    };
    near(left, chart.north, 1e-12);
  });

  it('re-centers without turning: near the new center the chart only shifts', () => {
    for (const c of centers) {
      const a = PlanetChart.around(c, R);
      for (const [qx, qz] of [
        [0.8, 0.3],
        [-0.4, 0.9],
        [3, -2],
      ] as const) {
        const b = a.recentered(a.fromChart(qx, qz));
        // The new center sits at the old chart's (qx, qz)...
        const o = a.toChart(b.center);
        expect(o.x).toBeCloseTo(qx, 9);
        expect(o.z).toBeCloseTo(qz, 9);
        // ...and a point a few meters off reads as the old chart shifted,
        // to a hair (the sphere's curvature over the step).
        for (const [dx, dz] of [
          [4, 0],
          [0, -6],
          [5, 5],
        ] as const) {
          const p = a.fromChart(qx + dx, qz + dz);
          const q = b.toChart(p);
          expect(Math.hypot(q.x - dx, q.z - dz)).toBeLessThan(0.01);
        }
      }
    }
  });

  it('re-centers along a walk without the heading drifting', () => {
    // A walk straight along the chart's +x: re-centering a meter at a
    // time keeps east pointing along the walk, the great circle's own
    // tangent, so the camera never turns on a straight road.
    let chart = PlanetChart.around(centers[0]!, R);
    const start = chart.center;
    const along = chart.east;
    for (let i = 0; i < 100; i++) chart = chart.recentered(chart.fromChart(1, 0));
    // A hundred meters down the road: the center is on the great circle
    // and east is still its tangent, both in the circle's plane.
    expect(arc(start, chart.center)).toBeCloseTo(100, 6);
    const pole = {
      x: (start.y * along.z - start.z * along.y) / R,
      y: (start.z * along.x - start.x * along.z) / R,
      z: (start.x * along.y - start.y * along.x) / R,
    };
    const c = chart.center;
    expect((c.x * pole.x + c.y * pole.y + c.z * pole.z) / R).toBeCloseTo(0, 9);
    const e = chart.east;
    expect(e.x * pole.x + e.y * pole.y + e.z * pole.z).toBeCloseTo(0, 9);
  });

  it('carries directions both ways', () => {
    const chart = PlanetChart.around(centers[3]!, R);
    for (const [x, z, dx, dz] of [
      [0, 0, 1, 0],
      [6, -3, 0.6, 0.8],
      [-20, 14, -1, 0],
    ] as const) {
      const at = chart.fromChart(x, z);
      const dir = chart.dirFromChart(x, z, dx, dz);
      // A tangent unit vector at its point.
      expect(Math.hypot(dir.x, dir.y, dir.z)).toBeCloseTo(1, 9);
      expect((dir.x * at.x + dir.y * at.y + dir.z * at.z) / R).toBeCloseTo(0, 9);
      const back = chart.dirToChart(at, dir);
      const d = Math.hypot(dx, dz);
      expect(back.x).toBeCloseTo(dx / d, 3);
      expect(back.z).toBeCloseTo(dz / d, 3);
    }
  });
});

describe('the bend', () => {
  it('lands every chart point exactly where the turned planet shows it', () => {
    // The planet is drawn on the sphere, turned by the chart's rows and
    // sunk by R: rows . p - (0, R, 0). The bent chart point must meet it.
    for (const c of centers) {
      const chart = PlanetChart.around(c, R);
      const [e, u, n] = chart.rows();
      for (const p of samples()) {
        if (arc(p, c) > Math.PI * R - 1) continue;
        const q = chart.toChart(p);
        const shown = bend(q.x, q.z, 0, R);
        const turned = {
          x: e.x * p.x + e.y * p.y + e.z * p.z,
          y: u.x * p.x + u.y * p.y + u.z * p.z - R,
          z: n.x * p.x + n.y * p.y + n.z * p.z,
        };
        near(shown, turned, 1e-8);
      }
    }
  });

  it('lifts along the normal and is almost the identity near the origin', () => {
    const h = 1.7;
    const lifted = bend(30, -12, h, R);
    const ground = bend(30, -12, 0, R);
    const nrm = bendTurn({ x: 0, y: 1, z: 0 }, 30, -12, R);
    near(
      lifted,
      { x: ground.x + nrm.x * h, y: ground.y + nrm.y * h, z: ground.z + nrm.z * h },
      1e-9,
    );
    const close = bend(0.5, 0.25, 0, R);
    expect(close.x).toBeCloseTo(0.5, 4);
    expect(close.z).toBeCloseTo(0.25, 4);
    expect(close.y).toBeCloseTo(0, 2);
    near(bend(0, 0, 2, R), { x: 0, y: 2, z: 0 });
  });

  it('agrees with its closed form on the sphere of radius R + h', () => {
    for (const [x, z, h] of [
      [10, 0, 0],
      [-40, 25, 3],
      [100, -150, 0.5],
    ] as const) {
      const r = Math.hypot(x, z);
      const phi = r / R;
      const expected = {
        x: ((R + h) * Math.sin(phi) * x) / r,
        y: -R + (R + h) * Math.cos(phi),
        z: ((R + h) * Math.sin(phi) * z) / r,
      };
      near(bend(x, z, h, R), expected, 1e-9);
      const back = unbend(bend(x, z, h, R), R);
      expect(back.x).toBeCloseTo(x, 8);
      expect(back.z).toBeCloseTo(z, 8);
      expect(back.h).toBeCloseTo(h, 8);
    }
  });

  it('turns +y onto the shown normal and keeps lengths', () => {
    const [x, z] = [24, 31];
    const n = bendTurn({ x: 0, y: 1, z: 0 }, x, z, R);
    const p = bend(x, z, 0, R);
    near(n, { x: p.x / R, y: (p.y + R) / R, z: p.z / R }, 1e-12);
    const v = bendTurn({ x: 0.3, y: -0.4, z: 0.5 }, x, z, R);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(Math.hypot(0.3, 0.4, 0.5), 12);
  });
});
