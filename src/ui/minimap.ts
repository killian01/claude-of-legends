// The minimap: a 2D canvas projection of the world, fog-respecting (it only
// draws what IWorld exposes as visible to the viewer's team). Right-click on
// it issues a move order at the corresponding world point; left-click points
// the camera there (Space snaps it back to the champion).

import type { TeamId, Vec2 } from '../sim/types';
import type { IWorld } from '../world_api';

const SIZE_PX = 168;
const TEAM_COLORS = ['#4a7dd6', '#d65c5c'];

export class Minimap {
  private readonly world: IWorld;
  private readonly viewerTeam: TeamId;
  private readonly selfId: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly scale: number;
  private readonly fog = document.createElement('canvas');
  private readonly pings: { x: number; z: number; until: number }[] = [];
  // True while the cursor is over the minimap; the edge-pan gate reads it.
  hovered = false;

  constructor(
    container: HTMLElement,
    world: IWorld,
    viewerTeam: TeamId,
    selfId: number,
    onMoveOrder: (p: Vec2) => void,
    onLook: (p: Vec2) => void,
  ) {
    this.world = world;
    this.viewerTeam = viewerTeam;
    this.selfId = selfId;
    this.scale = SIZE_PX / world.map.size;

    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE_PX;
    this.canvas.height = SIZE_PX;
    // Touchscreens are phone-sized: the map draws at full resolution but
    // displays smaller, leaving the middle of the screen to the game. The
    // click mapping below reads the on-screen rect, so it needs no change.
    const coarse =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const displayPx = coarse ? 112 : SIZE_PX;
    this.canvas.style.cssText =
      `width:${displayPx}px;height:${displayPx}px;` +
      'position:absolute;right:12px;bottom:12px;border:1px solid #466030;' +
      'border-radius:6px;pointer-events:auto;z-index:5;opacity:0.88;';
    container.appendChild(this.canvas);

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerenter', () => {
      this.hovered = true;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hovered = false;
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * world.map.size;
      const z = ((e.clientY - rect.top) / rect.height) * world.map.size;
      if (e.button === 2) onMoveOrder({ x, z });
      else onLook({ x, z });
    });

    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('minimap canvas 2d context unavailable');
    this.g = g;
  }

  addPing(x: number, z: number): void {
    this.pings.push({ x, z, until: performance.now() + 2500 });
  }

  // Same-page teardown; the listeners die with the canvas.
  dispose(): void {
    this.canvas.remove();
  }

  // The minimap matches the camera: on screen, +z runs DOWN (the camera
  // sits at +z looking back), so the minimap maps +z down too. What you see
  // bottom-right in the world is bottom-right on the map.
  private px(x: number): number {
    return x * this.scale;
  }
  private pz(z: number): number {
    return z * this.scale;
  }

  update(): void {
    const { g } = this;
    const map = this.world.map;
    g.fillStyle = '#2b4d1e';
    g.fillRect(0, 0, SIZE_PX, SIZE_PX);

    g.strokeStyle = '#846d47';
    g.lineWidth = Math.max(2, map.laneWidth * this.scale * 0.7);
    for (const lane of Object.values(map.lanes)) {
      g.beginPath();
      g.moveTo(this.px(lane[0]!.x), this.pz(lane[0]!.z));
      for (const p of lane.slice(1)) g.lineTo(this.px(p.x), this.pz(p.z));
      g.stroke();
    }

    // The river band, matching the 3D dressing's endpoints.
    g.strokeStyle = '#2f7290';
    g.lineWidth = Math.max(3, 9 * this.scale);
    g.beginPath();
    g.moveTo(this.px(map.size / 2 - 20), this.pz(map.size / 2 + 20));
    g.lineTo(this.px(map.size / 2 + 20), this.pz(map.size / 2 - 20));
    g.stroke();

    g.fillStyle = '#1c3212';
    for (const w of map.walls) {
      g.beginPath();
      g.arc(this.px(w.x), this.pz(w.z), w.r * this.scale, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#4d9032';
    for (const b of map.brush) {
      g.beginPath();
      g.arc(this.px(b.x), this.pz(b.z), b.r * this.scale, 0, Math.PI * 2);
      g.fill();
    }

    // Fog of war shading: darken everything, then punch soft holes around
    // friendly sight before drawing units on top.
    this.fog.width = SIZE_PX;
    this.fog.height = SIZE_PX;
    const f = this.fog.getContext('2d');
    if (f) {
      f.fillStyle = 'rgba(0, 0, 0, 0.42)';
      f.fillRect(0, 0, SIZE_PX, SIZE_PX);
      f.globalCompositeOperation = 'destination-out';
      for (const u of this.world.units.values()) {
        if (u.team !== this.viewerTeam || u.dead) continue;
        const r = Math.max(4, u.sightRange) * this.scale;
        const x = this.px(u.pos.x);
        const z = this.pz(u.pos.z);
        const grad = f.createRadialGradient(x, z, r * 0.55, x, z, r);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        f.fillStyle = grad;
        f.beginPath();
        f.arc(x, z, r, 0, Math.PI * 2);
        f.fill();
      }
      g.drawImage(this.fog, 0, 0);
    }

    for (const u of this.world.units.values()) {
      if (u.dead) continue;
      if (!this.world.isVisible(this.viewerTeam, u.id)) continue;
      const color = TEAM_COLORS[u.team] ?? '#fff';
      const x = this.px(u.pos.x);
      const z = this.pz(u.pos.z);
      if (u.kind === 'tower') {
        g.fillStyle = color;
        g.fillRect(x - 2.5, z - 2.5, 5, 5);
      } else if (u.kind === 'sanctum') {
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(x, z - 4);
        g.lineTo(x + 4, z);
        g.lineTo(x, z + 4);
        g.lineTo(x - 4, z);
        g.closePath();
        g.fill();
      } else if (u.kind === 'camp') {
        g.fillStyle = '#d8a24f';
        g.beginPath();
        g.arc(x, z, 2.5, 0, Math.PI * 2);
        g.fill();
      } else if (u.kind === 'warden') {
        // The Warden: a violet blotch both teams can track.
        g.fillStyle = '#c06ae8';
        g.beginPath();
        g.arc(x, z, 5, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#f0d8ff';
        g.lineWidth = 1.5;
        g.stroke();
      } else if (u.kind === 'champion') {
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, z, 4, 0, Math.PI * 2);
        g.fill();
        if (u.id === this.selfId) {
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.5;
          g.stroke();
        }
        g.font = 'bold 6px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#ffffff';
        g.fillText((u.championId?.[0] ?? '?').toUpperCase(), x, z + 0.5);
      } else {
        g.fillStyle = color;
        g.fillRect(x - 1, z - 1, 2, 2);
      }
    }

    const now = performance.now();
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i]!;
      if (now > p.until) {
        this.pings.splice(i, 1);
        continue;
      }
      const age = 1 - (p.until - now) / 2500;
      g.strokeStyle = '#ffd94a';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.px(p.x), this.pz(p.z), 4 + age * 10, 0, Math.PI * 2);
      g.stroke();
    }
  }
}
