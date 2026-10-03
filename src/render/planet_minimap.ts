// The minimap on the planet (docs/plan-royale.md step 8): a window of the
// chart around the camera's focus, so it is centered on the champion and
// turned the way the camera looks, drawn by the HUD's own minimap like the
// 5v5's (ui/minimap.ts) over a background painted from the planet: the
// regions and their water, the night outside the light, the next cap's
// golden line, the pads and the caches. The window is a second view of
// the stage's chart, so the two never disagree.

import type { SnapCache, SnapDusk } from '../net/royale_wire';
import type { Vec3 } from '../sim/geo';
import type { IWorld } from '../world_api';
import { ChartWindow, ChartWorld, type ChartView } from './chart_world';
import { capAngle } from './planet_dusk';
import type { PlanetGround } from './planet_terrain';

// Meters the minimap's square spans.
export const MINIMAP_WINDOW = 110;
const PX = 168;
const CELLS = 56;
const REPAINT_MS = 120;

function angleBetween(a: Vec3, b: Vec3): number {
  const cx = a.y * b.z - a.z * b.y;
  const cy = a.z * b.x - a.x * b.z;
  const cz = a.x * b.y - a.y * b.x;
  return Math.atan2(Math.hypot(cx, cy, cz), a.x * b.x + a.y * b.y + a.z * b.z);
}

export class PlanetMinimap {
  readonly window: ChartWindow;
  readonly world: ChartWorld;
  readonly background = document.createElement('canvas');
  private paintedAt = Number.NEGATIVE_INFINITY;
  private paintedEpoch = -1;

  constructor(
    base: IWorld,
    view: ChartView,
    private readonly ground: PlanetGround,
  ) {
    this.window = new ChartWindow(view, MINIMAP_WINDOW);
    this.world = new ChartWorld(base, this.window);
    this.background.width = PX;
    this.background.height = PX;
  }

  // The sphere point under a minimap point (its window's coordinates).
  toSphere(x: number, z: number): Vec3 {
    return this.window.toSphere(x, z);
  }

  // Repaints the background when the chart moved or a beat has passed.
  paint(now: number, dusk: SnapDusk | null, caches: readonly SnapCache[]): void {
    const epoch = this.window.view.epoch;
    if (epoch === this.paintedEpoch && now - this.paintedAt < REPAINT_MS * 4) return;
    if (now - this.paintedAt < REPAINT_MS) return;
    this.paintedAt = now;
    this.paintedEpoch = epoch;
    const g = this.background.getContext('2d');
    if (!g) return;
    const R = this.ground.radius;
    const lit = dusk ? { c: dirOf(dusk.c), a: capAngle(dusk.r, R) } : null;
    const next =
      dusk?.nc && dusk.nr !== undefined ? { c: dirOf(dusk.nc), a: capAngle(dusk.nr, R) } : null;
    const cell = PX / CELLS;
    const span = MINIMAP_WINDOW / CELLS;
    for (let j = 0; j < CELLS; j++) {
      for (let i = 0; i < CELLS; i++) {
        // Canvas row 0 is the window's far edge (+z up the map).
        const x = (i + 0.5) * span;
        const z = MINIMAP_WINDOW - (j + 0.5) * span;
        const p = this.window.toSphere(x, z);
        const h = this.ground.heightAt(p);
        let color = this.ground.regionColor(this.ground.regionAt(p));
        if (h < -0.4) color = 'rgb(52,112,150)';
        g.fillStyle = color;
        g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
        // Relief: lighter up high, darker down low.
        const shade = Math.max(-0.25, Math.min(0.25, h * 0.12));
        g.fillStyle = shade > 0 ? `rgba(255,255,255,${shade})` : `rgba(0,0,0,${-shade})`;
        g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
        if (lit) {
          const past = (angleBetween(dirOf3(p), lit.c) - lit.a) * R;
          if (past > 0) {
            g.fillStyle = `rgba(8,14,46,${Math.min(0.72, 0.35 + past * 0.08)})`;
            g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
          }
          if (Math.abs(past) < span * 0.6) {
            g.fillStyle = 'rgba(255,140,60,0.85)';
            g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
          }
        }
        if (next) {
          const edge = Math.abs((angleBetween(dirOf3(p), next.c) - next.a) * R);
          if (edge < span * 0.5) {
            g.fillStyle = 'rgba(255,214,90,0.9)';
            g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
          }
        }
      }
    }
    const k = PX / MINIMAP_WINDOW;
    const dot = (p: Vec3, r: number, fill: string): void => {
      const q = this.window.toLocal(p);
      if (q.x < 0 || q.z < 0 || q.x > MINIMAP_WINDOW || q.z > MINIMAP_WINDOW) return;
      g.fillStyle = fill;
      g.beginPath();
      g.arc(q.x * k, PX - q.z * k, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const pad of this.ground.layout.pads) dot(pad.at, 3, '#ffcf4a');
    for (const [, x, y, z, golden] of caches) dot({ x, y, z }, golden ? 2.6 : 1.7, golden ? '#ffd23a' : '#fff1b0');
  }
}

function dirOf(w: readonly [number, number, number]): Vec3 {
  const d = Math.hypot(w[0], w[1], w[2]) || 1;
  return { x: w[0] / d, y: w[1] / d, z: w[2] / d };
}

function dirOf3(p: Vec3): Vec3 {
  const d = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / d, y: p.y / d, z: p.z / d };
}
