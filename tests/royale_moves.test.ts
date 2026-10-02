// Moving and landing in the battle royale: the launch pads
// (src/sim/royale/pads.ts) throw a champion whose walk ends on one along
// the great circle to exactly its `to`; the drop (drop.ts) lands every seat
// on its pick snapped to open ground, or somewhere quiet; a respawn
// (score.ts) comes back just inside the light's edge, away from enemies.

import { describe, expect, it } from 'vitest';
import { dirTo, dist, type Vec3 } from '../src/sim/geo';
import { Rng } from '../src/sim/rng';
import { normalizePick, quietSpot, resolveLandings, snapLanding } from '../src/sim/royale/drop';
import { drawDusk, duskAt, insideCap } from '../src/sim/royale/dusk';
import { along, nearPole, randomWalkable } from '../src/sim/royale/layout';
import {
  flightOver,
  flightPos,
  padSaving,
  padSites,
  padUnder,
  startFlight,
} from '../src/sim/royale/pads';
import { EDGE_INSET_M, edgeOfLight } from '../src/sim/royale/score';
import { PAD_FLIGHT_S, PAD_REACH_M, PAD_THROW_M } from '../src/sim/royale/types';
import { DT } from '../src/sim/types';
import { BLOCKS, fakeGround, fakeLayout, R, sph } from './royale_fixture';

const layout = fakeLayout();
const pads = padSites(layout.pads);

function len(p: Vec3): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
}

describe('launch pads', () => {
  const pad = pads[0]!;
  const north = dirTo(pad.at, sph(0, 1, 0)) as Vec3;
  const near = along(pad.at, north, 0.8, R);
  const away = along(pad.at, north, 6, R);

  it('throws a champion whose walk ends on the pad, not one crossing it', () => {
    expect(padUnder(pads, near, null)?.id).toBe(pad.id);
    expect(padUnder(pads, near, pad.at)?.id).toBe(pad.id);
    expect(padUnder(pads, near, away)).toBeNull();
    expect(padUnder(pads, away, null)).toBeNull();
    const edge = along(pad.at, north, PAD_REACH_M + 0.05, R);
    expect(padUnder(pads, edge, null)).toBeNull();
  });

  it('flies the great circle over the flight time and lands exactly at its point', () => {
    for (const p of pads) expect(dist(p.at, p.to)).toBeCloseTo(PAD_THROW_M, 6);
    const f = startFlight(3, pad, near, 20);
    expect(f.endAt).toBeCloseTo(20 + PAD_FLIGHT_S, 9);
    let last = f.from;
    let lastD = 0;
    for (let t = 20; t < f.endAt; t += DT) {
      const p = flightPos(f, t);
      expect(len(p)).toBeCloseTo(R, 6);
      const d = dist(f.from, p);
      expect(d).toBeGreaterThanOrEqual(lastD - 1e-9);
      expect(dist(last, p)).toBeLessThan(2.5);
      lastD = d;
      last = p;
      expect(flightOver(f, t)).toBe(false);
    }
    expect(flightPos(f, f.endAt)).toEqual(pad.to);
    expect(flightOver(f, f.endAt)).toBe(true);
  });

  it('says when a pad shortens a trip', () => {
    const goal = along(pad.to, dirTo(pad.to, sph(0, 1, 0)) as Vec3, 3, R);
    expect(padSaving(pad, near, goal, 3.7)).toBeGreaterThan(5);
    expect(padSaving(pad, near, near, 3.7)).toBeLessThan(0);
  });
});

describe('the drop', () => {
  it('keeps a pick on the sphere and refuses a broken one', () => {
    const p = normalizePick({ x: 10, y: 0, z: 0 }, R)!;
    expect(len(p)).toBeCloseTo(R, 9);
    expect(normalizePick({ x: Number.NaN, y: 0, z: 0 }, R)).toBeNull();
    expect(normalizePick({ x: 0, y: 0, z: 0 }, R)).toBeNull();
  });

  it('snaps a pick in the lake or on a spire to open ground', () => {
    const lake = BLOCKS[2]!.at;
    const shore = snapLanding(lake, layout, fakeGround)!;
    expect(fakeGround.walkable(shore)).toBe(true);
    expect(dist(shore, lake)).toBeLessThan(BLOCKS[2]!.r + 1);
    const spire = snapLanding(sph(0, 1, 0), layout, fakeGround)!;
    expect(fakeGround.walkable(spire)).toBe(true);
    const open = sph(1, 0.1, 0.2);
    expect(snapLanding(open, layout, fakeGround)).toBe(open);
  });

  it('lands every seat, the unpicked ones somewhere quiet', () => {
    const picks = new Map<number, Vec3>([
      [1, sph(1, 0, 0)],
      [2, sph(1, 0.05, 0)],
      [4, sph(0.9, 0.1, 0.1)],
    ]);
    const seats = [1, 2, 3, 4, 5];
    const out = resolveLandings(seats, picks, new Rng(9), layout, fakeGround);
    expect([...out.keys()].sort()).toEqual(seats);
    for (const [, p] of out) {
      expect(fakeGround.walkable(p)).toBe(true);
      expect(nearPole(p, R)).toBe(false);
    }
    expect(out.get(1)).toEqual(picks.get(1));
    // Each quiet one is far from everything placed before it: farther than
    // most of the ground is.
    const rng = new Rng(77);
    const ground: Vec3[] = [];
    for (let i = 0; i < 200; i++) ground.push(randomWalkable(rng, layout, fakeGround)!);
    const taken = [...picks.values()];
    for (const id of [3, 5]) {
      const gap = (p: Vec3) => Math.min(...taken.map((h) => dist(h, p)));
      const random = ground.map(gap).sort((a, b) => a - b);
      expect(gap(out.get(id)!)).toBeGreaterThan(random[Math.floor(random.length * 0.75)]!);
      taken.push(out.get(id)!);
    }
    expect(resolveLandings(seats, picks, new Rng(9), layout, fakeGround)).toEqual(out);
  });

  it('finds a quiet spot even with nothing taken', () => {
    const p = quietSpot(new Rng(1), layout, fakeGround, []);
    expect(fakeGround.walkable(p)).toBe(true);
  });
});

describe('the respawn at the edge of the light', () => {
  const s = drawDusk(new Rng(21), layout, fakeGround, 10);

  it('comes back inside the cap, near its edge, away from enemies', () => {
    const cap = duskAt(s, 10 + 300).now;
    const enemy = along(cap.center, dirTo(cap.center, sph(0, 1, 0)) as Vec3, cap.radius - 2, R);
    for (let seed = 1; seed < 6; seed++) {
      const p = edgeOfLight(new Rng(seed), cap, [enemy], layout, fakeGround);
      expect(insideCap(cap, p)).toBe(true);
      expect(fakeGround.walkable(p)).toBe(true);
      expect(dist(cap.center, p)).toBeGreaterThan(cap.radius - EDGE_INSET_M - 1.5);
      expect(dist(p, enemy)).toBeGreaterThan(cap.radius);
    }
  });

  it('comes back anywhere walkable while the whole planet is lit', () => {
    const cap = duskAt(s, 20).now;
    const p = edgeOfLight(new Rng(2), cap, [sph(1, 0, 0)], layout, fakeGround);
    expect(fakeGround.walkable(p)).toBe(true);
    expect(dist(p, sph(1, 0, 0))).toBeGreaterThan(60);
  });
});
