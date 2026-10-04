// The minimap on the planet (docs/plan-royale.md step 8): a window of the
// chart around the camera's focus, so it is centered on the champion and
// turned the way the camera looks, drawn by the HUD's own minimap like the
// 5v5's (ui/minimap.ts) over a background painted from the planet: the
// regions and their water, the night outside the light, the next cap's
// golden line, the pads and the caches (a Seedfall's bigger and white),
// and the loud moments: each Seedfall's column a pulsing gold star, each
// Clamor a red ring swelling where a takedown rang out; and the Risings
// and the hunted (ui/royale_hunted.ts): each Rising a dot in its color, the
// Lodestar a crown where it was last shown and the Wrath's holder a
// diamond, bright while shown. The window is a
// second view of the stage's chart, so the two never disagree.

import type { SnapCache, SnapClamor, SnapDusk, SnapSeedfall } from '../net/royale_wire';
import type { Vec3 } from '../sim/geo';
import { type MinimapIcon, minimapIcons } from '../ui/royale_hunted';
import type { IWorld } from '../world_api';
import { type ChartView, ChartWindow, ChartWorld } from './chart_world';
import { capAngle } from './planet_dusk';
import type { PlanetGround } from './planet_terrain';

// Meters the minimap's square spans.
export const MINIMAP_WINDOW = 110;
const PX = 168;
const CELLS = 56;
const REPAINT_MS = 120;
// A Clamor's flash on the minimap, seconds (CLAMOR_S rings it out).
const CLAMOR_FLASH_S = 3;

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
  // The ground and the Dusk, painted on the slow beat; the marks go over
  // a copy of it, on the quick beat while something on it moves.
  private readonly terrain = document.createElement('canvas');
  private paintedAt = Number.NEGATIVE_INFINITY;
  private terrainAt = Number.NEGATIVE_INFINITY;
  private paintedEpoch = -1;

  constructor(
    private readonly base: IWorld,
    view: ChartView,
    private readonly ground: PlanetGround,
  ) {
    this.window = new ChartWindow(view, MINIMAP_WINDOW);
    this.world = new ChartWorld(base, this.window);
    this.background.width = PX;
    this.background.height = PX;
    this.terrain.width = PX;
    this.terrain.height = PX;
  }

  // The sphere point under a minimap point (its window's coordinates).
  toSphere(x: number, z: number): Vec3 {
    return this.window.toSphere(x, z);
  }

  // Repaints the background when the chart moved or a beat has passed.
  paint(now: number, dusk: SnapDusk | null, caches: readonly SnapCache[]): void {
    const epoch = this.window.view.epoch;
    const royale = this.base.royaleView?.() ?? null;
    const time = this.base.time;
    const clamors = (royale?.cl ?? []).filter(
      (c) => time - c[3] >= 0 && time - c[3] < CLAMOR_FLASH_S,
    );
    const seedfalls = royale?.st === 'play' ? (royale.sf ?? []) : [];
    const icons = minimapIcons(royale, time);
    // Something on it moves: repaint at the quick beat.
    const lively = clamors.length > 0 || seedfalls.length > 0 || icons.length > 0;
    if (!lively && epoch === this.paintedEpoch && now - this.paintedAt < REPAINT_MS * 4) return;
    if (now - this.paintedAt < REPAINT_MS) return;
    this.paintedAt = now;
    const out = this.background.getContext('2d');
    if (!out) return;
    if (epoch !== this.paintedEpoch || now - this.terrainAt >= REPAINT_MS * 4) {
      this.paintedEpoch = epoch;
      this.terrainAt = now;
      this.paintTerrain(dusk);
    }
    out.drawImage(this.terrain, 0, 0);
    this.paintMarks(out, now, time, caches, seedfalls, clamors, icons);
  }

  // The ground's regions and relief, the night outside the light, the
  // light's edge and the next cap's line.
  private paintTerrain(dusk: SnapDusk | null): void {
    const g = this.terrain.getContext('2d');
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
  }

  // The pads, the caches, the Seedfalls and the Clamors over the ground.
  private paintMarks(
    g: CanvasRenderingContext2D,
    now: number,
    time: number,
    caches: readonly SnapCache[],
    seedfalls: readonly SnapSeedfall[],
    clamors: readonly SnapClamor[],
    icons: readonly MinimapIcon[],
  ): void {
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
    for (const [, x, y, z, kind] of caches) {
      if (kind === 2) dot({ x, y, z }, 3.4, '#fffbe6');
      else dot({ x, y, z }, kind === 1 ? 2.6 : 1.7, kind === 1 ? '#ffd23a' : '#fff1b0');
    }
    // The Seedfalls: a gold star that pulses, clamped to the edge when the
    // column stands beyond the window.
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    for (const sf of seedfalls) {
      const q = this.window.toLocal({ x: sf[1], y: sf[2], z: sf[3] });
      const cx = Math.max(6, Math.min(PX - 6, q.x * k));
      const cy = Math.max(6, Math.min(PX - 6, PX - q.z * k));
      star(g, cx, cy, 5.5 + 1.5 * pulse, sf[5] === 1 ? '#fff6c8' : '#ffd35a');
    }
    // The Risings and the hunted, clamped to the edge like a Seedfall.
    for (const ic of icons) {
      const q = this.window.toLocal(ic.at);
      const cx = Math.max(6, Math.min(PX - 6, q.x * k));
      const cy = Math.max(6, Math.min(PX - 6, PX - q.z * k));
      g.globalAlpha = ic.shown ? 1 : 0.6;
      if (ic.icon === 'crown') crown(g, cx, cy, ic.shown ? 7 + 1.5 * pulse : 6, ic.color);
      else if (ic.icon === 'diamond') diamond(g, cx, cy, ic.shown ? 6 + pulse : 5, ic.color);
      else {
        g.fillStyle = ic.color;
        g.strokeStyle = 'rgba(20,8,0,0.85)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(cx, cy, ic.shown ? 4.5 + pulse : 3.5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    // The Clamors: a red ring swelling and fading where each rang out.
    for (const c of clamors) {
      const q = this.window.toLocal({ x: c[0], y: c[1], z: c[2] });
      if (q.x < 0 || q.z < 0 || q.x > MINIMAP_WINDOW || q.z > MINIMAP_WINDOW) continue;
      const age = (time - c[3]) / CLAMOR_FLASH_S;
      g.strokeStyle = `rgba(255,70,50,${(0.95 * (1 - age)).toFixed(3)})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(q.x * k, PX - q.z * k, 3 + 9 * age, 0, Math.PI * 2);
      g.stroke();
    }
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

// A crown, for the Lodestar on the minimap: three points over a band.
function crown(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  g.fillStyle = fill;
  g.strokeStyle = 'rgba(40,24,0,0.9)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x - r, y + r * 0.6);
  g.lineTo(x - r, y - r * 0.5);
  g.lineTo(x - r * 0.5, y);
  g.lineTo(x, y - r * 0.8);
  g.lineTo(x + r * 0.5, y);
  g.lineTo(x + r, y - r * 0.5);
  g.lineTo(x + r, y + r * 0.6);
  g.closePath();
  g.fill();
  g.stroke();
}

// A diamond, for the Wrath's holder on the minimap.
function diamond(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  g.fillStyle = fill;
  g.strokeStyle = 'rgba(30,20,60,0.9)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r * 0.7, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r * 0.7, y);
  g.closePath();
  g.fill();
  g.stroke();
}

// A four-pointed star, for a Seedfall on the minimap.
function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  g.fillStyle = fill;
  g.strokeStyle = 'rgba(40,24,0,0.85)';
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const d = i % 2 === 0 ? r : r * 0.42;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
  g.stroke();
}
