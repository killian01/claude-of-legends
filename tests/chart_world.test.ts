// The world as the planet's chart shows it (src/render/chart_world.ts):
// every position the renderer reads comes as a point of the chart window,
// orders given through it go back to the sphere, and a re-center makes
// the cached conversions stale.

import { describe, expect, it } from 'vitest';
import { type ChartView, ChartWindow, ChartWorld } from '../src/render/chart_world';
import { PlanetChart } from '../src/render/planet_chart';
import { offset, type Vec3 } from '../src/sim/geo';
import type { Vec2 } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const R = 80;

function onSphere(x: number, y: number, z: number): Vec3 {
  const d = Math.hypot(x, y, z);
  return { x: (x / d) * R, y: (y / d) * R, z: (z / d) * R };
}

function fakeWorld() {
  const center = onSphere(0.2, 1, 0.3);
  const chart = PlanetChart.around(center, R);
  const near = chart.fromChart(5, -3);
  const unit = {
    id: 1,
    team: 0,
    pos: { ...near },
    pendingSpell: { key: 'Q', aim: chart.fromChart(9, 0), resolveAt: 1 },
    attackMoveTarget: null,
    recastArmed: null,
    hp: 100,
  };
  const bolt = { id: 7, pos: chart.fromChart(-4, 2), dir: chart.dirFromChart(-4, 2, 1, 0) };
  const orders: { x: number; z: number; y?: number }[] = [];
  const casts: Vec2[] = [];
  const base = {
    map: { size: 156 },
    time: 3,
    winner: null,
    units: new Map([[1, unit]]),
    projectiles: new Map([[7, bolt]]),
    zones: new Map([[3, { id: 3, pos: chart.fromChart(0, 12) }]]),
    walls: new Map(),
    orderMove: (_id: number, x: number, z: number, y?: number) => orders.push({ x, z, y }),
    castAbility: (_id: number, _key: string, aim: Vec2) => {
      casts.push(aim);
      return true;
    },
  } as unknown as IWorld;
  const view: ChartView = { chart, epoch: 0 };
  return { base, view, chart, unit, orders, casts };
}

describe('the chart world', () => {
  it('shows every position as a point of its window, the chart origin in the middle', () => {
    const { base, view } = fakeWorld();
    const world = new ChartWorld(base, new ChartWindow(view, 200));
    expect(world.map.size).toBe(200);
    expect(world.map.towers).toEqual([]);
    const u = world.units.get(1)!;
    expect(u.pos.y).toBeUndefined();
    expect(u.pos.x).toBeCloseTo(105, 9);
    expect(u.pos.z).toBeCloseTo(97, 9);
    // The rest of the unit reads through to the real one.
    expect(u.hp).toBe(100);
    expect(u.pendingSpell?.aim.x).toBeCloseTo(109, 9);
    const b = world.projectiles.get(7)!;
    expect(b.pos.x).toBeCloseTo(96, 9);
    expect(b.dir.x).toBeCloseTo(1, 3);
    expect(b.dir.z).toBeCloseTo(0, 3);
    expect(world.zones.get(3)!.pos.z).toBeCloseTo(112, 9);
    expect([...world.units.values()]).toHaveLength(1);
  });

  it('keeps a conversion until the unit moves or the chart re-centers', () => {
    const { base, view, unit, chart } = fakeWorld();
    const world = new ChartWorld(base, new ChartWindow(view, 200));
    const first = world.units.get(1);
    expect(world.units.get(1)).toBe(first);
    // Moved: a new conversion.
    Object.assign(unit.pos, chart.fromChart(6, -3));
    const moved = world.units.get(1)!;
    expect(moved).not.toBe(first);
    expect(moved.pos.x).toBeCloseTo(106, 9);
    // Re-centered a meter east: the same unit now a meter further west,
    // to a hair (the curve over the step).
    view.chart = chart.recentered(chart.fromChart(1, 0));
    view.epoch++;
    const after = world.units.get(1)!;
    expect(after.pos.x).toBeCloseTo(105, 2);
    expect(after.pos.z).toBeCloseTo(97, 2);
  });

  it('sends orders and casts back as sphere points', () => {
    const { base, view, orders, casts, chart } = fakeWorld();
    const world = new ChartWorld(base, new ChartWindow(view, 200));
    world.orderMove(1, 110, 100);
    const want = chart.fromChart(10, 0);
    expect(orders[0]!.x).toBeCloseTo(want.x, 9);
    expect(orders[0]!.y).toBeCloseTo(want.y, 9);
    expect(orders[0]!.z).toBeCloseTo(want.z, 9);
    world.castAbility(1, 'Q', { x: 100, z: 108 });
    expect(Math.hypot(casts[0]!.x, casts[0]!.y ?? 0, casts[0]!.z)).toBeCloseTo(R, 9);
  });

  it('passes a point of the plane through untouched', () => {
    const { view } = fakeWorld();
    const w = new ChartWindow(view, 200);
    expect(w.toLocal({ x: 12, z: 34 })).toEqual({ x: 12, z: 34 });
    const p = w.toSphere(130, 70);
    const back = w.toLocal(offset(p, w.view.chart.east, 0) as Vec3);
    expect(back.x).toBeCloseTo(130, 9);
    expect(back.z).toBeCloseTo(70, 9);
  });
});
